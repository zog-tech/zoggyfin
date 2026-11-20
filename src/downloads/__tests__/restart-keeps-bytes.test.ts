/**
 * A download whose system task is gone at an app start, or that failed and
 * retries, starts again with a resume hint, so the engine can continue it
 * (iOS: the library's resume data; Android: a Range request). Its byte count
 * stays. Only a transcode, which has no byte ranges, starts from 0.
 */
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
    // The restart's list came before the system gave the resume data back: nothing listed.
    existing: async () => [],
    start: (...a: unknown[]) => mockStart(...a),
    pause: async () => undefined,
    resume: async () => false,
    stop: async () => undefined,
    finish: () => undefined,
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

const film = (over: Parameters<typeof rec>[0]) =>
  rec({ kind: 'video', quality: 0, method: 'original', mediaFile: 'media.mkv', bytesDone: 4_000, bytesTotal: 9_000, validator: '"v1"', ...over });

beforeAll(() => {
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
});

beforeEach(() => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  mockStart.mockClear();
  mockDirect.value = true;
});

describe('download start after an app start or an error', () => {
  it('continues a download whose task is not listed at the app start', async () => {
    putRecord(film({ itemId: 'film-1', state: 'downloading' }));
    await downloadManager.init();
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ id: 'film-1', resume: { expectedBytes: 9_000, validator: '"v1"' } });
    expect(downloadsState().records['film-1']?.bytesDone).toBe(4_000);
  });

  it('continues a failed download at its automatic retry', async () => {
    putRecord(film({ itemId: 'film-2', state: 'failed', error: 'The network connection was lost.', attempts: 1, retryAt: Date.now() - 1 }));
    await downloadManager.init();
    downloadManager.tick();
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ id: 'film-2', resume: { expectedBytes: 9_000 } });
    expect(downloadsState().records['film-2']?.bytesDone).toBe(4_000);
  });

  it('starts a transcode from 0: it has no byte ranges', async () => {
    mockDirect.value = false;
    putRecord(film({ itemId: 'film-3', state: 'failed', method: 'transcode', mediaFile: 'media.mp4', attempts: 1, retryAt: Date.now() - 1 }));
    await downloadManager.init();
    downloadManager.tick();
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0].resume).toBeUndefined();
    expect(downloadsState().records['film-3']?.bytesDone).toBe(0);
  });
});
