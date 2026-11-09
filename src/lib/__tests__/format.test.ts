import { gridItemTypes, isAudioView, isSupportedView, libraryKind } from '@/features/library/library-kind';
import { filterSections, groupSearchResults, pushRecentSearch, topResult } from '@/features/search/group-results';

import { episodeLabel, formatClock, formatDuration, playedFraction, remainingLabel, subtitleFor } from '../format';

const T = 10_000_000;

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(35 * T)).toBe('35 s');
    expect(formatDuration(42 * 60 * T)).toBe('42 min');
    expect(formatDuration((102 * 60 + 10) * T)).toBe('1 h 42 min');
    expect(formatDuration(120 * 60 * T)).toBe('2 h');
  });
  it('labels the time left', () => {
    expect(remainingLabel({ RunTimeTicks: 60 * 60 * T, UserData: { Key: 'k', PlaybackPositionTicks: 2 * 60 * T } })).toBe('58 min left');
    expect(remainingLabel({ RunTimeTicks: 60 * T })).toBeNull();
  });
  it('formats clocks', () => {
    expect(formatClock(187 * T)).toBe('3:07');
    expect(formatClock(3729 * T)).toBe('1:02:09');
    expect(formatClock(undefined)).toBeNull();
  });
  it('labels episodes', () => {
    expect(episodeLabel({ ParentIndexNumber: 1, IndexNumber: 4 })).toBe('S1 · E4');
    expect(episodeLabel({ IndexNumber: 4 })).toBe('E4');
    expect(episodeLabel({})).toBeNull();
  });
  it('computes played fraction', () => {
    expect(playedFraction({ UserData: { Key: 'k', PlayedPercentage: 25 } })).toBe(0.25);
    expect(playedFraction({ RunTimeTicks: 100, UserData: { Key: 'k', PlaybackPositionTicks: 50 } })).toBe(0.5);
    expect(playedFraction({ UserData: { Key: 'k', PlayedPercentage: 100 } })).toBeNull();
    expect(playedFraction({})).toBeNull();
  });
  it('builds subtitles', () => {
    expect(subtitleFor({ Type: 'Episode', SeriesName: 'Sample Show', ParentIndexNumber: 2, IndexNumber: 3 })).toBe(
      'Sample Show · S2 · E3',
    );
    expect(subtitleFor({ Type: 'Movie', ProductionYear: 2001 })).toBe('2001');
    expect(subtitleFor({ Type: 'MusicAlbum', AlbumArtist: 'Jane Doe' })).toBe('Jane Doe');
    expect(subtitleFor({ Type: 'Series', ProductionYear: 2010, Status: 'Continuing' })).toBe('2010 –');
  });
});

describe('library kind', () => {
  it('maps collection types', () => {
    expect(libraryKind({ CollectionType: 'movies' })).toBe('movies');
    expect(libraryKind({})).toBe('mixed');
    expect(gridItemTypes('tvshows')).toEqual(['Series']);
    expect(isAudioView({ CollectionType: 'music' })).toBe(true);
    expect(isSupportedView({ CollectionType: 'livetv' })).toBe(false);
    expect(isSupportedView({ Type: 'Channel' })).toBe(false);
    expect(isSupportedView({ CollectionType: 'movies', Type: 'CollectionFolder' })).toBe(true);
  });
});

describe('search grouping', () => {
  it('groups by type in a fixed order and drops duplicates', () => {
    const groups = groupSearchResults([
      { Id: '1', Type: 'Audio', Name: 'Song' },
      { Id: '2', Type: 'Movie', Name: 'Sample Movie' },
      { Id: '2', Type: 'Movie', Name: 'Sample Movie' },
      { Id: '3', Type: 'Person', Name: 'Jane Doe' },
      { Id: '4', Type: 'Folder', Name: 'Misc' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['movies', 'songs', 'people', 'other']);
    expect(groups[0].items).toHaveLength(1);
  });
  it('filters sections by chip and picks a top result', () => {
    const groups = groupSearchResults([
      { Id: '1', Type: 'Audio', Name: 'Song' },
      { Id: '2', Type: 'Movie', Name: 'Sample Movie' },
      { Id: '3', Type: 'MusicAlbum', Name: 'Album' },
    ]);
    expect(filterSections(groups, 'music').map((g) => g.key)).toEqual(['albums', 'songs']);
    expect(filterSections(groups, 'people')).toEqual([]);
    expect(filterSections(groups, 'all')).toHaveLength(3);
    expect(topResult(groups)?.Id).toBe('2');
    expect(topResult([])).toBeNull();
  });
  it('keeps recent searches distinct and capped', () => {
    expect(pushRecentSearch(['a', 'B'], 'b')).toEqual(['b', 'a']);
    expect(pushRecentSearch(['a'], '  ')).toEqual(['a']);
    expect(pushRecentSearch(['1', '2', '3'], '4', 3)).toEqual(['4', '1', '2']);
    // A longer search replaces the shorter searches it extends; others stay.
    expect(pushRecentSearch(['garee2', 'garee', 'shat', 'gare'], 'Garee2a')).toEqual(['Garee2a', 'shat']);
    expect(pushRecentSearch(['kifak inta'], 'kifak')).toEqual(['kifak', 'kifak inta']);
  });
});

describe('randomId', () => {
  const { randomId } = jest.requireActual<typeof import('../id')>('../id');
  it('makes v4-shaped ids without crypto', () => {
    const id = randomId(undefined);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomId(undefined)).not.toBe(id);
  });
  it('uses getRandomValues when given', () => {
    const id = randomId((b) => b.fill(0));
    expect(id).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('parseRuntimeConfig', () => {
  const { parseRuntimeConfig } = jest.requireActual<typeof import('../runtime-config')>('../runtime-config');
  it('accepts only a non-empty string URL', () => {
    expect(parseRuntimeConfig({ defaultServerUrl: ' http://jf.example.com ' })).toEqual({
      defaultServerUrl: 'http://jf.example.com',
    });
    expect(parseRuntimeConfig({ defaultServerUrl: '' })).toEqual({});
    expect(parseRuntimeConfig(null)).toEqual({});
    expect(parseRuntimeConfig({ defaultServerUrl: 3 })).toEqual({});
  });
});

describe('shapeForList', () => {
  const { shapeForList } = jest.requireActual<typeof import('@/components/tile-shape')>('@/components/tile-shape');
  it('uses wide tiles when most images are wide', () => {
    expect(shapeForList([{ PrimaryImageAspectRatio: 1.77 }, { PrimaryImageAspectRatio: 1.78 }, { PrimaryImageAspectRatio: 0.67 }], 'poster')).toBe('thumb');
    expect(shapeForList([{ PrimaryImageAspectRatio: 0.67 }, { PrimaryImageAspectRatio: 1.78 }], 'poster')).toBe('poster');
    expect(shapeForList([{}, {}, {}], 'poster')).toBe('poster');
    expect(shapeForList([{ PrimaryImageAspectRatio: 1.78 }], 'square')).toBe('square');
  });
});

describe('download formats', () => {
  const { formatBytes, formatEta, formatSpeed } = jest.requireActual('../format') as typeof import('../format');
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(640_000)).toBe('640 KB');
    expect(formatBytes(8_600_000)).toBe('8.6 MB');
    expect(formatBytes(812_000_000)).toBe('812 MB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
    expect(formatSpeed(8_600_000)).toBe('8.6 MB/s');
  });
  it('formats time left', () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(20)).toBe('a few seconds left');
    expect(formatEta(61)).toBe('1 min left');
    expect(formatEta(3600 + 300)).toBe('1 h 5 min left');
    expect(formatEta(7200)).toBe('2 h left');
  });
});
