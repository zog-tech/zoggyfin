/**
 * Providers shared by a server admin: the I/O around `shared.ts`.
 *
 * - Every user: `pullShared` reads the user's own shared blob and adds,
 *   updates or removes the shared providers on this device (with their
 *   files). `sync.ts` calls it on each pull.
 * - An admin: `runShares` writes each chosen user's shared blob from the
 *   admin's choices and providers. It also visits the users it wrote to the
 *   last time, so an untick or a removed provider leaves those users too.
 *   "Everyone" reaches users added later the next time it runs (on a pull,
 *   at most every 10 minutes, and after each change).
 * - Everything is per account (server Id + user Id). Nothing here logs a
 *   login, a URL or a blob.
 */
import { create } from 'zustand';

import { getApi } from '@/api/client';
import { getCustomPrefs, getUsers, isAdministrator, setCustomPrefs } from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { readJson, writeJson } from '@/storage/json';

import type { SyncedProvider } from './account-sync';
import { applyShared, bindSession } from './manager';
import { readSecrets } from './secrets';
import {
  desiredFor,
  MAX_SHARED_CHARS,
  parseShared,
  parseSharing,
  planShared,
  type ShareChoice,
  SHARED_KEY,
  SHARED_PREFS_ID,
  SHARING_KEY,
  type SharingChoices,
  targetsOf,
  withAdminShares,
  withChoice,
  withValue,
} from './shared';
import { iptvState, type Scope, scopeId } from './store';

const CLIENT = 'zoggyfin';
const RUN_GAP_MS = 10 * 60_000;

type FullScope = Scope & { serverUrl: string; token: string; userName: string };

function currentScope(): FullScope | null {
  const s = useSessionStore.getState().session;
  return s ? { serverId: s.serverId, userId: s.userId, serverUrl: s.serverUrl, token: s.token, userName: s.userName } : null;
}

const api = (s: FullScope) => getApi(s.serverUrl, s.token);
const sameScope = (sid: string) => {
  const s = currentScope();
  return !!s && scopeId(s) === sid && iptvState().scope === sid;
};

// ---- Every user ------------------------------------------------------------------------

/** Brings this device's shared providers in line with the user's shared blob. Throws only on a network error. */
export async function pullShared(): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  bindSession();
  const sid = scopeId(scope);
  const blob = parseShared(await getCustomPrefs(api(scope), scope.userId, SHARED_PREFS_ID, CLIENT));
  if (!sameScope(sid)) return;
  const records = iptvState().providers.providers;
  const plan = planShared(records, readSecrets, blob, scope.userId, Date.now());
  if (plan.upsert.length || plan.remove.length) await applyShared(plan.upsert, plan.remove);
}

// ---- Admins ------------------------------------------------------------------------------

interface AdminState {
  /** `serverId:userId` to "is an admin" (null while unknown). */
  admin: Record<string, boolean>;
  choices: Record<string, SharingChoices>;
}

export const useShareStore = create<AdminState>(() => ({ admin: {}, choices: {} }));

/** The users this admin wrote to last time, per account (MMKV): they are visited again, so an untick reaches them. */
const writtenKey = (s: Scope) => `iptv.sharing.${s.serverId}.${s.userId}`;
const loadWritten = (s: Scope): string[] => {
  const v = readJson<unknown>(writtenKey(s), null);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

/** True when the signed-in user is an admin (asked once per account and run). */
export async function checkAdmin(): Promise<boolean> {
  const scope = currentScope();
  if (!scope) return false;
  const sid = scopeId(scope);
  const known = useShareStore.getState().admin[sid];
  if (known !== undefined) return known;
  const yes = await isAdministrator(api(scope));
  useShareStore.setState({ admin: { ...useShareStore.getState().admin, [sid]: yes } });
  return yes;
}

/** The admin's own providers as they are shared (no shared copies). */
function ownProviders(): Record<string, SyncedProvider> {
  const st = iptvState();
  const out: Record<string, SyncedProvider> = {};
  for (const id of st.providers.order) {
    const p = st.providers.providers[id];
    if (!p || p.sharedBy) continue;
    const s = readSecrets(id);
    const secrets: SyncedProvider['secrets'] = {};
    for (const k of ['username', 'password', 'playlistUrl', 'guideUrl'] as const) if (s[k]) secrets[k] = s[k];
    out[id] = { kind: p.kind, name: p.name, server: p.server, userAgent: p.userAgent, createdAt: p.createdAt, secrets };
  }
  return out;
}

async function loadChoices(scope: FullScope): Promise<SharingChoices> {
  const choices = parseSharing(await getCustomPrefs(api(scope), scope.userId, SHARED_PREFS_ID, CLIENT));
  useShareStore.setState({ choices: { ...useShareStore.getState().choices, [scopeId(scope)]: choices } });
  return choices;
}

let lastRunAt = 0;
let running: Promise<void> | null = null;

/** Writes the shared blobs of the users this admin shares with (or stopped sharing with). */
export function runShares(force: boolean): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastRunAt < RUN_GAP_MS) return Promise.resolve();
  lastRunAt = Date.now();
  running = (async () => {
    const scope = currentScope();
    if (!scope || !(await checkAdmin())) return;
    const sid = scopeId(scope);
    const choices = await loadChoices(scope);
    const written = loadWritten(scope);
    if (!Object.keys(choices.providers).length && !written.length) return;
    const users = await getUsers(api(scope));
    const ids = users.map((u) => u.id);
    const own = ownProviders();
    const targets = new Set(Object.values(choices.providers).flatMap((c) => targetsOf(c, ids, scope.userId)));
    const admin = { userId: scope.userId, name: scope.userName };
    const reached: string[] = [];
    for (const userId of new Set([...targets, ...written])) {
      if (!sameScope(sid)) return;
      if (userId === scope.userId || !ids.includes(userId)) continue;
      const desired = desiredFor(userId, choices, own, ids, admin);
      await setCustomPrefs(api(scope), userId, SHARED_PREFS_ID, CLIENT, (current) => {
        const blob = parseShared(current);
        const next = withAdminShares(blob, scope.userId, desired);
        const empty = !Object.keys(next.providers).length;
        const text = empty ? null : JSON.stringify(next);
        if (text && text.length > MAX_SHARED_CHARS) throw new Error('too large');
        return withValue(current, SHARED_KEY, empty ? null : next);
      });
      if (Object.keys(desired).length) reached.push(userId);
    }
    if (sameScope(sid)) writeJson(writtenKey(scope), reached);
  })()
    .catch((e: unknown) => console.warn('[iptv] sharing failed', e instanceof Error ? e.name : 'error'))
    .finally(() => {
      running = null;
    });
  return running;
}

/** The choice of one provider, from the last load. */
export function choiceOf(providerId: string): ShareChoice | null {
  const scope = currentScope();
  if (!scope) return null;
  return useShareStore.getState().choices[scopeId(scope)]?.providers[providerId] ?? null;
}

/** The server's users for the share page (admins only), and the saved choices. */
export async function loadShareTargets(): Promise<{ users: { id: string; name: string }[]; choices: SharingChoices }> {
  const scope = currentScope();
  if (!scope) return { users: [], choices: parseSharing(null) };
  const [users, choices] = await Promise.all([getUsers(api(scope)), loadChoices(scope)]);
  return { users: users.filter((u) => u.id !== scope.userId), choices };
}

/** Saves who a provider is shared with (null: no one) and writes the users' blobs. */
export async function setShareChoice(providerId: string, choice: ShareChoice | null): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  let saved: SharingChoices | null = null;
  await setCustomPrefs(api(scope), scope.userId, SHARED_PREFS_ID, CLIENT, (current) => {
    saved = withChoice(parseSharing(current), providerId, choice);
    return withValue(current, SHARING_KEY, Object.keys(saved.providers).length ? saved : null);
  });
  if (saved) useShareStore.setState({ choices: { ...useShareStore.getState().choices, [scopeId(scope)]: saved } });
  if (running) await running;
  await runShares(true);
}

