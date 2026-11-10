/**
 * Schema version 3 adds the record source. A v2 snapshot from a device must
 * come through whole, with `jellyfin` on every record; a damaged one keeps
 * what it can and never throws. Extension record ids never meet Jellyfin ids.
 */
import { extensionDir, extensionRecordId, newExtensionRecord } from '../extension-media';
import { EMPTY_SNAPSHOT, migrateSnapshot } from '../migrate';
import { DOWNLOAD_SCHEMA_VERSION } from '../types';

/** A v2 snapshot as an earlier app saved it: a movie, an episode in a season download, a song. */
const v2 = {
  schemaVersion: 2,
  records: {
    '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70': {
      schemaVersion: 2,
      itemId: '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70',
      serverId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      userId: '0f9e8d7c6b5a49382716f5e4d3c2b1a0',
      kind: 'video',
      item: { Id: '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70', Name: 'Sample Movie', Type: 'Movie', ProductionYear: 2021, RunTimeTicks: 72_000_000_000 },
      group: { id: '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70', name: 'Sample Movie', type: 'Single' },
      sort: 0,
      state: 'completed',
      bytesTotal: 1_500_000_000,
      bytesDone: 1_500_000_000,
      speed: 0,
      progressAt: null,
      attempts: 0,
      retryAt: null,
      error: null,
      dir: 'downloads/6f2d9a64c0f14c7e9c1e2b3a4d5e6f70',
      mediaFile: 'media.mkv',
      mediaSourceId: '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70',
      validator: '"abc123"',
      method: 'original',
      quality: 0,
      images: { primary: 'primary.jpg', backdrop: 'backdrop.jpg' },
      subtitles: [{ index: 3, label: 'English', language: 'eng', isDefault: true, isForced: false, file: 'subtitle-3.vtt' }],
      hasLyrics: false,
      order: 0,
      createdAt: 1_760_000_000_000,
      completedAt: 1_760_000_600_000,
    },
    ep1: {
      schemaVersion: 2,
      itemId: 'ep1',
      serverId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      userId: '0f9e8d7c6b5a49382716f5e4d3c2b1a0',
      kind: 'video',
      item: { Id: 'ep1', Name: 'Pilot', Type: 'Episode', SeriesName: 'Sample Show', ParentIndexNumber: 1, IndexNumber: 1 },
      group: { id: 'show1', name: 'Sample Show', type: 'Series' },
      sort: 10001,
      state: 'downloading',
      bytesTotal: 400,
      bytesDone: 120,
      speed: 5000,
      progressAt: 1_760_000_000_000,
      attempts: 1,
      retryAt: null,
      error: null,
      dir: 'downloads/ep1',
      mediaFile: 'media.mp4',
      mediaSourceId: 'ep1',
      method: 'transcode',
      quality: 720,
      images: {},
      subtitles: [],
      hasLyrics: false,
      order: 1,
      createdAt: 1_760_000_000_000,
      completedAt: null,
    },
    song1: {
      schemaVersion: 2,
      itemId: 'song1',
      serverId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      userId: '0f9e8d7c6b5a49382716f5e4d3c2b1a0',
      kind: 'audio',
      item: { Id: 'song1', Name: 'Sample Song', Type: 'Audio', Album: 'Sample Album', AlbumId: 'album1' },
      group: { id: 'album1', name: 'Sample Album', type: 'MusicAlbum' },
      sort: 1001,
      state: 'paused',
      bytesTotal: 9000,
      bytesDone: 3000,
      speed: 0,
      progressAt: null,
      attempts: 0,
      retryAt: null,
      error: null,
      dir: 'downloads/song1',
      mediaFile: 'media.mp3',
      mediaSourceId: 'song1',
      method: 'original',
      quality: 0,
      images: { primary: 'primary.jpg' },
      subtitles: [],
      hasLyrics: true,
      order: 2,
      createdAt: 1_760_000_000_000,
      completedAt: null,
    },
  },
  collections: {
    season1: { id: 'season1', serverId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', type: 'Season', name: 'Season 1', item: { Id: 'season1', Name: 'Season 1' }, itemIds: ['ep1'], images: {}, dir: 'downloads/collections/season1', createdAt: 1 },
  },
};

describe('v2 → v3', () => {
  it('keeps every v2 record and sets the Jellyfin source on each', () => {
    const out = migrateSnapshot(JSON.parse(JSON.stringify(v2)));
    expect(out.schemaVersion).toBe(DOWNLOAD_SCHEMA_VERSION);
    expect(DOWNLOAD_SCHEMA_VERSION).toBe(3);
    expect(Object.keys(out.records).sort()).toEqual(['6f2d9a64c0f14c7e9c1e2b3a4d5e6f70', 'ep1', 'song1']);
    for (const r of Object.values(out.records)) {
      expect(r.source).toEqual({ kind: 'jellyfin' });
      expect(r.schemaVersion).toBe(3);
    }
    const movie = out.records['6f2d9a64c0f14c7e9c1e2b3a4d5e6f70']!;
    const { source: _s, schemaVersion: _v, ...rest } = movie;
    const { schemaVersion: _ov, ...old } = v2.records['6f2d9a64c0f14c7e9c1e2b3a4d5e6f70'];
    // Nothing else changes on a completed record.
    expect(rest).toEqual(old);
    // A running download goes back to the queue, as before.
    expect(out.records.ep1!.state).toBe('queued');
    expect(out.records.ep1!.speed).toBe(0);
    expect(out.records.song1!.state).toBe('paused');
    expect(out.records.song1!.bytesDone).toBe(3000);
    expect(Object.keys(out.collections)).toEqual(['season1']);
  });

  it('reads a damaged v2 snapshot without throwing and keeps the good records', () => {
    const damaged = {
      schemaVersion: 2,
      records: {
        ...JSON.parse(JSON.stringify(v2.records)),
        nul: null,
        str: 'not a record',
        arr: [1, 2],
        noDir: { schemaVersion: 2, itemId: 'noDir', state: 'completed', item: {} },
        badItem: { schemaVersion: 2, itemId: 'badItem', state: 'completed', dir: 'downloads/badItem', item: 'x' },
        // A v2 record with a source field that an older bug wrote: still a Jellyfin item.
        odd: { ...JSON.parse(JSON.stringify(v2.records.song1)), itemId: 'odd', source: 'garbage' },
      },
      collections: 'not an object',
    };
    let out = EMPTY_SNAPSHOT;
    expect(() => {
      out = migrateSnapshot(damaged);
    }).not.toThrow();
    expect(Object.keys(out.records).sort()).toEqual(['6f2d9a64c0f14c7e9c1e2b3a4d5e6f70', 'ep1', 'odd', 'song1']);
    expect(out.records.odd!.source).toEqual({ kind: 'jellyfin' });
    expect(out.collections).toEqual({});
    expect(() => migrateSnapshot({ schemaVersion: 2, records: null, collections: null })).not.toThrow();
    expect(() => migrateSnapshot({ schemaVersion: 2, records: [null, 'x'] })).not.toThrow();
  });
});

describe('v3 records', () => {
  const ext = newExtensionRecord(
    { extension: 'org.example.media', mediaId: 'e1', download: 'https://media.example.org/api/e1/download', title: 'An entry', image: '/img/e1.jpg', duration: 700 },
    { serverId: 'server-1', userId: 'user-1', baseUrl: 'https://media.example.org', kind: 'video', order: 0, now: 5 },
  );

  it('keeps an extension record with its source through a save and a load', () => {
    const saved = JSON.parse(JSON.stringify({ schemaVersion: 3, records: { [ext.itemId]: { ...ext, state: 'completed', mediaFile: 'media.mp4', source: { ...ext.source, position: 42, report: { url: 'https://media.example.org/p', intervalSeconds: 10 } } } }, collections: {} }));
    const out = migrateSnapshot(saved);
    const r = out.records[ext.itemId]!;
    expect(r.source).toEqual({
      kind: 'extension',
      extId: 'org.example.media',
      mediaId: 'e1',
      account: 'server-1.user-1',
      download: 'https://media.example.org/api/e1/download',
      title: 'An entry',
      imageUrl: 'https://media.example.org/img/e1.jpg',
      duration: 700,
      position: 42,
      report: { url: 'https://media.example.org/p', intervalSeconds: 10 },
    });
  });

  it('drops an extension record whose source is damaged, and keeps the others', () => {
    const out = migrateSnapshot({
      schemaVersion: 3,
      records: {
        [ext.itemId]: { ...ext, source: { kind: 'extension', extId: 'org.example.media' } },
        'ext:x:y': { ...ext, itemId: 'ext:x:y', source: undefined },
        j: { ...ext, itemId: 'j', source: { kind: 'jellyfin' } },
        k: { ...ext, itemId: 'k', source: undefined },
        bad: { ...ext, itemId: 'bad', source: { kind: 'other' } },
      },
      collections: {},
    });
    expect(Object.keys(out.records).sort()).toEqual(['j', 'k']);
    expect(out.records.k!.source).toEqual({ kind: 'jellyfin' });
  });

  it('keeps nothing from a newer schema (a downgrade)', () => {
    expect(migrateSnapshot({ schemaVersion: 4, records: { a: ext } })).toEqual(EMPTY_SNAPSHOT);
  });
});

describe('extension record ids', () => {
  it('have the ext: form and never match a Jellyfin id', () => {
    expect(extensionRecordId('org.example.media', 'e1')).toBe('ext:org.example.media:e1');
    // Jellyfin ids are 32 hex characters (or a dashed GUID): never with a colon.
    const jellyfin = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;
    for (const [e, m] of [
      ['a', 'b'],
      ['org.example.media', '6f2d9a64c0f14c7e9c1e2b3a4d5e6f70'],
    ]) {
      expect(extensionRecordId(e!, m!)).not.toMatch(jellyfin);
      expect(extensionRecordId(e!, m!).startsWith('ext:')).toBe(true);
    }
  });

  it('give each media its own folder, also when the ids clean to the same name', () => {
    const a = extensionDir('org.example.media', 'a/b');
    const b = extensionDir('org.example.media', 'a?b');
    const c = extensionDir('org.example', 'media-a/b');
    expect(new Set([a, b, c]).size).toBe(3);
    for (const d of [a, b, c]) expect(d).toMatch(/^downloads\/ext-[A-Za-z0-9._-]+$/);
    expect(extensionDir('x', 'y')).toBe(extensionDir('x', 'y'));
  });

  it('a record keeps only an image on the extension origin', () => {
    const off = newExtensionRecord(
      { extension: 'e', mediaId: 'm', download: 'https://media.example.org/d', title: 'T', image: 'https://other.example.net/i.jpg' },
      { serverId: 's', userId: 'u', baseUrl: 'https://media.example.org', kind: 'audio', order: 3, now: 1 },
    );
    expect(off.source).not.toHaveProperty('imageUrl');
    expect(off.item).toMatchObject({ Id: 'ext:e:m', Name: 'T', Type: 'Audio' });
  });
});
