/**
 * The admin path of provider sharing with a fake server: sharing writes each
 * chosen user's shared blob and never the user's own synced blob, an untick
 * removes it, "Everyone" reaches a user added later, a non-admin writes
 * nothing, and the user's device gets the provider.
 */
import { useSessionStore } from '@/auth/session-store';

import { SHARED_PREFS_ID } from '../shared';
import { setIptvState } from '../store';

const mockPrefs = new Map<string, Record<string, string | null>>();
const mockUsers = [
  { id: 'admin1', name: 'Sam' },
  { id: 'u1', name: 'Jane Doe' },
  { id: 'u2', name: 'Alex' },
];
let mockAdmin = true;
const mockWrites: string[] = [];
const mockKv = new Map<string, string>();

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
  getCustomPrefs: async (_api: unknown, userId: string, id: string) => ({ ...(mockPrefs.get(`${userId}|${id}`) ?? {}) }),
  setCustomPrefs: async (_api: unknown, userId: string, id: string, _client: string, update: (c: Record<string, string | null>) => Record<string, string>) => {
    mockWrites.push(`${userId}|${id}`);
    mockPrefs.set(`${userId}|${id}`, update({ ...(mockPrefs.get(`${userId}|${id}`) ?? {}) }));
  },
  getUsers: async () => mockUsers.slice(),
  isAdministrator: async () => mockAdmin,
}));
const mockApplied: { upsert: unknown[]; remove: string[] }[] = [];
jest.mock('../manager', () => ({
  bindSession: () => undefined,
  applyShared: async (upsert: unknown[], remove: string[]) => void mockApplied.push({ upsert, remove }),
}));
jest.mock('../secrets', () => ({
  readSecrets: (id: string) => (id === 'p1' ? { username: 'jane', password: 'hunter2' } : {}),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const shareSync = require('../share-sync') as typeof import('../share-sync');

function signIn(userId: string, userName: string): void {
  useSessionStore.setState({ session: { serverUrl: 'http://jf.example', serverId: 'srv', serverName: 'Home', serverVersion: null, userId, userName, userImageTag: null, token: `t-${userId}` } });
  setIptvState({
    scope: `srv:${userId}`,
    providers: {
      schemaVersion: 1,
      order: userId === 'admin1' ? ['p1'] : [],
      providers:
        userId === 'admin1'
          ? { p1: { id: 'p1', kind: 'xtream', name: 'Panel', server: 'http://panel.example:8080', userAgent: null, hasGuide: true, createdAt: 1, updatedAt: 1, refreshedAt: 1, channelCount: 3 } }
          : {},
    },
  });
  shareSync.useShareStore.setState({ admin: {}, choices: {} });
}

const sharedOf = (userId: string) => {
  const v = mockPrefs.get(`${userId}|${SHARED_PREFS_ID}`)?.shared;
  return v ? (JSON.parse(v) as { providers: Record<string, { by: { userId: string }; secrets: Record<string, string> }> }) : null;
};

beforeEach(() => {
  mockPrefs.clear();
  mockWrites.length = 0;
  mockApplied.length = 0;
  mockKv.clear();
  mockAdmin = true;
});

describe('an admin shares a provider', () => {
  it('writes the chosen user shared blob, and an untick removes it', async () => {
    signIn('admin1', 'Sam');
    await shareSync.setShareChoice('p1', { everyone: false, users: ['u1'] });
    expect(sharedOf('u1')?.providers.p1.by.userId).toBe('admin1');
    expect(sharedOf('u1')?.providers.p1.secrets.password).toBe('hunter2');
    expect(sharedOf('u2')).toBeNull();
    // Only the shared-providers entry is written, never a user's own synced blob.
    expect(mockWrites.every((w) => w.endsWith(`|${SHARED_PREFS_ID}`))).toBe(true);
    await shareSync.setShareChoice('p1', null);
    expect(sharedOf('u1')).toBeNull();
  });

  it('"Everyone" reaches a user added later on the next run', async () => {
    signIn('admin1', 'Sam');
    await shareSync.setShareChoice('p1', { everyone: true, users: [] });
    expect(sharedOf('u1')).not.toBeNull();
    expect(sharedOf('u2')).not.toBeNull();
    expect(sharedOf('admin1')).toBeNull();
    mockUsers.push({ id: 'u3', name: 'Lee' });
    await shareSync.runShares(true);
    expect(sharedOf('u3')).not.toBeNull();
    mockUsers.pop();
  });

  it('a removed provider leaves the users', async () => {
    signIn('admin1', 'Sam');
    await shareSync.setShareChoice('p1', { everyone: false, users: ['u1', 'u2'] });
    setIptvState({ providers: { schemaVersion: 1, order: [], providers: {} } });
    await shareSync.runShares(true);
    expect(sharedOf('u1')).toBeNull();
    expect(sharedOf('u2')).toBeNull();
  });

  it('a user who is not an admin writes nothing', async () => {
    signIn('u1', 'Jane Doe');
    mockAdmin = false;
    mockPrefs.set(`u1|${SHARED_PREFS_ID}`, { sharing: JSON.stringify({ schemaVersion: 1, providers: { p1: { everyone: true, users: [] } } }) });
    mockWrites.length = 0;
    await shareSync.runShares(true);
    expect(mockWrites).toEqual([]);
  });
});

describe('the user device', () => {
  it('gets the provider shared with the user', async () => {
    signIn('admin1', 'Sam');
    await shareSync.setShareChoice('p1', { everyone: false, users: ['u1'] });
    signIn('u1', 'Jane Doe');
    await shareSync.pullShared();
    expect(mockApplied).toHaveLength(1);
    expect(mockApplied[0].upsert).toEqual([expect.objectContaining({ record: expect.objectContaining({ id: 'sh_p1', sharedBy: { userId: 'admin1', name: 'Sam' } }) })]);
  });
});
