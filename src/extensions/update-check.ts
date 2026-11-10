/**
 * Updates of installed extensions: what a newer manifest needs, and a quiet
 * check at app start and at most once per 6 hours while the app is in use.
 *
 * Rules:
 * - An update needs the user's consent (the confirm screen) when it asks for
 *   a permission the installed manifest did not have, or when a page asks
 *   for a place (a tab or a Library tile) it did not ask for before. Any
 *   other change (new `tabs`, sections, settings, a new `version`) applies
 *   by itself.
 * - The quiet check applies such an update at once. An update that needs
 *   consent is never applied and never opens a screen: the extension gets a
 *   row in Settings → Extensions ("Update available") and one toast per
 *   account, extension and version.
 * - A manifest URL that now serves another extension id, an error or a
 *   manifest that is not valid changes nothing.
 * - The "Check for an update" button uses the same rule (`updatePlan`).
 *
 * The rules and the check are pure (their effects are passed in), so they
 * are unit-tested. `startUpdateChecks` wires them to the app.
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

import { pagesOf, type Manifest, type Permission } from './schema';

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TOASTED_KEY = 'extensions.updateToasts.v1';

export interface UpdatePlan {
  /** `none`: the same manifest. `apply`: applies by itself. `consent`: needs the confirm screen. */
  kind: 'none' | 'apply' | 'consent';
  newPermissions: Permission[];
  /** Ids of pages that ask for a tab or a Library tile they did not ask for before. */
  newlyPlaced: string[];
}

type ManifestLike = Pick<Manifest, 'permissions' | 'contributes'>;

function places(m: ManifestLike): Map<string, { tab: boolean; library: boolean }> {
  return new Map(pagesOf(m).map((p) => [p.id, { tab: !!p.placement?.tab, library: !!p.placement?.library }]));
}

/** What a newer manifest needs before it replaces the installed one. */
export function updatePlan(installed: Manifest, next: Manifest): UpdatePlan {
  const newPermissions = next.permissions.filter((p) => !installed.permissions.includes(p));
  const before = places(installed);
  const newlyPlaced = [...places(next)].filter(([id, now]) => {
    const was = before.get(id);
    return (now.tab && !was?.tab) || (now.library && !was?.library);
  }).map(([id]) => id);
  const same = JSON.stringify(installed) === JSON.stringify(next);
  const kind = newPermissions.length || newlyPlaced.length ? 'consent' : same ? 'none' : 'apply';
  return { kind, newPermissions, newlyPlaced };
}

/** True when the last check is 6 hours old or more (or there was none). */
export function dueForCheck(lastAt: number | undefined, now: number): boolean {
  return lastAt === undefined || now - lastAt >= UPDATE_CHECK_INTERVAL_MS;
}

/** An installed extension as the check sees it. */
export interface CheckedExtension {
  id: string;
  name: string;
  manifestUrl: string;
  manifest: Manifest;
}

export interface CheckDeps {
  /** Loads and parses the manifest at a URL; throws when it is not valid. */
  load(url: string): Promise<{ manifest: Manifest }>;
  /** Replaces the installed manifest (an update that needs no consent). */
  apply(extId: string, manifest: Manifest): Promise<void> | void;
  /** Marks an update that needs consent (a row in Settings → Extensions). */
  markPending(extId: string, version: string): void;
  /** Shows a toast; the check calls it once per account, extension and version. */
  toast(text: string): void;
  /** The versions already toasted, keyed `<account>\u0000<extId>`. */
  toasted: Record<string, string>;
  saveToasted(next: Record<string, string>): void;
  account: string;
}

export interface CheckResult {
  applied: string[];
  pending: string[];
}

/** Checks every installed extension once. Never throws. */
export async function checkForUpdates(list: readonly CheckedExtension[], deps: CheckDeps): Promise<CheckResult> {
  const out: CheckResult = { applied: [], pending: [] };
  let toasted = deps.toasted;
  for (const ext of list) {
    try {
      const { manifest } = await deps.load(ext.manifestUrl);
      if (manifest.id !== ext.id) continue;
      const plan = updatePlan(ext.manifest, manifest);
      if (plan.kind === 'apply') {
        await deps.apply(ext.id, manifest);
        out.applied.push(ext.id);
      } else if (plan.kind === 'consent') {
        deps.markPending(ext.id, manifest.version);
        out.pending.push(ext.id);
        const key = `${deps.account}\u0000${ext.id}`;
        if (toasted[key] !== manifest.version) {
          deps.toast(`${ext.name} has an update that needs your OK. See Settings, Extensions.`);
          toasted = { ...toasted, [key]: manifest.version };
          deps.saveToasted(toasted);
        }
      }
    } catch {
      // Offline, an error or a manifest that is not valid: try again at the next check.
    }
  }
  return out;
}

// --- Wiring -------------------------------------------------------------------

const NONE: Record<string, string> = {};

/** Updates that need the user's consent, per account: account → extension id → the new version. Memory only. */
export const useExtensionUpdates = create<{ byAccount: Record<string, Record<string, string>> }>(() => ({ byAccount: {} }));

/** The pending updates of one account (the signed-in one in the screens). */
export function pendingUpdatesOf(st: { byAccount: Record<string, Record<string, string>> }, account: string | null): Record<string, string> {
  return (account && st.byAccount[account]) || NONE;
}

export function markUpdatePending(account: string, extId: string, version: string): void {
  useExtensionUpdates.setState((st) => ({ byAccount: { ...st.byAccount, [account]: { ...st.byAccount[account], [extId]: version } } }));
}

/** The update was applied (by the confirm screen or the button) on this account: the row goes. */
export function clearUpdatePending(account: string | null, extId: string): void {
  useExtensionUpdates.setState((st) => {
    const mine = account ? st.byAccount[account] : undefined;
    if (!account || !mine || !(extId in mine)) return st;
    const { [extId]: _gone, ...rest } = mine;
    return { byAccount: { ...st.byAccount, [account]: rest } };
  });
}

export const readToasted = (): Record<string, string> => readJson<Record<string, string>>(TOASTED_KEY, {});
export const saveToasted = (next: Record<string, string>): void => writeJson(TOASTED_KEY, next);

export interface UpdateCheckWiring {
  /** The signed-in account key, or null. */
  account(): string | null;
  /** Calls `fn` when the account changes. Returns a stop function. */
  onAccountChange(fn: () => void): () => void;
  list(): CheckedExtension[];
  deps: Omit<CheckDeps, 'markPending' | 'toasted' | 'saveToasted' | 'account'>;
  now?: () => number;
}

/**
 * Checks at start (once an account is signed in), on each new account, and
 * then at most once per 6 hours while the app is in use: a timer looks every
 * 15 minutes, and a return to the foreground looks too.
 */
export function startUpdateChecks(w: UpdateCheckWiring): () => void {
  const now = w.now ?? Date.now;
  const last = new Map<string, number>();
  let running = false;
  const maybeCheck = async () => {
    const account = w.account();
    if (!account || running || !dueForCheck(last.get(account), now())) return;
    running = true;
    last.set(account, now());
    try {
      await checkForUpdates(w.list(), {
        ...w.deps,
        account,
        markPending: (extId, version) => markUpdatePending(account, extId, version),
        toasted: readToasted(),
        saveToasted,
      });
    } finally {
      running = false;
    }
  };
  void maybeCheck();
  const stopAccount = w.onAccountChange(() => void maybeCheck());
  const timer = setInterval(() => void maybeCheck(), 15 * 60 * 1000);
  const sub = AppState.addEventListener('change', (st) => {
    if (st === 'active') void maybeCheck();
  });
  return () => {
    stopAccount();
    clearInterval(timer);
    sub.remove();
  };
}
