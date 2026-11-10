/**
 * A catalog song (not on the server's disk yet) has a stand-in id until the
 * server saves it on the first PlaybackInfo request. After that the server
 * returns the real item, with another id. The download record must move to
 * that id, with the real facts and album, and never download twice.
 */
import type { BaseItemDto } from '@/api/types';

import { buildLists } from '../lists';
import { downloadManager } from '../manager';
import { downloadsState, putCollection, putRecord, rekeySnapshot, useDownloadsStore } from '../store';
import { rec } from '../test-utils/fixtures';
import type { DownloadCollection } from '../types';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

const mockRemove = jest.fn();
jest.mock('../files', () => ({
  files: {
    documentsDir: () => 'file:///docs/',
    ensureDir: () => undefined,
    excludeFromBackup: () => undefined,
    listDirs: () => [],
    remove: (p: string) => mockRemove(p),
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

/** What GET /Users/{u}/Items/{id} returns, by id. PlaybackInfo of a catalog id swaps in the real item. */
const mockServer = {
  items: new Map<string, BaseItemDto>(),
  saved: new Map<string, BaseItemDto>(),
  calls: [] as string[],
};
jest.mock('@/api/jellyfin', () => ({
  getPlaybackInfo: async (_api: unknown, id: string) => {
    mockServer.calls.push(`info:${id}`);
    const real = mockServer.saved.get(id);
    if (real) mockServer.items.set(id, real);
    return { MediaSources: [] };
  },
  getItem: async (_api: unknown, _user: string, id: string) => {
    mockServer.calls.push(`item:${id}`);
    const item = mockServer.items.get(id);
    if (!item) throw new Error('not found');
    return item;
  },
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
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

const CATALOG_ALBUM = { id: 'cat-album', name: 'Sample Album ☁', type: 'MusicAlbum' as const };

/** A catalog song `cat-<n>` that the server saves as `real-<n>` in `real-album`. */
function catalogSong(n: number) {
  const catalog: BaseItemDto = {
    Id: `cat-${n}`,
    Name: `Song ${n} ☁`,
    Type: 'Audio',
    Container: 'mp3',
    Overview: 'Not downloaded. Plays from the catalog; the first play saves it to the library.',
    AlbumId: 'cat-album',
    Album: 'Sample Album ☁',
  };
  const real: BaseItemDto = { Id: `real-${n}`, Name: `Song ${n}`, Type: 'Audio', Container: 'mp3', AlbumId: 'real-album', Album: 'Sample Album', IndexNumber: n };
  mockServer.items.set(`cat-${n}`, catalog);
  mockServer.saved.set(`cat-${n}`, real);
  mockServer.items.set(`real-${n}`, real);
  return { catalog, real };
}

beforeAll(async () => {
  // The manager's 5 s tick timer would keep Jest running; the tests call tick() themselves.
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
  await downloadManager.init();
});

beforeEach(() => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  mockStart.mockClear();
  mockRemove.mockClear();
  mockServer.items.clear();
  mockServer.saved.clear();
  mockServer.calls.length = 0;
});

describe('download of a library song', () => {
  it('keeps the id and the facts, and asks for PlaybackInfo before the item', async () => {
    mockServer.items.set('song-1', { Id: 'song-1', Name: 'Sample Song', Type: 'Audio', Container: 'mp3', AlbumId: 'album-1', Album: 'Sample Album' });
    putRecord(rec({ itemId: 'song-1', sort: 7 }));
    downloadManager.tick();
    await flush();

    expect(mockServer.calls).toEqual(['info:song-1', 'item:song-1']);
    expect(Object.keys(downloadsState().records)).toEqual(['song-1']);
    const r = downloadsState().records['song-1']!;
    expect(r.state).toBe('downloading');
    expect(r.dir).toBe('downloads/song-1');
    expect(r.sort).toBe(7);
    expect(r.group).toEqual({ id: 'album-1', name: 'Sample Album', type: 'MusicAlbum' });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ id: 'song-1', destination: '/docs/downloads/song-1/media.mp3' });
    expect(mockRemove).not.toHaveBeenCalledWith('downloads/song-1');
  });
});

describe('download of a catalog song', () => {
  it('moves the record to the real id, with the real facts and album', async () => {
    catalogSong(1);
    catalogSong(2);
    const collection: DownloadCollection = {
      id: 'cat-album',
      serverId: 'server-1',
      type: 'MusicAlbum',
      name: 'Sample Album ☁',
      item: { Id: 'cat-album', Name: 'Sample Album ☁', Type: 'MusicAlbum' },
      itemIds: ['cat-1', 'cat-2'],
      images: {},
      dir: 'downloads/collections/cat-album',
      createdAt: 1,
    };
    putCollection(collection);
    for (const n of [1, 2]) {
      putRecord(rec({ itemId: `cat-${n}`, item: mockServer.items.get(`cat-${n}`)!, group: CATALOG_ALBUM, order: n }));
    }
    downloadManager.tick();
    await flush();

    const s = downloadsState();
    expect(Object.keys(s.records).sort()).toEqual(['real-1', 'real-2']);
    for (const n of [1, 2]) {
      const r = s.records[`real-${n}`]!;
      expect(r.itemId).toBe(`real-${n}`);
      expect(r.state).toBe('downloading');
      expect(r.item.Id).toBe(`real-${n}`);
      expect(r.item.Name).toBe(`Song ${n}`);
      expect(r.item.Overview).toBeUndefined();
      expect(r.group).toEqual({ id: 'real-album', name: 'Sample Album', type: 'MusicAlbum' });
      expect(r.dir).toBe(`downloads/real-${n}`);
      expect(r.sort).toBe(n);
      expect(mockRemove).toHaveBeenCalledWith(`downloads/cat-${n}`);
    }
    expect(s.collections['cat-album']?.itemIds).toEqual(['real-1', 'real-2']);
    expect(mockStart.mock.calls.map((c) => c[0].id).sort()).toEqual(['real-1', 'real-2']);
    expect(mockStart.mock.calls.map((c) => c[0].destination).sort()).toEqual(['/docs/downloads/real-1/media.mp3', '/docs/downloads/real-2/media.mp3']);

    // Done: one album group, with the real album name.
    for (const n of [1, 2]) putRecord({ ...downloadsState().records[`real-${n}`]!, state: 'completed', completedAt: n });
    const { groups } = buildLists(downloadsState().records, downloadsState().collections);
    expect(groups.map((g) => [g.id, g.name, g.records.length])).toEqual([['real-album', 'Sample Album', 2]]);
  });

  it('does not download again when the real id is already downloaded', async () => {
    catalogSong(3);
    putRecord(rec({ itemId: 'real-3', item: mockServer.items.get('real-3')!, state: 'completed', completedAt: 5, group: { id: 'real-album', name: 'Sample Album', type: 'MusicAlbum' } }));
    putRecord(rec({ itemId: 'cat-3', item: mockServer.items.get('cat-3')!, group: CATALOG_ALBUM }));
    downloadManager.tick();
    await flush();

    expect(Object.keys(downloadsState().records)).toEqual(['real-3']);
    expect(downloadsState().records['real-3']?.state).toBe('completed');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith('downloads/cat-3');
  });

  it('starts one download when the real id is downloading at the same time', async () => {
    catalogSong(4);
    putRecord(rec({ itemId: 'real-4', item: mockServer.items.get('real-4')!, order: 0 }));
    putRecord(rec({ itemId: 'cat-4', item: mockServer.items.get('cat-4')!, group: CATALOG_ALBUM, order: 1 }));
    downloadManager.tick();
    await flush();

    expect(Object.keys(downloadsState().records)).toEqual(['real-4']);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0].id).toBe('real-4');
  });

  it('keeps a pause made during the move, under the new id', async () => {
    catalogSong(5);
    putRecord(rec({ itemId: 'cat-5', item: mockServer.items.get('cat-5')!, group: CATALOG_ALBUM }));
    downloadManager.tick();
    // The record is preparing: pause it by its old id before the server answers.
    await downloadManager.pause('cat-5');
    await flush();

    expect(Object.keys(downloadsState().records)).toEqual(['real-5']);
    expect(downloadsState().records['real-5']?.state).toBe('paused');
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe('rekeySnapshot', () => {
  const base = rec({ itemId: 'a', group: { id: 'a', name: 'A', type: 'Single' }, bytesDone: 10, bytesTotal: 100, validator: 'etag' });
  const col = (ids: string[]): DownloadCollection => ({ id: 'p', serverId: 'server-1', type: 'Playlist', name: 'P', item: {}, itemIds: ids, images: {}, dir: 'downloads/collections/p', createdAt: 1 });

  it('moves a single item group and clears partial bytes', () => {
    const out = rekeySnapshot({ records: { a: base }, collections: { p: col(['a', 'x']) } }, 'a', 'b', 'downloads/b');
    expect(out.result).toBe('moved');
    expect(out.records.a).toBeUndefined();
    expect(out.records.b).toMatchObject({ itemId: 'b', dir: 'downloads/b', group: { id: 'b' }, bytesDone: 0, bytesTotal: null, validator: null });
    expect(out.collections.p?.itemIds).toEqual(['b', 'x']);
  });

  it('drops the old record when the new id exists, with no duplicate in collections', () => {
    const other = rec({ itemId: 'b', state: 'completed' });
    const out = rekeySnapshot({ records: { a: base, b: other }, collections: { p: col(['a', 'b']) } }, 'a', 'b', 'downloads/b');
    expect(out.result).toBe('exists');
    expect(out.records).toEqual({ b: other });
    expect(out.collections.p?.itemIds).toEqual(['b']);
  });

  it('does nothing when the record is gone', () => {
    const s = { records: {}, collections: {} };
    expect(rekeySnapshot(s, 'a', 'b', 'downloads/b').result).toBe('missing');
  });
});
