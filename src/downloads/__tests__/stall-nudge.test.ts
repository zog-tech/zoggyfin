/**
 * A running download that gets no bytes: the row drops the old speed, and on
 * iOS (an engine with `nudge`) the manager continues it from its resume data
 * after a minute, only with the app in front and the server reachable. When
 * the system kept nothing, the queue starts the download again.
 */
import { AppState } from 'react-native';

import { useOnlineStore } from '@/lib/online';

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
const mockNudge = jest.fn(async (_id: string, _wanted: () => boolean) => true);
jest.mock('../engine', () => ({
  engine: {
    supported: true,
    configure: () => undefined,
    existing: async () => [{ id: 'film-1', state: 'downloading', bytesDone: 821_000, bytesTotal: 2_459_000 }],
    start: (...a: unknown[]) => mockStart(...a),
    pause: async () => undefined,
    resume: async () => true,
    stop: async () => undefined,
    finish: () => undefined,
    nudge: (id: string, wanted: () => boolean) => mockNudge(id, wanted),
  },
}));

const mockDirect = { value: true };
jest.mock('@/api/jellyfin', () => ({
  getItem: async (_api: unknown, _user: string, id: string) => ({ Id: id, Name: 'Sample Film', Type: 'Movie' }),
  getPlaybackInfo: async (_api: unknown, id: string) => ({
    PlaySessionId: 'p1',
    MediaSources: [{ Id: id, Container: 'mkv', Size: 9_000, SupportsDirectPlay: mockDirect.value, MediaStreams: [{ Type: 'Video', Height: 2160 }] }],
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
jest.mock('@/player/capabilities', () => ({ mediaCapabilities: () => ({}), audioCapabilities: () => ({}) }));
jest.mock('@/player/device-profile', () => ({ buildDeviceProfile: () => ({ MaxStreamingBitrate: 1_000_000 }) }));
jest.mock('@/native/zoggyfin-native', () => ({ makeSeekableMp4: async () => 'skipped' }));
jest.mock('@/lib/toast', () => ({ toast: () => undefined }));

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let now = 1_000_000_000;
beforeAll(() => {
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

beforeEach(async () => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  putRecord(rec({ itemId: 'film-1', kind: 'video', quality: 0, method: 'original', mediaFile: 'media.mkv', state: 'downloading', bytesDone: 821_000, bytesTotal: 2_459_000, speed: 3_000_000, validator: '"v1"' }));
  mockStart.mockClear();
  mockNudge.mockClear();
  (AppState as { currentState: string }).currentState = 'active';
  useOnlineStore.setState({ reachable: true });
});

describe('stalled downloads', () => {
  it('drops the old speed, then nudges after a minute; a nudge that continues needs nothing more', async () => {
    await downloadManager.init();
    await flush();
    expect(downloadsState().records['film-1']?.state).toBe('downloading');
    now += 16_000;
    downloadManager.tick();
    expect(downloadsState().records['film-1']?.speed).toBe(0);
    expect(mockNudge).not.toHaveBeenCalled();
    now += 45_000;
    downloadManager.tick();
    await flush();
    expect(mockNudge).toHaveBeenCalledTimes(1);
    expect(mockNudge.mock.calls[0][1]()).toBe(true);
    expect(mockStart).not.toHaveBeenCalled();
    // Not again within 3 minutes.
    now += 60_000;
    downloadManager.tick();
    expect(mockNudge).toHaveBeenCalledTimes(1);
  });

  it('never nudges in the background or while the server does not answer', async () => {
    now += 10 * 60_000;
    putRecord({ ...downloadsState().records['film-1']!, progressAt: now - 120_000 });
    (AppState as { currentState: string }).currentState = 'background';
    downloadManager.tick();
    useOnlineStore.setState({ reachable: false });
    (AppState as { currentState: string }).currentState = 'active';
    downloadManager.tick();
    await flush();
    expect(mockNudge).not.toHaveBeenCalled();
  });

  it('starts the download again, with the resume hint, when the system kept nothing', async () => {
    now += 10 * 60_000;
    putRecord({ ...downloadsState().records['film-1']!, progressAt: now - 120_000 });
    mockNudge.mockResolvedValueOnce(false);
    downloadManager.tick();
    await flush();
    expect(mockNudge).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ id: 'film-1', resume: { expectedBytes: 2_459_000, validator: '"v1"' } });
    expect(downloadsState().records['film-1']?.bytesDone).toBe(821_000);
  });
});
