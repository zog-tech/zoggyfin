import { browseEmptyText, browseQueries, browseRows, browseSort } from '../browse';
import { BROWSE_FILTERS, browseKindOf, filterSections, groupSearchResults, SEARCH_FILTERS } from '../group-results';

describe('browse chips', () => {
  it('offers Movies, Shows, Videos and Music before any words', () => {
    expect(BROWSE_FILTERS.map((f) => f.label)).toEqual(['All', 'Movies', 'Shows', 'Videos', 'Music']);
    // Every browse chip is also a search filter, so a chip keeps its choice when words come.
    for (const f of BROWSE_FILTERS) expect(SEARCH_FILTERS.some((x) => x.value === f.value)).toBe(true);
  });

  it('lists All for a filter with nothing to list on its own', () => {
    expect(browseKindOf('movies')).toBe('movies');
    expect(browseKindOf('videos')).toBe('videos');
    expect(browseKindOf('episodes')).toBe('all');
    expect(browseKindOf('people')).toBe('all');
  });
});

describe('browseRows', () => {
  it('starts with one row of each kind', () => {
    expect(browseRows('all').map((r) => r.key)).toEqual(['movies', 'shows', 'videos', 'albums']);
  });

  it('keeps each chip to its own kind', () => {
    for (const r of browseRows('movies')) expect(r.types).toEqual(['Movie']);
    for (const r of browseRows('shows')) expect(r.types).toEqual(['Series']);
    for (const r of browseRows('videos')) expect(r.types.every((t) => t === 'Video' || t === 'MusicVideo')).toBe(true);
    for (const r of browseRows('music')) expect(r.types.every((t) => t === 'MusicAlbum' || t === 'Playlist')).toBe(true);
  });

  it('gives every row a unique key and a title', () => {
    for (const f of BROWSE_FILTERS) {
      const rows = browseRows(f.value);
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
      for (const r of rows) expect(r.title.length).toBeGreaterThan(0);
      expect(browseEmptyText(f.value).length).toBeGreaterThan(0);
    }
  });
});

describe('browseSort', () => {
  it('sorts with the name as the tie-break', () => {
    expect(browseSort('rating')).toEqual({ sortBy: ['CommunityRating', 'SortName'], sortOrder: ['Descending', 'Ascending'] });
    expect(browseSort('added')).toEqual({ sortBy: ['DateCreated', 'SortName'], sortOrder: ['Descending', 'Ascending'] });
    expect(browseSort('random').sortBy).toEqual(['Random']);
  });

  it('turns rows into server queries', () => {
    const [first] = browseQueries('movies');
    expect(first).toEqual({ key: 'movies-top', title: 'Top rated movies', query: { types: ['Movie'], limit: 40, sortBy: ['CommunityRating', 'SortName'], sortOrder: ['Descending', 'Ascending'] } });
  });
});

describe('the Videos filter', () => {
  it('keeps videos apart from movies', () => {
    const groups = groupSearchResults([
      { Id: '1', Type: 'Movie', Name: 'Sample Movie' },
      { Id: '2', Type: 'Video', Name: 'Holiday' },
      { Id: '3', Type: 'BoxSet', Name: 'Collection' },
    ]);
    expect(filterSections(groups, 'videos').map((g) => g.key)).toEqual(['videos']);
    expect(filterSections(groups, 'movies').map((g) => g.key)).toEqual(['movies', 'collections']);
  });
});
