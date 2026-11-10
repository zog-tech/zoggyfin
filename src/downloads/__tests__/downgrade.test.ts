/**
 * Downgrade safety: an older app (download schema v2) reads the old key. It
 * must find every Jellyfin download there after any save of this version,
 * and this version must find its extension downloads again after a rollback
 * and a return.
 */
import { extensionDir, newExtensionRecord } from '../extension-media';
import { EMPTY_SNAPSHOT, LEGACY_SCHEMA_VERSION, legacySnapshot, loadSnapshots } from '../migrate';
import { rec } from '../test-utils/fixtures';
import { DOWNLOAD_SCHEMA_VERSION, type DownloadCollection, type DownloadRecord, type DownloadsSnapshot } from '../types';

/**
 * The reader of the v2 app, rule for rule: the snapshot must say version 2,
 * and each record version 2 with an item id, a state, a folder and an item.
 * Anything else is dropped (and its folder is swept as an orphan).
 */
function v2Reader(raw: unknown): { records: Record<string, Record<string, unknown>>; collections: Record<string, unknown> } {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(raw) || raw.schemaVersion !== 2) return { records: {}, collections: {} };
  const records: Record<string, Record<string, unknown>> = {};
  for (const v of Object.values(isObject(raw.records) ? raw.records : {})) {
    if (isObject(v) && v.schemaVersion === 2 && typeof v.itemId === 'string' && typeof v.state === 'string' && typeof v.dir === 'string' && isObject(v.item)) records[v.itemId] = v;
  }
  const collections: Record<string, unknown> = {};
  for (const v of Object.values(isObject(raw.collections) ? raw.collections : {})) {
    if (isObject(v) && typeof v.id === 'string' && Array.isArray(v.itemIds) && isObject(v.item)) collections[v.id] = v;
  }
  return { records, collections };
}

/** The old app's orphan sweep: the folders it keeps. */
const keptFolders = (records: Record<string, Record<string, unknown>>) => new Set(Object.values(records).map((r) => String(r.dir).split('/')[1]));

const movie = rec({ itemId: 'movie-1', kind: 'video', state: 'completed', dir: 'downloads/movie-1', mediaFile: 'media.mkv', item: { Id: 'movie-1', Name: 'Sample Movie', Type: 'Movie' }, group: { id: 'movie-1', name: 'Sample Movie', type: 'Single' } });
const song = rec({ itemId: 'song-1', state: 'completed', dir: 'downloads/song-1', mediaFile: 'media.flac' });
const ext: DownloadRecord = {
  ...newExtensionRecord(
    { extension: 'org.example.media', mediaId: 'e1', download: 'https://media.example.org/api/e1/download', title: 'An entry', duration: 700 },
    { serverId: 'server-1', userId: 'user-1', baseUrl: 'https://media.example.org', kind: 'video', order: 2, now: 5 },
  ),
  state: 'completed',
  mediaFile: 'media.mp4',
};
const album: DownloadCollection = { id: 'album-1', itemIds: ['song-1'], item: { Id: 'album-1', Name: 'Sample Album', Type: 'MusicAlbum' } } as DownloadCollection;

const snapshot: DownloadsSnapshot = { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: { [movie.itemId]: movie, [song.itemId]: song, [ext.itemId]: ext }, collections: { [album.id]: album } };

/** What the store writes: the v3 key and the old key. */
const save = (s: Pick<DownloadsSnapshot, 'records' | 'collections'>) => ({
  current: JSON.parse(JSON.stringify({ schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: s.records, collections: s.collections })),
  legacy: JSON.parse(JSON.stringify(legacySnapshot(s))),
});

describe('the v2 copy under the old key', () => {
  it('is read whole by the v2 reader: every Jellyfin record and collection, no extension record', () => {
    const old = v2Reader(save(snapshot).legacy);
    expect(Object.keys(old.records).sort()).toEqual(['movie-1', 'song-1']);
    expect(old.collections['album-1']).toEqual(album);
    for (const r of Object.values(old.records)) {
      expect(r.schemaVersion).toBe(LEGACY_SCHEMA_VERSION);
      expect(r).not.toHaveProperty('source');
    }
    const { source: _s, schemaVersion: _v, ...rest } = movie;
    expect(old.records['movie-1']).toEqual({ ...rest, schemaVersion: 2 });
  });

  it("the old sweep keeps the Jellyfin folders; the extension folder is swept (accepted)", () => {
    const kept = keptFolders(v2Reader(save(snapshot).legacy).records);
    expect(kept.has('movie-1')).toBe(true);
    expect(kept.has('song-1')).toBe(true);
    expect(kept.has(extensionDir('org.example.media', 'e1').split('/')[1]!)).toBe(false);
  });

  it('the v2 reader keeps nothing of the v3 snapshot: the reason for the second key', () => {
    expect(v2Reader(save(snapshot).current).records).toEqual({});
  });
});

describe('loadSnapshots', () => {
  it('round trip: both keys load back to the same snapshot', () => {
    const { current, legacy } = save(snapshot);
    expect(loadSnapshots(legacy, current)).toEqual(snapshot);
  });

  it('a rollback and a return: Jellyfin changes of the older app win, the extension download comes back', () => {
    const { current, legacy } = save(snapshot);
    // The older app reads its copy, deletes the movie, adds an episode, and saves as v2.
    const old = v2Reader(legacy);
    delete old.records['movie-1'];
    const episode = { ...rec({ itemId: 'ep-1', kind: 'video', state: 'completed', dir: 'downloads/ep-1' }), schemaVersion: 2 } as Record<string, unknown>;
    delete episode.source;
    old.records['ep-1'] = episode;
    const written = JSON.parse(JSON.stringify({ schemaVersion: 2, records: old.records, collections: old.collections }));

    const back = loadSnapshots(written, current);
    expect(Object.keys(back.records).sort()).toEqual(['ep-1', ext.itemId, 'song-1'].sort());
    expect(back.records['ep-1']!.source).toEqual({ kind: 'jellyfin' });
    expect(back.records[ext.itemId]).toEqual(ext);
    expect(back.collections['album-1']).toEqual(album);
    // And forward again: the next save gives the older app the same Jellyfin list.
    expect(Object.keys(v2Reader(save(back).legacy).records).sort()).toEqual(['ep-1', 'song-1']);
  });

  it('the first start of this version reads the old key alone (v2, or an early v3 with extension records)', () => {
    const v2 = save(snapshot).legacy;
    expect(Object.keys(loadSnapshots(v2, null).records).sort()).toEqual(['movie-1', 'song-1']);
    const early = save(snapshot).current;
    expect(loadSnapshots(early, null)).toEqual(snapshot);
  });

  it('an unknown or damaged old key falls back to the v3 key, and nothing ever throws', () => {
    const { current } = save(snapshot);
    expect(loadSnapshots({ schemaVersion: 9, records: {} }, current)).toEqual(snapshot);
    expect(loadSnapshots('x', current)).toEqual(snapshot);
    expect(loadSnapshots(null, null)).toEqual(EMPTY_SNAPSHOT);
    expect(loadSnapshots({ schemaVersion: 2, records: 5 }, { schemaVersion: 3, records: null })).toEqual(EMPTY_SNAPSHOT);
  });
});
