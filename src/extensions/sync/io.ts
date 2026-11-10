/**
 * Extensions in the Jellyfin account: the I/O around `blob.ts`. The blob
 * lives in the user's display preferences (id `zoggyfin-extensions`, client
 * `zoggyfin`, CustomPrefs keys `ext.parts` and `ext.<n>`), so every device
 * that signs in as the same Jellyfin user gets the same extensions.
 *
 * - It pulls when an account signs in or the app starts, when the app comes
 *   to the front and when the server answers again. It pushes a few seconds
 *   after a change; with no server, the change waits (`dirty`).
 * - One sync runs at a time (`createSerialRunner`); an account switch drops
 *   the queued run of the old account.
 * - The apply's own writes match the ledger, so they send nothing.
 * - An extension of the account that is not on this device opens the
 *   confirm screen once ("From your account"). The ledger marks it seen
 *   when the screen opens, so a later pull never opens it again for the
 *   same add. While another confirm screen shows, the offer waits.
 * - Nothing here logs the blob or a URL. Secret settings never sync.
 */
import { AppState } from 'react-native';

import { getApi } from '@/api/client';
import { getCustomPrefs, setCustomPrefs } from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { createSerialRunner } from '@/lib/async-gate';
import { isOffline, useOnlineStore } from '@/lib/online';
import { readJson, writeJson } from '@/storage/json';

import { useInstallRequest } from '../install-request';
import { accountKey, extensionsState, removeExtension, useExtensions } from '../store';
import {
  applyUpdates,
  decodeExtBlob,
  extBlobText,
  type ExtSyncBlob,
  type ExtSyncMeta,
  isEmptyBlob,
  type LocalExtensions,
  localBlob,
  markSeen,
  mergeBlobs,
  migrateExtMeta,
  observe,
  type Offer,
  planApply,
  planIsEmpty,
  sameBlob,
  withExtBlob,
} from './blob';

export const EXT_PREFS_ID = 'zoggyfin-extensions';
const CLIENT = 'zoggyfin';
/** A change goes to the account this long after the last one. */
const PUSH_DELAY_MS = 3000;
/** Foreground pulls happen at most this often. */
const PULL_GAP_MS = 30_000;

interface Scope {
  serverId: string;
  userId: string;
  serverUrl: string;
  token: string;
  key: string;
}

let lastError: string | null = null;
/** The last problem, for logs only: background sync shows no message. */
export const lastExtensionSyncError = () => lastError;

const metaKey = (s: Pick<Scope, 'serverId' | 'userId'>) => `extensions.sync.${s.serverId}.${s.userId}`;
const loadMeta = (s: Scope): ExtSyncMeta => migrateExtMeta(readJson<unknown>(metaKey(s), null));
const saveMeta = (s: Scope, m: ExtSyncMeta) => writeJson(metaKey(s), m);

class TooLarge extends Error {}

/** The signed-in account, once the extension store shows it. */
function currentScope(): Scope | null {
  const s = useSessionStore.getState().session;
  if (!s) return null;
  const key = accountKey(s);
  return extensionsState().account === key ? { serverId: s.serverId, userId: s.userId, serverUrl: s.serverUrl, token: s.token, key } : null;
}

function errorText(e: unknown): string {
  if (e instanceof TooLarge) return 'too large';
  return (e as { response?: unknown } | null)?.response ? 'refused' : 'no answer';
}

function readLocal(): LocalExtensions {
  const st = extensionsState();
  return { list: st.list, values: st.values, skip: st.skip };
}

async function push(scope: Scope, blob: ExtSyncBlob): Promise<void> {
  const text = extBlobText(blob);
  if (text === null) throw new TooLarge();
  await setCustomPrefs(getApi(scope.serverUrl, scope.token), scope.userId, EXT_PREFS_ID, CLIENT, (current) => withExtBlob(current, text));
}

/** Opens the confirm screen for the offers. Set by the runtime, so this file has no router import. */
let openOffers: ((urls: string[]) => void) | null = null;

/** Shows the offers unless another confirm screen is open; true when they showed. */
function offer(offers: readonly Offer[]): boolean {
  if (!offers.length || !openOffers) return false;
  if (useInstallRequest.getState().entries.length) return false;
  openOffers(offers.map((o) => o.manifestUrl));
  return true;
}

type Kind = 'pull' | 'push';

async function cycle(kind: Kind): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  const same = () => currentScope()?.key === scope.key;
  let meta = loadMeta(scope);
  const seen = observe(meta, readLocal(), Date.now());
  if (seen !== meta) {
    meta = { ...seen, dirty: true };
    saveMeta(scope, meta);
  }
  if (kind === 'push' && !meta.dirty) return;
  if (isOffline()) return;
  try {
    const remote = decodeExtBlob(await getCustomPrefs(getApi(scope.serverUrl, scope.token), scope.userId, EXT_PREFS_ID, CLIENT));
    if (!same()) return;
    // The device's own changes made while the request ran count too.
    let local = readLocal();
    meta = observe(meta, local, Date.now());
    const blob = mergeBlobs(localBlob(meta, local), remote, Date.now());
    const plan = planApply(local, blob, meta);
    if (!planIsEmpty(plan)) {
      for (const id of plan.remove) removeExtension(id);
      local = readLocal();
      const next = applyUpdates(local, plan);
      useExtensions.setState({ list: next.list, values: next.values, skip: next.skip });
    }
    meta = plan.meta;
    const pushed = !sameBlob(blob, remote) && !(isEmptyBlob(blob) && !remote);
    if (pushed) {
      saveMeta(scope, { ...meta, dirty: true });
      await push(scope, blob);
    }
    if (!same()) return;
    if (offer(plan.offer)) meta = markSeen(meta, plan.offer);
    saveMeta(scope, { ...meta, dirty: false });
    lastError = null;
  } catch (e) {
    if (same()) saveMeta(scope, { ...meta, dirty: true });
    lastError = errorText(e);
    console.warn('[extensions] account sync failed', e instanceof Error ? e.name : 'error');
  }
}

let nextKind: Kind | null = null;
const cycles = createSerialRunner(async () => {
  const kind = nextKind ?? 'push';
  nextKind = null;
  await cycle(kind);
});

function run(kind: Kind): Promise<void> {
  nextKind = nextKind === 'pull' || kind === 'pull' ? 'pull' : 'push';
  return cycles.request();
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPullAt = 0;

function schedulePush(): void {
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

/** Pulls the account's extensions, unless that happened a moment ago. */
export function syncExtensionsSoon(): void {
  if (!currentScope() || Date.now() - lastPullAt < PULL_GAP_MS) return;
  void pull();
}

let started = false;

/**
 * Starts account sync of the extension list. `open` shows the confirm
 * screen for manifest URLs from the account. Safe to call often.
 */
export function startExtensionSync(open: (urls: string[]) => void): void {
  openOffers = open;
  if (started) return;
  started = true;
  void pull();
  // The store follows the session (`session-binding.ts`): a new account shows here as a new `account`.
  useExtensions.subscribe((s, prev) => {
    if (s.account !== prev.account) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      cycles.reset();
      nextKind = null;
      if (s.account) void pull();
      return;
    }
    if (s.list !== prev.list || s.values !== prev.values || s.skip !== prev.skip) schedulePush();
  });
  useOnlineStore.subscribe((s, prev) => {
    if (s.reachable && prev.reachable !== true) void pull();
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') syncExtensionsSoon();
  });
}
