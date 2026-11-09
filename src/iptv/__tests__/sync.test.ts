/**
 * Account sync with a fake server, a fake manager and fake timers: a change
 * goes 3 s after the last one, pages pull at most every 30 s, a change made
 * during an apply is still sent, the apply's own writes send nothing, and an
 * account switch drops the queued run of the old account.
 */
import type { LocalState } from '../account-sync';
import type { SyncedChanges } from '../manager';
import type { ProviderRecord, ProviderSecrets } from '../types';

const mockKv = new Map<string, string>();
const mockPrefs = new Map<string, Record<string, string | null>>();
const mockCalls: string[] = [];
const mockSecrets = new Map<string, ProviderSecrets>();
const mockHolds: { get: Promise<void> | null; apply: Promise<void> | null } = { get: null, apply: null };
let mockApplied = 0;

jest.mock('@/storage/kv', () => ({
  storage: {
    getString: (k: string) => mockKv.get(k),
    set: (k: string, v: string) => void mockKv.set(k, v),
    remove: (k: string) => void mockKv.delete(k),
    clearAll: () => mockKv.clear(),
  },
}));
jest.mock('@/api/client', () => ({ getApi: () => ({}) }));
jest.mock('@/api/jellyfin', () => ({
  getCustomPrefs: async (_api: unknown, userId: string) => {
    mockCalls.push(`get:${userId}`);
    if (mockHolds.get) await mockHolds.get;
    return { ...(mockPrefs.get(userId) ?? {}) };
  },
  setCustomPrefs: async (_api: unknown, userId: string, _id: string, _client: string, update: (c: Record<string, string | null>) => Record<string, string>) => {
    mockCalls.push(`set:${userId}`);
    mockPrefs.set(userId, update({ ...(mockPrefs.get(userId) ?? {}) }));
  },
}));
jest.mock('@/auth/session-store', () => {
  const { create: make } = jest.requireActual('zustand');
  return { useSessionStore: make(() => ({ session: null })) };
});
jest.mock('@/lib/online', () => {
  const { create: make } = jest.requireActual('zustand');
  return { isOffline: () => false, useOnlineStore: make(() => ({ reachable: true })) };
});
jest.mock('../manager', () => ({
  bindSession: () => undefined,
  applySynced: (changes: SyncedChanges) => mockApplySynced(changes),
}));
jest.mock('../programme-manager', () => ({ programmeIndexEnabled: () => false, startProgrammeIndex: () => undefined }));
jest.mock('../share-sync', () => {
  const { create: make } = jest.requireActual('zustand');
  return { pullShared: async () => undefined, runShares: async () => undefined, useShareStore: make(() => ({ admin: {} })) };
});
jest.mock('../secrets', () => ({ readSecrets: (id: string) => mockSecrets.get(id) ?? {} }));

// eslint-disable-next-line import/first
import { useSessionStore } from '@/auth/session-store';
// eslint-disable-next-line import/first
import { blobText, decodeChunks, EMPTY_META, localBlob, observe, withBlob } from '../account-sync';
// eslint-disable-next-line import/first
import { LISTS_SCHEMA_VERSION } from '../types';
// eslint-disable-next-line import/first
import { iptvState, setIptvState } from '../store';
// eslint-disable-next-line import/first
import { startIptvSync, syncSoon } from '../sync';

/** The apply as the manager does it: secrets and providers, then (after an await) the lists. */
async function mockApplySynced(changes: SyncedChanges): Promise<void> {
  mockApplied += 1;
  for (const [id, s] of Object.entries(changes.secrets)) mockSecrets.set(id, s);
  setIptvState({ providers: changes.providers });
  if (mockHolds.apply) await mockHolds.apply;
  setIptvState({ lists: { ...iptvState().lists, ...changes.lists } });
}

const record = (id: string, name: string): ProviderRecord => ({
  id,
  kind: 'xtream',
  name,
  // Two providers with the same login merge into one: each has its own server.
  server: `http://${id}.example.com:8080`,
  userAgent: null,
  hasGuide: true,
  createdAt: 1,
  updatedAt: 1,
  refreshedAt: null,
  channelCount: 0,
});
const P1 = record('p1', 'Panel');
const P2 = record('p2', 'Other');
const LOGIN = { username: 'jane', password: 's3cret' };

/** The display preferences of an account that has these providers. */
function remoteWith(providers: ProviderRecord[]): Record<string, string> {
  const local: LocalState = {
    providers: { schemaVersion: 1, providers: Object.fromEntries(providers.map((p) => [p.id, p])), order: providers.map((p) => p.id) },
    secrets: Object.fromEntries(providers.map((p) => [p.id, LOGIN])),
    lists: {},
    vod: {},
  };
  const text = blobText(localBlob(observe({ ...EMPTY_META, seeded: true }, local, Date.now() - 60_000), local));
  if (!text) throw new Error('blob too large');
  return withBlob({}, text);
}

/** Signs in `userId` with these providers on the device; the switch starts a pull. */
function signIn(userId: string, providers: ProviderRecord[]): void {
  for (const p of providers) mockSecrets.set(p.id, LOGIN);
  setIptvState({
    scope: `srv:${userId}`,
    providers: { schemaVersion: 1, providers: Object.fromEntries(providers.map((p) => [p.id, p])), order: providers.map((p) => p.id) },
    lists: {},
  });
  useSessionStore.setState({ session: { serverUrl: 'http://jf.example', serverId: 'srv', serverName: 'Home', serverVersion: null, userId, userName: 'Jane Doe', userImageTag: null, token: 't' } });
}

function favourite(id: string, channelId: string): void {
  setIptvState({ lists: { ...iptvState().lists, [id]: { schemaVersion: LISTS_SCHEMA_VERSION, favourites: [channelId], recents: [], snaps: {} } } });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(0);
};

beforeAll(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  startIptvSync();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  await settle();
  mockKv.clear();
  mockPrefs.clear();
  mockCalls.length = 0;
  mockSecrets.clear();
  mockHolds.get = null;
  mockHolds.apply = null;
  mockApplied = 0;
});

describe('account sync', () => {
  it('a change made during an apply is pushed', async () => {
    mockPrefs.set('a1', remoteWith([P1, P2]));
    const hold = deferred();
    mockHolds.apply = hold.promise;
    signIn('a1', [P1]);
    await settle();
    expect(mockApplied).toBe(1);
    // The person adds a favourite while the apply waits.
    favourite('p1', 'c9');
    mockHolds.apply = null;
    hold.resolve();
    await settle();
    await jest.advanceTimersByTimeAsync(3000);
    await settle();
    expect(mockCalls).toContain('set:a1');
    const blob = decodeChunks(mockPrefs.get('a1'));
    expect(blob?.favourites.p1?.c9?.del).toBeFalsy();
    expect(blob?.favourites.p1?.c9).toBeDefined();
    expect(Object.keys(blob?.providers ?? {}).sort()).toEqual(['p1', 'p2']);
  });

  it('the apply alone sends nothing', async () => {
    mockPrefs.set('b1', remoteWith([P1, P2]));
    signIn('b1', [P1]);
    await settle();
    expect(mockApplied).toBe(1);
    expect(iptvState().providers.order).toEqual(['p1', 'p2']);
    mockCalls.length = 0;
    await jest.advanceTimersByTimeAsync(5000);
    await settle();
    expect(mockCalls).toEqual([]);
  });

  it('pushes 3 seconds after the last change', async () => {
    signIn('c1', [P1]);
    await settle();
    // The device's first sync writes its providers to the account.
    expect(mockCalls).toEqual(['get:c1', 'set:c1']);
    mockCalls.length = 0;
    favourite('p1', 'c1');
    await jest.advanceTimersByTimeAsync(1000);
    favourite('p1', 'c2');
    await jest.advanceTimersByTimeAsync(2900);
    expect(mockCalls).toEqual([]);
    await jest.advanceTimersByTimeAsync(200);
    await settle();
    expect(mockCalls).toEqual(['get:c1', 'set:c1']);
  });

  it('pages pull at most every 30 seconds', async () => {
    signIn('d1', [P1]);
    await settle();
    mockCalls.length = 0;
    syncSoon();
    await settle();
    expect(mockCalls).toEqual([]);
    await jest.advanceTimersByTimeAsync(30_000);
    syncSoon();
    await settle();
    expect(mockCalls).toEqual(['get:d1']);
  });

  it('an account switch drops the queued run of the old account', async () => {
    signIn('e1', [P1]);
    await settle();
    mockCalls.length = 0;
    const hold = deferred();
    mockHolds.get = hold.promise;
    // A push for e1 runs, and a change asks for one more.
    favourite('p1', 'c1');
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockCalls).toEqual(['get:e1']);
    favourite('p1', 'c2');
    await jest.advanceTimersByTimeAsync(3000);
    // Another account signs in while the push waits for the server.
    signIn('e2', []);
    mockHolds.get = null;
    hold.resolve();
    await settle();
    // The e1 push stops (another account); its queued run does not happen; e2 pulls once.
    expect(mockCalls).toEqual(['get:e1', 'get:e2']);
  });
});
