/**
 * A pause and a resume while a download prepares (asks the server for the
 * item) must not begin the same item twice: two native tasks would write
 * one file.
 */
import type { BaseItemDto } from '@/api/types';

import { downloadManager } from '../manager';
import { downloadsState, putRecord, useDownloadsStore } from '../store';
import { rec } from '../test-utils/fixtures';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

jest.mock('../files', () => ({
  files: {
    documentsDir: () => 'file:///docs/',
    ensureDir: () => undefined,
    excludeFromBackup: () => undefined,
    listDirs: () => [],
    remove: () => undefined,
    size: () => 0,
    statSize: async () => 0,
    writeText: () => undefined,
    absolutePath: (p: string) => `/docs/${p}`,
  },
}));

const mockStart = jest.fn();
jest.mock('../engine', () => ({
  engine: {
    supported: true,
    configure: () => undefined,
    existing: async () => [],
    start: (...a: unknown[]) => mockStart(...a),
    pause: async () => undefined,
    resume: async () => false,
    stop: async () => undefined,
    finish: () => undefined,
  },
}));

/** Each getItem call waits until the test resolves it. */
const mockItems: ((item: BaseItemDto) => void)[] = [];
jest.mock('@/api/jellyfin', () => ({
  getItem: (_api: unknown, _user: string, id: string) =>
    new Promise<BaseItemDto>((resolve) => {
      mockItems.push(resolve);
      void id;
    }),
}));

jest.mock('@/api/client', () => ({ getApi: () => ({}) }));
jest.mock('@/api/auth-header', () => ({ buildAuthHeader: () => 'MediaBrowser Token="t"' }));
jest.mock('@/auth/identity', () => ({ clientIdentity: () => ({ deviceId: 'device-1' }) }));
jest.mock('@/auth/session-store', () => ({
  useSessionStore: {
    getState: () => ({
      session: { serverId: 'server-1', userId: 'user-1', serverUrl: 'http://jellyfin.test', token: 't' },
      accounts: { servers: [{ id: 'server-1', users: [{ userId: 'user-1' }] }] },
    }),
  },
  tokenFor: () => 't',
}));
jest.mock('@/player/capabilities', () => ({ mediaCapabilities: () => ({}) }));
jest.mock('@/player/device-profile', () => ({ buildDeviceProfile: () => ({ MaxStreamingBitrate: 1_000_000 }) }));
jest.mock('@/native/zoggyfin-native', () => ({ makeSeekableMp4: async () => 'skipped' }));
jest.mock('@/lib/toast', () => ({ toast: () => undefined }));

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const song: BaseItemDto = { Id: 'item-1', Name: 'Sample Song', Type: 'Audio', Container: 'mp3', AlbumId: undefined };

beforeAll(() => {
  // The manager's 5 s tick timer would keep Jest running; the tests call tick() themselves.
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
});

beforeEach(() => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  mockStart.mockClear();
  mockItems.length = 0;
});

describe('download begin', () => {
  it('starts one native task when the user pauses and resumes during the preparation', async () => {
    await downloadManager.init();
    putRecord(rec({ itemId: 'item-1', state: 'queued' }));
    downloadManager.tick();
    await flush();
    expect(downloadsState().records['item-1']?.state).toBe('downloading');
    expect(mockItems).toHaveLength(1);

    await downloadManager.pause('item-1');
    await downloadManager.resume('item-1');
    await flush();
    // The record waits in the queue: no second preparation.
    expect(downloadsState().records['item-1']?.state).toBe('queued');
    expect(mockItems).toHaveLength(1);

    // The first preparation ends: it sees the record is no longer its own and stops.
    mockItems[0]!(song);
    await flush();
    expect(mockStart).not.toHaveBeenCalled();
    // Then the queued record begins again, once.
    expect(mockItems).toHaveLength(2);
    mockItems[1]!(song);
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(downloadsState().records['item-1']?.state).toBe('downloading');
  });

  it('does not begin a record that is already downloading', async () => {
    await downloadManager.init();
    putRecord(rec({ itemId: 'item-2', state: 'queued' }));
    downloadManager.tick();
    await flush();
    expect(mockItems).toHaveLength(1);
    downloadManager.tick();
    await flush();
    expect(mockItems).toHaveLength(1);
    mockItems[0]!({ ...song, Id: 'item-2' });
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
