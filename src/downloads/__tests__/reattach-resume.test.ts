/**
 * After an app restart, iOS lists a download that kept resume data as a
 * paused task. One the user paused stays paused; one that failed (a lost
 * connection) continues at once from its resume data, not from byte 0.
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
const mockResume = jest.fn(async () => true);
const mockPause = jest.fn(async () => undefined);
jest.mock('../engine', () => ({
  engine: {
    supported: true,
    configure: () => undefined,
    // iOS lists a task that kept resume data as paused, whether the user paused it or it failed.
    existing: async () => [
      { id: 'failed-1', state: 'paused', bytesDone: 4_000, bytesTotal: 9_000 },
      { id: 'paused-1', state: 'paused', bytesDone: 2_000, bytesTotal: 9_000 },
      // A task that waits for an iOS retry: the library gives the bytes of the new try.
      { id: 'waiting-1', state: 'downloading', bytesDone: 0, bytesTotal: 0 },
    ],
    start: (...a: unknown[]) => mockStart(...a),
    pause: (...a: unknown[]) => mockPause(...(a as [])),
    resume: (...a: unknown[]) => mockResume(...(a as [])),
    stop: async () => undefined,
    finish: () => undefined,
  },
}));

jest.mock('@/api/jellyfin', () => ({ getItem: async () => ({}), getPlaybackInfo: async () => ({ MediaSources: [] }) }));

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeAll(() => {
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
});

describe('download reattach after a restart', () => {
  it('continues a failed download from its resume data and keeps a paused one paused', async () => {
    useDownloadsStore.setState({ records: {}, collections: {} });
    putRecord(rec({ itemId: 'failed-1', state: 'failed', bytesDone: 4_000, bytesTotal: 9_000, error: 'The request timed out.', attempts: 1, retryAt: Date.now() + 60_000 }));
    putRecord(rec({ itemId: 'paused-1', state: 'paused', bytesDone: 2_000, bytesTotal: 9_000 }));
    putRecord(rec({ itemId: 'waiting-1', state: 'downloading', bytesDone: 821_000, bytesTotal: 2_459_000 }));
    await downloadManager.init();
    await flush();

    const failed = downloadsState().records['failed-1'];
    expect(failed?.state).toBe('downloading');
    expect(failed?.bytesDone).toBe(4_000);
    expect(failed?.error).toBeNull();
    expect(mockResume).toHaveBeenCalledWith('failed-1');

    expect(downloadsState().records['paused-1']?.state).toBe('paused');
    expect(mockResume).not.toHaveBeenCalledWith('paused-1');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('keeps the byte count of a task that iOS lists with 0 bytes while it waits for a retry', () => {
    const waiting = downloadsState().records['waiting-1'];
    expect(waiting?.state).toBe('downloading');
    expect(waiting?.bytesDone).toBe(821_000);
    expect(waiting?.bytesTotal).toBe(2_459_000);
  });
});
