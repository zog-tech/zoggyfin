import { collectionCounts } from '../store';
import { rec } from '../test-utils/fixtures';
import type { DownloadCollection } from '../types';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

const album = (itemIds: string[]): DownloadCollection => ({ id: 'al', serverId: 's', type: 'MusicAlbum', name: 'Sample Album', item: { Id: 'al' }, itemIds, images: {}, dir: 'd', createdAt: 0 });

describe('collectionCounts', () => {
  it('counts the finished items of a container', () => {
    const records = {
      a: rec({ itemId: 'a', state: 'completed' }),
      b: rec({ itemId: 'b', state: 'downloading', bytesDone: 50, bytesTotal: 100 }),
      c: rec({ itemId: 'c', state: 'queued' }),
    };
    expect(collectionCounts(album(['a', 'b', 'c']), records)).toEqual({ done: 1, total: 3 });
  });

  it('leaves out cancelled and missing items', () => {
    const records = { a: rec({ itemId: 'a', state: 'completed' }), b: rec({ itemId: 'b', state: 'cancelled' }) };
    expect(collectionCounts(album(['a', 'b', 'gone']), records)).toEqual({ done: 1, total: 1 });
  });

  it('is null for an id that is not a container, or a container with nothing left', () => {
    expect(collectionCounts(undefined, {})).toBeNull();
    expect(collectionCounts(album(['b']), { b: rec({ itemId: 'b', state: 'cancelled' }) })).toBeNull();
  });
});
