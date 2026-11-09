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

import { ExtensionError, FEED_TIMEOUT_MS, buildRequest, type Grants, type JellyfinAccount, parseOptions, send } from './http';
import { loadInstallRequest } from './install-request';
import { findLink, manifestCandidates, matchesHosts, matchesWhen } from './match';
import { askChoice, askConfirm, askText, type ChoiceOption } from './prompts';
import { applyRefresh, handleActionResponse, type ResponseEffects, type TaskRef, toastText } from './response';
import { type InputSpec, type ItemActionSpec, type Manifest, parseManifest, type RequestSpec, type ShareTargetSpec } from './schema';
import { type AccountFacts, effectiveValues, extensionsState, getExtension, type InstalledExtension, setAuto, upsertExtension, useExtensions } from './store';
import { startTask } from './tasks';
import { render, usesName, type TemplateContext } from './template';

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

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

// Running tasks are saved, so the app follows them again after a restart (or a page reload on web).
const TASKS_KEY = 'extensions.tasks.v1';
type SavedTask = { extId: string; ref: TaskRef; at: number };
const savedTasks = () => readJson<SavedTask[]>(TASKS_KEY, []);
function forgetTask(extId: string, ref: TaskRef) {
  writeJson(TASKS_KEY, savedTasks().filter((t) => !(t.extId === extId && t.ref.statusUrl === ref.statusUrl)));
}

export function followTask(ext: InstalledExtension, ref: TaskRef, at = Date.now()): string {
  const extId = ext.manifest.id;
  writeJson(TASKS_KEY, [...savedTasks().filter((t) => !(t.extId === extId && t.ref.statusUrl === ref.statusUrl)), { extId, ref, at }].slice(-20));
  return startTask(ref, { id: extId, name: ext.manifest.name }, {
    fetchStatus: (url) => extensionRequest(getExtension(extId) ?? ext, { method: 'GET', path: url }, templateContext(ext), FEED_TIMEOUT_MS),
    onDone: (status, task) => {
      forgetTask(extId, ref);
      toast(toastText(status.toast) ?? `${task.title}: done`, { icon: 'checkmark' });
      applyRefresh(status.refresh, effectsFor(ext));
    },
    onFailed: (message, task) => {
      forgetTask(extId, ref);
      toast(`${task.title}: ${message}`, { icon: 'exclamationmark.triangle' });
    },
  });
}

let resumed = false;

/** Follows the saved tasks again, once per app start. Tasks older than a day are dropped. */
function resumeTasks(): void {
  if (resumed) return;
  resumed = true;
  const fresh = savedTasks().filter((t) => Date.now() - t.at < 24 * 60 * 60 * 1000);
  writeJson(TASKS_KEY, fresh);
  for (const t of fresh) {
    const ext = getExtension(t.extId);
    if (ext?.enabled) followTask(ext, t.ref, t.at);
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

async function runFlow(
  ext: InstalledExtension,
  spec: { title: string; confirm?: ItemActionSpec['confirm']; inputs?: InputSpec[]; request: RequestSpec; destructive?: boolean },
  base: Omit<TemplateContext, 'settings' | 'jellyfin'>,
): Promise<void> {
  const ctx = templateContext(ext, base);
  const input = await collectInputs(ext, spec.inputs, ctx);
  if (input === null) return;
  const full: TemplateContext = { ...ctx, input };
  if (spec.confirm) {
    const ok = await askConfirm({
      title: render(spec.confirm.title, full),
      message: spec.confirm.message ? render(spec.confirm.message, full) : undefined,
      action: spec.confirm.action,
      destructive: spec.destructive,
    });
    if (!ok) return;
  }
  try {
    const data = await extensionRequest(ext, spec.request, full);
    handleActionResponse(data, effectsFor(ext), `${spec.title}: sent to ${ext.manifest.name}`);
  } catch (e) {
    toast(e instanceof ExtensionError || e instanceof Error ? e.message : `${ext.manifest.name} did not answer.`, { icon: 'exclamationmark.triangle' });
  }
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
  const ext: InstalledExtension = { manifestUrl: c.manifestUrl, manifest: c.manifest, enabled: true, grants, installedAt: c.installed?.installedAt ?? Date.now() };
  upsertExtension(ext);
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
export async function requestInstall(inputs: string[]): Promise<void> {
  const list = [...new Set(inputs.map((i) => i.trim()).filter(Boolean))].slice(0, 10);
  if (!list.length) return;
  const loading = loadInstallRequest(list, loadManifest);
  router.push('/extension-install');
  await loading;
}

/** For invite links: offers the extensions of the inviting user on one confirm screen. */
export function installFromInvite(urls: string[]): Promise<void> {
  const fresh = urls.filter((u) => !extensionsState().list.some((e) => e.manifestUrl === u));
  return requestInstall(fresh);
}

// ---------------------------------------------------------------------------
// Registration into the app registries
// ---------------------------------------------------------------------------

let unregister: (() => void)[] = [];
let lastSignature = '';

function signature(list: InstalledExtension[]): string {
  return JSON.stringify(list.filter((e) => e.enabled).map((e) => [e.manifest, e.grants]));
}

/** Registers the contributions of the enabled extensions. Runs again when the list changes. */
export function syncRegistrations(sectionComponent: (extId: string, sectionId: string) => React.ComponentType): void {
  const list = extensionsState().list;
  const sig = signature(list);
  if (sig === lastSignature) return;
  lastSignature = sig;
  unregister.forEach((u) => u());
  unregister = [];
  list
    .filter((e) => e.enabled)
    .sort((a, b) => a.installedAt - b.installedAt)
    .forEach((ext, i) => {
      const id = ext.manifest.id;
      (ext.manifest.contributes.itemActions ?? []).forEach((a, j) => {
        unregister.push(
          itemActions.register({
            id: `ext.${id}.${a.id}`,
            title: a.title,
            icon: iconOf(a.icon, 'square.grid.2x2'),
            order: 60 + i * 5 + j / 100,
            destructive: a.destructive,
            when: (ctx: ItemActionContext) => {
              const cur = getExtension(id) ?? ext;
              const item = itemContext(cur, ctx.item, ctx.facts);
              // An action that needs a fact still loading stays hidden until it arrives.
              return matchesWhen(a.when, { type: ctx.item.Type, mediaType: ctx.item.MediaType, libraryName: item.libraryName || null, path: 'path' in item ? item.path || null : null });
            },
            run: (ctx: ItemActionContext) => {
              const cur = getExtension(id) ?? ext;
              return runFlow(cur, a, { item: itemContext(cur, ctx.item, ctx.facts) });
            },
          }),
        );
      });
      (ext.manifest.contributes.homeSections ?? []).forEach((sec, j) => {
        unregister.push(homeSections.register({ id: `ext.${id}.${sec.id}`, order: 45 + i + j / 10, component: sectionComponent(id, sec.id) }));
      });
    });
}

/** Starts the runtime: registers now and on every change. Returns a stop function. */
export function startExtensions(sectionComponent: (extId: string, sectionId: string) => React.ComponentType): () => void {
  syncRegistrations(sectionComponent);
  void refreshAccountFacts();
  resumeTasks();
  return useExtensions.subscribe(() => syncRegistrations(sectionComponent));
}
