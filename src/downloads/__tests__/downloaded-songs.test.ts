import { buildDownloadedSongs } from '../lists';
import { rec } from '../test-utils/fixtures';

const done = (over: Parameters<typeof rec>[0]) => rec({ state: 'completed', bytesDone: 100, mediaFile: 'media.mp3', ...over });

const records = Object.fromEntries(
  [
    done({ itemId: 'old', completedAt: 1000 }),
    done({ itemId: 'new', completedAt: 3000 }),
    done({ itemId: 'legacy', completedAt: 2000, serverId: '' }),
    done({ itemId: 'far', completedAt: 4000, serverId: 'server-2' }),
    done({ itemId: 'film', completedAt: 5000, kind: 'video', item: { Id: 'film', Name: 'Film', Type: 'Movie' } }),
    done({ itemId: 'chapter', completedAt: 5000, item: { Id: 'chapter', Name: 'Chapter 1', Type: 'AudioBook' } }),
    done({ itemId: 'ext', completedAt: 5000, source: { kind: 'extension', extId: 'sample', mediaId: 'm1', account: 'server-1.user-1', download: 'https://example.com/m1', title: 'Sample' } }),
    rec({ itemId: 'busy', state: 'downloading' }),
  ].map((r) => [r.itemId, r]),
);

describe('buildDownloadedSongs', () => {
  it('lists the completed songs of the server, the newest first', () => {
    expect(buildDownloadedSongs(records, 'server-1').map((r) => r.itemId)).toEqual(['new', 'legacy', 'old']);
  });

  it('leaves out other servers, videos, audiobooks, extension media and unfinished downloads', () => {
    const ids = buildDownloadedSongs(records, 'server-1').map((r) => r.itemId);
    for (const id of ['far', 'film', 'chapter', 'ext', 'busy']) expect(ids).not.toContain(id);
  });

  it('keeps album order for songs that finished at the same time', () => {
    const same = Object.fromEntries(
      [done({ itemId: 't2', completedAt: 1000, sort: 2 }), done({ itemId: 't1', completedAt: 1000, sort: 1 })].map((r) => [r.itemId, r]),
    );
    expect(buildDownloadedSongs(same, 'server-1').map((r) => r.itemId)).toEqual(['t1', 't2']);
  });
});
