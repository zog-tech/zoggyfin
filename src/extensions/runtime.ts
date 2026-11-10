/**
 * The extension runtime: it turns the installed manifests into item
 * actions, Home rows and share targets, and runs them. It reads only data
 * from an extension and makes HTTP requests to the extension's origin.
 */
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { router } from 'expo-router';

import { getApi } from '@/api/client';
import { getItem, getViews } from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { scopeKey } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { isIconName, type IconName } from '@/components/icon-names';
import { toast } from '@/lib/toast';
import { readJson, writeJson } from '@/storage/json';
import { homeSections } from '@/registry/home-sections';
import { type ItemActionContext, itemActions } from '@/registry/item-actions';

import type { DetailAction } from './feeds';
import { ExtensionError, FEED_TIMEOUT_MS, buildRequest, type Grants, type JellyfinAccount, parseOptions, send } from './http';
import { type InstallSource, loadInstallRequest } from './install-request';
import { findLink, manifestCandidates, matchesHosts, matchesWhen } from './match';
import { askChoice, askConfirm, askText, type ChoiceOption } from './prompts';
import { type ActionResponse, applyRefresh, handleActionResponse, type ResponseEffects, type TaskRef, toastText } from './response';
import { type InputSpec, type ItemActionSpec, type Manifest, parseManifest, type RequestSpec, type ShareTargetSpec } from './schema';
import { followSession } from './session-binding';
import { accountInstall, type Offer, type SyncedExtension } from './sync/blob';
import { type AccountFacts, effectiveValues, extensionsState, getExtension, type InstalledExtension, setAuto, upsertExtension, useExtensions } from './store';
import { plannedContributions, registrationSignature } from './registration';
import { forgetSavedTask, readSavedTasks, rememberTask, TASKS_KEY, tasksToResume } from './saved-tasks';
import { startTask, stopTasksExcept, useTasks } from './tasks';
import { render, usesName, type TemplateContext } from './template';

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

// The store shows the signed-in account's extensions from the first render on.
followSession();

let isAdmin = false;
let adminFor = '';

function session() {
  return useSessionStore.getState().session;
}

export function currentAccount(): JellyfinAccount | null {
  const s = session();
  return s ? { serverUrl: s.serverUrl, serverId: s.serverId, userId: s.userId, userName: s.userName, token: s.token } : null;
}

function accountFacts(): AccountFacts | null {
  const a = currentAccount();
  return a ? { ...a, isAdmin: adminFor === `${a.serverId}.${a.userId}` && isAdmin } : null;
}

/** Reads whether the signed-in user is a server admin (for `jellyfin.isAdmin` settings). */
export async function refreshAccountFacts(): Promise<void> {
  const s = session();
  if (!s) return;
  try {
    const me = await getUserApi(getApi(s.serverUrl, s.token)).getCurrentUser();
    isAdmin = !!me.data.Policy?.IsAdministrator;
    adminFor = `${s.serverId}.${s.userId}`;
  } catch {
    // Not important: the value stays false.
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function templateContext(ext: InstalledExtension, extra: Omit<TemplateContext, 'settings' | 'jellyfin'> = {}): TemplateContext {
  const facts = accountFacts();
  const st = extensionsState();
  return {
    ...extra,
    settings: effectiveValues(ext.manifest, st, facts),
    jellyfin: facts
      ? {
          serverUrl: facts.serverUrl,
          serverId: facts.serverId,
          userId: facts.userId,
          userName: facts.userName,
          isAdmin: facts.isAdmin,
        }
      : {},
  };
}

export async function extensionRequest(ext: InstalledExtension, spec: Pick<RequestSpec, 'method' | 'path' | 'query' | 'body'>, ctx: TemplateContext, timeoutMs?: number): Promise<unknown> {
  const req = buildRequest(ext.manifest, spec, ctx, ext.grants, currentAccount());
  return send(req, timeoutMs);
}

export async function fetchOptions(ext: InstalledExtension, path: string, ctx: TemplateContext): Promise<ChoiceOption[]> {
  return parseOptions(await extensionRequest(ext, { method: 'GET', path }, ctx, FEED_TIMEOUT_MS));
}

// ---------------------------------------------------------------------------
// Effects of a response
// ---------------------------------------------------------------------------

let refreshTimers: ReturnType<typeof setTimeout>[] = [];

function refreshAll(): void {
  const s = session();
  if (!s) return;
  void queryClient.invalidateQueries({ queryKey: scopeKey({ serverId: s.serverId, userId: s.userId }) });
}

/** Refreshes the app's data now and twice more, while the server scans its library. */
export function refreshLibrary(): void {
  refreshTimers.forEach(clearTimeout);
  refreshAll();
  refreshTimers = [8_000, 25_000].map((ms) => setTimeout(refreshAll, ms));
}

function effectsFor(ext: InstalledExtension): ResponseEffects {
  return {
    toast: (text, kind) => toast(text, { icon: kind === 'ok' ? 'checkmark' : 'exclamationmark.triangle' }),
    startTask: (ref) => followTask(ext, ref),
    refreshItem: refreshAll,
    refreshLibrary,
  };
}

// Running tasks are saved per account, so the app follows them again after a restart (or a page reload on web).
const savedTasks = () => readSavedTasks(readJson<unknown>(TASKS_KEY, []));

export function followTask(ext: InstalledExtension, ref: TaskRef, at = Date.now()): string {
  const extId = ext.manifest.id;
  const account = extensionsState().account;
  if (account) writeJson(TASKS_KEY, rememberTask(savedTasks(), { extId, ref, at, account }));
  return startTask(ref, { id: extId, name: ext.manifest.name, account: account ?? undefined }, {
    fetchStatus: (url) => extensionRequest(getExtension(extId) ?? ext, { method: 'GET', path: url }, templateContext(ext), FEED_TIMEOUT_MS),
    onDone: (status, task) => {
      if (account) writeJson(TASKS_KEY, forgetSavedTask(savedTasks(), extId, ref.statusUrl, account));
      toast(toastText(status.toast) ?? `${task.title}: done`, { icon: 'checkmark' });
      applyRefresh(status.refresh, effectsFor(ext));
    },
    onFailed: (message, task) => {
      if (account) writeJson(TASKS_KEY, forgetSavedTask(savedTasks(), extId, ref.statusUrl, account));
      toast(`${task.title}: ${message}`, { icon: 'exclamationmark.triangle' });
    },
  });
}

/**
 * Follows the saved tasks of the signed-in account again (at start and after
 * an account switch), and stops following the tasks of other accounts: their
 * status requests would carry the wrong account. Tasks older than a day are
 * dropped.
 */
function resumeTasks(): void {
  const account = extensionsState().account;
  stopTasksExcept(account);
  if (!account) return;
  const { resume, keep } = tasksToResume(savedTasks(), account, Date.now());
  writeJson(TASKS_KEY, keep);
  const running = new Set(useTasks.getState().tasks.map((t) => t.key.split(':').slice(0, -1).join(':')));
  for (const t of resume) {
    const ext = getExtension(t.extId);
    if (ext?.enabled && !running.has(`${t.extId}:${t.ref.id ?? t.ref.statusUrl}`)) followTask(ext, t.ref, t.at);
  }
}

// ---------------------------------------------------------------------------
// Running an action or a share target
// ---------------------------------------------------------------------------

async function collectInputs(ext: InstalledExtension, inputs: InputSpec[] | undefined, ctx: TemplateContext): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const input of inputs ?? []) {
    const c: TemplateContext = { ...ctx, input: values };
    const initial = input.default ? render(input.default, c) : undefined;
    let v: string | null;
    if (input.type === 'text') {
      v = await askText({ title: input.title, message: input.message, placeholder: input.placeholder, initial });
      if (v !== null && !v.trim()) v = null;
    } else {
      const fixed = input.options;
      const source = input.source;
      v = await askChoice({
        title: input.title,
        message: input.message,
        initial,
        load: async () => (source ? fetchOptions(ext, source, c) : (fixed ?? [])),
      });
    }
    if (v === null) return null;
    values[input.key] = v.trim();
  }
  return values;
}

/** How an action flow ended: the user cancelled a prompt, the request failed, or the extension answered. */
export type FlowOutcome = { status: 'cancelled' } | { status: 'failed' } | { status: 'done'; reply: ActionResponse | null };

async function runFlow(
  ext: InstalledExtension,
  spec: { title: string; confirm?: ItemActionSpec['confirm']; inputs?: InputSpec[]; request: RequestSpec; destructive?: boolean },
  base: Omit<TemplateContext, 'settings' | 'jellyfin'>,
  opts: { onSend?: () => void; effects?: Partial<ResponseEffects> } = {},
): Promise<FlowOutcome> {
  const ctx = templateContext(ext, base);
  const input = await collectInputs(ext, spec.inputs, ctx);
  if (input === null) return { status: 'cancelled' };
  const full: TemplateContext = { ...ctx, input };
  if (spec.confirm) {
    const ok = await askConfirm({
      title: render(spec.confirm.title, full),
      message: spec.confirm.message ? render(spec.confirm.message, full) : undefined,
      action: spec.confirm.action,
      destructive: spec.destructive,
    });
    if (!ok) return { status: 'cancelled' };
  }
  // After the prompts and right before the request: an on/off button shows its new state here.
  opts.onSend?.();
  try {
    const data = await extensionRequest(ext, spec.request, full);
    const reply = handleActionResponse(data, { ...effectsFor(ext), ...opts.effects }, `${spec.title}: sent to ${ext.manifest.name}`);
    return { status: 'done', reply };
  } catch (e) {
    toast(e instanceof ExtensionError || e instanceof Error ? e.message : `${ext.manifest.name} did not answer.`, { icon: 'exclamationmark.triangle' });
    return { status: 'failed' };
  }
}

/**
 * Runs a button of an entry detail page, with the flow of an item action
 * (inputs, confirm, request, reply). `next` is the state an on/off button
 * asks for: `{{action.next}}` in the request. `onSend` runs after the
 * prompts, right before the request (the button shows the new state then).
 * The detail page supplies `refreshEntry` and `refreshPage` for the reply's
 * `refresh`.
 */
export function runDetailAction(
  ext: InstalledExtension,
  action: DetailAction,
  opts: { next?: boolean; onSend?: () => void; refreshEntry: () => void; refreshPage: () => void },
): Promise<FlowOutcome> {
  return runFlow(ext, action, opts.next === undefined ? {} : { action: { next: opts.next } }, {
    onSend: opts.onSend,
    effects: { refreshEntry: opts.refreshEntry, refreshPage: opts.refreshPage },
  });
}

/** Facts about an item that need extra requests: its library and its file path. */
export interface ItemExtraFacts {
  libraryName?: string | null;
  path?: string | null;
}

function itemContext(ext: InstalledExtension, item: BaseItemDto, facts: ItemExtraFacts | undefined) {
  const path = item.Path ?? facts?.path ?? null;
  return {
    id: item.Id ?? '',
    name: item.Name ?? '',
    type: item.Type ?? '',
    mediaType: item.MediaType ?? '',
    libraryName: facts?.libraryName ?? '',
    serverId: item.ServerId ?? '',
    ...(ext.grants.itemPath && ext.manifest.permissions.includes('itemPath') ? { path: path ?? '' } : {}),
  };
}

function iconOf(name: string | undefined, fallback: IconName): IconName {
  return name && isIconName(name) ? name : fallback;
}

/** True when an enabled action needs the item's library or path, so the action sheet loads them. */
export function needsItemFacts(): boolean {
  return extensionsState().list.some(
    (e) =>
      e.enabled &&
      (e.manifest.contributes.itemActions ?? []).some((a) => !!a.when?.libraries?.length || !!a.when?.pathPrefixes?.length || usesName(a.request, 'item.path')),
  );
}

/** Loads the library name and the file path of an item. */
export async function loadItemFacts(itemId: string): Promise<ItemExtraFacts> {
  const s = session();
  if (!s) return {};
  const api = getApi(s.serverUrl, s.token);
  const [ancestors, item] = await Promise.all([
    getLibraryApi(api).getAncestors({ itemId, userId: s.userId }).then((r) => r.data).catch(() => []),
    // The full item has its Path for users who may see it.
    getItem(api, s.userId, itemId).catch(() => null),
  ]);
  const lib = ancestors.find((a) => a.Type === 'CollectionFolder') ?? ancestors.find((a) => a.Type === 'UserView');
  return { libraryName: lib?.Name ?? null, path: item?.Path ?? null };
}

export async function runShareTarget(ext: InstalledExtension, target: ShareTargetSpec, link: string): Promise<void> {
  await runFlow(ext, target, { share: { url: link } });
}

/** The share targets that take a link, from every enabled extension. */
export function shareTargetsFor(text: string): { link: string | null; targets: { ext: InstalledExtension; target: ShareTargetSpec }[] } {
  const link = findLink(text);
  if (!link) return { link: null, targets: [] };
  const targets = extensionsState()
    .list.filter((e) => e.enabled)
    .flatMap((ext) => (ext.manifest.contributes.shareTargets ?? []).filter((t) => matchesHosts(link, t.hosts)).map((target) => ({ ext, target })));
  return { link, targets };
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface Candidate {
  manifestUrl: string;
  manifest: Manifest;
  /** Set when this extension is already installed. */
  installed?: InstalledExtension;
  /** Set when account sync offers it: the account's entry (grants, settings, tab). */
  fromAccount?: SyncedExtension;
}

/** Fetches and checks a manifest. `input` is a manifest URL or a site address. */
export async function loadManifest(input: string): Promise<Candidate> {
  const urls = manifestCandidates(input);
  if (!urls.length) throw new ExtensionError('Enter an address, for example http://192.0.2.10:3000.');
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const data = await send({ url, method: 'GET', headers: { Accept: 'application/json' } }, FEED_TIMEOUT_MS);
      const r = parseManifest(data);
      if (!r.ok) throw new ExtensionError(`The manifest is not valid: ${r.error}`);
      return { manifestUrl: url, manifest: r.manifest, installed: getExtension(r.manifest.id) };
    } catch (e) {
      lastError = e;
      // A manifest that loads but is not valid: say so, do not try the next address.
      if (e instanceof ExtensionError && e.message.startsWith('The manifest is not valid')) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new ExtensionError('No extension found at this address.');
}

/** Installs (or updates) an extension and fills in its settings. */
export async function install(c: Candidate, grants: Grants): Promise<void> {
  let ext: InstalledExtension = { manifestUrl: c.manifestUrl, manifest: c.manifest, enabled: true, grants, installedAt: c.installed?.installedAt ?? Date.now() };
  if (c.fromAccount && !c.installed) {
    // From the account: its settings, tab and add time; the grants the user set on the screen.
    const id = c.manifest.id;
    const r = accountInstall(ext, extensionsState().values[id], c.fromAccount);
    ext = r.ext;
    useExtensions.setState((st) => ({ list: [...st.list.filter((e) => e.manifest.id !== id), r.ext], values: { ...st.values, [id]: r.values } }));
  } else upsertExtension(ext);
  await prefill(ext);
}

/**
 * Fills in settings with no user input: choice lists come from the
 * extension; with `matchLibrary`, the first option that has the name of a
 * Jellyfin library is chosen.
 */
export async function prefill(ext: InstalledExtension): Promise<void> {
  await refreshAccountFacts();
  const fields = (ext.manifest.contributes.settings ?? []).filter((f) => f.type === 'choice' && f.optionsSource);
  if (!fields.length) return;
  let libraries: string[] = [];
  const s = session();
  if (s && fields.some((f) => f.type === 'choice' && f.matchLibrary)) {
    try {

      libraries = (await getViews(getApi(s.serverUrl, s.token), s.userId)).map((v) => (v.Name ?? '').toLowerCase());
    } catch {
      libraries = [];
    }
  }
  const auto: Record<string, string> = {};
  const options: Record<string, ChoiceOption[]> = {};
  await Promise.all(
    fields.map(async (f) => {
      if (f.type !== 'choice' || !f.optionsSource) return;
      try {
        const list = await fetchOptions(ext, f.optionsSource, templateContext(ext));
        options[f.key] = list;
        if (f.matchLibrary) {
          const hit = list.find((o) => libraries.includes(o.value.toLowerCase()) || libraries.includes(o.label.toLowerCase()));
          if (hit) auto[f.key] = hit.value;
        }
      } catch {
        // The settings screen shows the fixed options or the default.
      }
    }),
  );
  setAuto(ext.manifest.id, auto, options);
}

// --- Install requests (the confirm screen) -----------------------------------

export { cancelInstallRequest, confirmInstallRequest, pendingCandidates, useInstallRequest } from './install-request';

/**
 * Opens one confirm screen for one or more extensions (an address the user
 * typed, or the links of an invite). The state and its rules are in
 * `install-request.ts`.
 */
export async function requestInstall(inputs: string[], source: InstallSource = 'user', load: (input: string) => Promise<Candidate> = loadManifest): Promise<void> {
  const list = [...new Set(inputs.map((i) => i.trim()).filter(Boolean))].slice(0, 10);
  if (!list.length) return;
  const loading = loadInstallRequest(list, load, source);
  router.push('/extension-install');
  await loading;
}

/** For invite links: offers the extensions of the inviting user on one confirm screen. */
export function installFromInvite(urls: string[]): Promise<void> {
  const fresh = urls.filter((u) => !extensionsState().list.some((e) => e.manifestUrl === u));
  return requestInstall(fresh);
}

/**
 * For account sync: offers extensions that another device added to the
 * account ("From your account"). The app loads each manifest from its URL,
 * as for any install.
 */
export function installFromAccount(offers: Offer[]): void {
  const fresh = offers.filter((o) => !extensionsState().list.some((e) => e.manifestUrl === o.manifestUrl || e.manifest.id === o.id));
  const byUrl = new Map(fresh.map((o) => [o.manifestUrl, o]));
  void requestInstall(
    fresh.map((o) => o.manifestUrl),
    'account',
    async (input) => {
      const c = await loadManifest(input);
      const o = byUrl.get(input);
      // The account's entry only for the extension it names (the URL may serve another one now).
      return o && o.id === c.manifest.id ? { ...c, fromAccount: o.val } : c;
    },
  );
}

// ---------------------------------------------------------------------------
// Registration into the app registries
// ---------------------------------------------------------------------------

let unregister: (() => void)[] = [];
let lastSignature = '';

/**
 * Registers the contributions of the signed-in account's enabled
 * extensions. Runs again when the list changes or another account signs in.
 */
export function syncRegistrations(sectionComponent: (extId: string, sectionId: string) => React.ComponentType): void {
  const st = extensionsState();
  const sig = registrationSignature(st.account, st.list);
  if (sig === lastSignature) return;
  lastSignature = sig;
  unregister.forEach((u) => u());
  unregister = [];
  for (const c of plannedContributions(st.list)) {
    const id = c.extId;
    const ext = st.list.find((e) => e.manifest.id === id) as InstalledExtension;
    if (c.kind === 'homeSection') {
      unregister.push(homeSections.register({ id: c.id, order: c.order, component: sectionComponent(id, c.sectionId) }));
      continue;
    }
    const a = c.action;
    unregister.push(
      itemActions.register({
        id: c.id,
        title: a.title,
        icon: iconOf(a.icon, 'square.grid.2x2'),
        order: c.order,
        destructive: a.destructive,
        when: (ctx: ItemActionContext) => {
          const cur = getExtension(id) ?? ext;
          const item = itemContext(cur, ctx.item, ctx.facts);
          // An action that needs a fact still loading stays hidden until it arrives.
          return matchesWhen(a.when, { type: ctx.item.Type, mediaType: ctx.item.MediaType, libraryName: item.libraryName || null, path: 'path' in item ? item.path || null : null });
        },
        run: async (ctx: ItemActionContext) => {
          const cur = getExtension(id) ?? ext;
          await runFlow(cur, a, { item: itemContext(cur, ctx.item, ctx.facts) });
        },
      }),
    );
  }
}

/**
 * Starts the runtime: registers now and on every change of the list or the
 * account. On an account switch it also follows that account's saved tasks.
 * Returns a stop function.
 */
export function startExtensions(sectionComponent: (extId: string, sectionId: string) => React.ComponentType): () => void {
  followSession();
  syncRegistrations(sectionComponent);
  void refreshAccountFacts();
  resumeTasks();
  return useExtensions.subscribe((st, prev) => {
    syncRegistrations(sectionComponent);
    if (st.account !== prev.account) {
      void refreshAccountFacts();
      resumeTasks();
    }
  });
}
