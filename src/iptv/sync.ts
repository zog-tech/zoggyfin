/**
 * Live TV in the Jellyfin account: the I/O around `account-sync.ts`. The
 * blob lives in the user's display preferences (id `zoggyfin-iptv`, client
 * `zoggyfin`), so every device that signs in as the same Jellyfin user gets
 * the same providers, favourites and positions.
 *
 * Sync is always on, for every account.
 *
 * - It pulls when an account signs in or the app starts, when the app comes
 *   to the front, when the server answers again, and when Live TV or the
 *   providers page opens.
 * - It pushes a few seconds after a change. With no server, the change
 *   waits (`dirty`) and goes when the server answers.
 * - A user with no providers anywhere gets no blob.
 * - Everything is per account (server Id + user Id): the ledger and the blob.
 * - Nothing here logs the blob, a login or a URL.
 */
import { AppState } from 'react-native';

import { getApi } from '@/api/client';
import { getCustomPrefs, setCustomPrefs } from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { isOffline, useOnlineStore } from '@/lib/online';
import { readJson, writeJson } from '@/storage/json';

import {
  blobText,
  decodeChunks,
  isEmptyBlob,
  localBlob,
  type LocalState,
  mergeBlobs,
  migrateMeta,
  observe,
  planApply,
  planIsEmpty,
  sameBlob,
  type SyncBlob,
  type SyncMeta,
  withBlob,
} from './account-sync';
import { applySynced, bindSession } from './manager';
import { readSecrets } from './secrets';
import { iptvState, loadLists, type Scope, scopeId, useIptvStore } from './store';
import type { ProviderSecrets } from './types';
import { loadVodLists, useVodStore, vodState } from './vod-store';

const PREFS_ID = 'zoggyfin-iptv';
const CLIENT = 'zoggyfin';
/** A change goes to the account this long after the last one. */
const PUSH_DELAY_MS = 3000;
/** Pages that open often pull at most this often. */
const PULL_GAP_MS = 30_000;

/** The last problem, for logs only: background sync shows no message. */
let lastError: string | null = null;
export const lastSyncError = () => lastError;

const metaKey = (s: Scope) => `iptv.sync.${s.serverId}.${s.userId}`;
const loadMeta = (s: Scope): SyncMeta => migrateMeta(readJson<unknown>(metaKey(s), null));
const saveMeta = (s: Scope, m: SyncMeta) => writeJson(metaKey(s), m);

class TooLarge extends Error {}

function currentScope(): (Scope & { serverUrl: string; token: string }) | null {
  const s = useSessionStore.getState().session;
  return s ? { serverId: s.serverId, userId: s.userId, serverUrl: s.serverUrl, token: s.token } : null;
}

/** What went wrong, in a word (no URL, no data). */
function errorText(e: unknown): string {
  if (e instanceof TooLarge) return 'too large';
  // An axios error with no answer: the server did not answer.
  return (e as { response?: unknown } | null)?.response ? 'refused' : 'no answer';
}

/** What this device has now, for the account that is signed in. */
function readLocal(): LocalState {
  const st = iptvState();
  const secrets: Record<string, ProviderSecrets> = {};
  const lists: LocalState['lists'] = {};
  const vod: LocalState['vod'] = {};
  for (const id of st.providers.order) {
    if (!st.providers.providers[id]) continue;
    secrets[id] = readSecrets(id);
    lists[id] = st.lists[id] ?? loadLists(id);
    vod[id] = vodState().vodLists[id] ?? loadVodLists(id);
  }
  return { providers: st.providers, secrets, lists, vod };
}

/** True while this sync writes to the stores (its own writes are not changes to send). */
let applying = false;

async function apply(local: LocalState, blob: SyncBlob, meta: SyncMeta): Promise<SyncMeta> {
  const plan = planApply(local, blob, meta);
  if (!planIsEmpty(plan, local)) {
    applying = true;
    try {
      await applySynced(plan);
    } finally {
      applying = false;
    }
  }
  return plan.meta;
}

async function push(scope: Scope & { serverUrl: string; token: string }, blob: SyncBlob): Promise<void> {
  const text = blobText(blob);
  if (text === null) throw new TooLarge();
  await setCustomPrefs(getApi(scope.serverUrl, scope.token), scope.userId, PREFS_ID, CLIENT, (current) => withBlob(current, text));
}

type Kind = 'pull' | 'push';

/** One sync with the account. Callers go through `run`, so two never overlap. */
async function cycle(kind: Kind): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  bindSession();
  const sid = scopeId(scope);
  if (iptvState().scope !== sid) return;
  const same = () => {
    const now = currentScope();
    return !!now && scopeId(now) === sid && iptvState().scope === sid;
  };
  let meta = loadMeta(scope);
  const seen = observe(meta, readLocal(), Date.now());
  if (seen !== meta) {
    meta = { ...seen, dirty: true };
    saveMeta(scope, meta);
  }
  if (kind === 'push' && !meta.dirty) return;
  if (isOffline()) return;
  try {
    const remote = decodeChunks(await getCustomPrefs(getApi(scope.serverUrl, scope.token), scope.userId, PREFS_ID, CLIENT));
    if (!same()) return;
    // The device's own changes made while the request ran count too.
    const local = readLocal();
    meta = observe(meta, local, Date.now());
    const blob = mergeBlobs(localBlob(meta, local), remote, Date.now());
    meta = await apply(local, blob, meta);
    if (!same()) return;
    // A user with no Live TV anywhere gets no blob.
    if (!sameBlob(blob, remote) && !(isEmptyBlob(blob) && !remote)) {
      saveMeta(scope, { ...meta, dirty: true });
      await push(scope, blob);
    }
    saveMeta(scope, { ...meta, dirty: false });
    lastError = null;
  } catch (e) {
    if (same()) saveMeta(scope, { ...meta, dirty: true });
    lastError = errorText(e);
    console.warn('[iptv] account sync failed', e instanceof Error ? e.name : 'error');
  }
}

let running: Promise<void> | null = null;
let again: Kind | null = null;

function run(kind: Kind): Promise<void> {
  if (running) {
    again = again === 'pull' || kind === 'pull' ? 'pull' : 'push';
    return running;
  }
  running = cycle(kind).finally(() => {
    running = null;
    const next = again;
    again = null;
    if (next) void run(next);
  });
  return running;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPullAt = 0;

function schedulePush(): void {
  if (applying) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void run('push');
  }, PUSH_DELAY_MS);
}

function pull(): Promise<void> {
  lastPullAt = Date.now();
  return run('pull');
}

/** Pulls the account's Live TV setup, unless that happened a moment ago (pages call this when they open). */
export function syncSoon(): void {
  if (!currentScope() || Date.now() - lastPullAt < PULL_GAP_MS) return;
  void pull();
}

let started = false;

/** Starts account sync for whichever account is signed in. Safe to call often. */
export function startIptvSync(): void {
  if (started) return;
  started = true;
  void pull();
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.serverId === prev.session?.serverId && s.session?.userId === prev.session?.userId) return;
    // Another account (or a sign-in): a pull from its own server.
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    if (s.session) void pull();
  });
  useIptvStore.subscribe((s, prev) => {
    if (s.scope === prev.scope && (s.providers !== prev.providers || s.lists !== prev.lists)) schedulePush();
  });
  useVodStore.subscribe((s, prev) => {
    if (s.vodLists !== prev.vodLists) schedulePush();
  });
  useOnlineStore.subscribe((s, prev) => {
    if (s.reachable && prev.reachable !== true) void pull();
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') syncSoon();
  });
}
