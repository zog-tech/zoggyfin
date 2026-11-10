import type { BaseItemDto } from '@/api/types';

import { firstFilled, genreSongs, mixSeeds, mixSubtitle, orderByIds, rediscoverAlbumIds, topMusicGenres } from '../home-rules';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function song(p: {
  plays?: number;
  artists?: [string, string][];
  genres?: [string, string][];
  album?: string;
  lastDaysAgo?: number;
}): BaseItemDto {
  return {
    Type: 'Audio',
    AlbumId: p.album,
    ArtistItems: (p.artists ?? []).map(([Id, Name]) => ({ Id, Name })),
    GenreItems: (p.genres ?? []).map(([Id, Name]) => ({ Id, Name })),
    UserData: { Key: 'k', PlayCount: p.plays, LastPlayedDate: p.lastDaysAgo === undefined ? undefined : ago(p.lastDaysAgo) },
  };
}

describe('mixSeeds', () => {
  it('ranks artists and genres by plays and takes them in turn', () => {
    const seeds = mixSeeds([
      song({ plays: 10, artists: [['a1', 'Jane Doe']], genres: [['g1', 'Rock']] }),
      song({ plays: 3, artists: [['a2', 'Sam']], genres: [['g2', 'Jazz']] }),
      song({ plays: 5, artists: [['a2', 'Sam']], genres: [['g2', 'Jazz']] }),
      song({ plays: 1, artists: [['a3', 'Alex']], genres: [['g1', 'Rock']] }),
    ]);
    expect(seeds.map((s) => s.id)).toEqual(['a1', 'g1', 'a2', 'g2', 'a3']);
    expect(seeds[0]).toEqual({ id: 'a1', kind: 'artist', name: 'Jane Doe' });
    expect(seeds[1]?.kind).toBe('genre');
  });

  it('counts a played song with no play count once, and skips entries with no id or name', () => {
    const seeds = mixSeeds([
      song({ artists: [['a1', 'Jane Doe']] }),
      song({ plays: 0, artists: [['a2', 'Sam'], ['', 'No id'], ['a9', '  ']] }),
      song({ artists: [['a2', 'Sam']] }),
    ]);
    expect(seeds.map((s) => s.id)).toEqual(['a2', 'a1']);
  });

  it('caps the number of mixes and keeps going with one kind when the other runs out', () => {
    const songs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => song({ plays: 10 - i, artists: [[id, id.toUpperCase()]] }));
    songs.push(song({ plays: 1, genres: [['g1', 'Rock']] }));
    const seeds = mixSeeds(songs, 4);
    expect(seeds.map((s) => s.id)).toEqual(['a', 'g1', 'b', 'c']);
  });

  it('is empty with no songs', () => {
    expect(mixSeeds(undefined)).toEqual([]);
    expect(mixSeeds([])).toEqual([]);
  });
});

describe('rediscoverAlbumIds', () => {
  it('keeps albums whose newest play is older than the limit, most played first', () => {
    const ids = rediscoverAlbumIds(
      [
        song({ album: 'old-small', plays: 2, lastDaysAgo: 100 }),
        song({ album: 'old-big', plays: 5, lastDaysAgo: 90 }),
        song({ album: 'old-big', plays: 5, lastDaysAgo: 200 }),
        song({ album: 'recent', plays: 50, lastDaysAgo: 400 }),
        song({ album: 'recent', plays: 1, lastDaysAgo: 3 }),
      ],
      NOW,
    );
    expect(ids).toEqual(['old-big', 'old-small']);
  });

  it('leaves out songs with no album and albums with no known last play', () => {
    expect(rediscoverAlbumIds([song({ plays: 9, lastDaysAgo: 100 }), song({ album: 'x', plays: 9 })], NOW)).toEqual([]);
  });

  it('takes the limit and the cap as parameters', () => {
    const songs = [song({ album: 'a', plays: 3, lastDaysAgo: 10 }), song({ album: 'b', plays: 2, lastDaysAgo: 20 }), song({ album: 'c', plays: 1, lastDaysAgo: 30 })];
    expect(rediscoverAlbumIds(songs, NOW, 5, 2)).toEqual(['a', 'b']);
    expect(rediscoverAlbumIds(songs, NOW, 15)).toEqual(['b', 'c']);
  });
});

describe('orderByIds', () => {
  it('orders items as the ids and skips missing ones', () => {
    const items: BaseItemDto[] = [{ Id: 'b' }, { Id: 'a' }];
    expect(orderByIds(items, ['a', 'x', 'b']).map((i) => i.Id)).toEqual(['a', 'b']);
    expect(orderByIds(undefined, ['a'])).toEqual([]);
  });
});

describe('mix and genre labels', () => {
  it('names the mix kind', () => {
    expect(mixSubtitle({ Type: 'MusicArtist' })).toBe('Artist mix');
    expect(mixSubtitle({ Type: 'MusicGenre' })).toBe('Genre mix');
  });

  it('counts songs', () => {
    expect(genreSongs({ SongCount: 1 })).toBe('1 song');
    expect(genreSongs({ SongCount: 12 })).toBe('12 songs');
    expect(genreSongs({})).toBeUndefined();
  });
});

describe('topMusicGenres', () => {
  it('puts the genres with most songs first, then by name, and caps the list', () => {
    const genres: BaseItemDto[] = [
      { Id: '1', Name: 'Pop', SongCount: 3 },
      { Id: '2', Name: 'Jazz', SongCount: 9 },
      { Id: '3', Name: 'Blues', SongCount: 3 },
      { Id: '4', Name: ' ', SongCount: 99 },
      { Name: 'No id', SongCount: 99 },
    ];
    expect(topMusicGenres(genres).map((g) => g.Name)).toEqual(['Jazz', 'Blues', 'Pop']);
    expect(topMusicGenres(genres, 1).map((g) => g.Name)).toEqual(['Jazz']);
  });
});

describe('firstFilled', () => {
  it('picks the first section in order that shows a row', () => {
    expect(firstFilled(['a', 'b', 'c'], new Set(['c', 'b']))).toBe('b');
    expect(firstFilled(['a'], new Set())).toBeUndefined();
  });
});
