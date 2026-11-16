import { musicSort } from '../music-sort';

describe('musicSort', () => {
  it('sorts songs by title, not by the track-numbered sort name', () => {
    expect(musicSort('songs', 'SortName', 'Ascending')).toEqual({ sortBy: ['Name'], sortOrder: ['Ascending'] });
    expect(musicSort('liked', 'SortName', 'Descending')).toEqual({ sortBy: ['Name'], sortOrder: ['Descending'] });
  });

  it('keeps track order inside an album, and album order inside an artist', () => {
    expect(musicSort('songs', 'Album', 'Ascending').sortBy).toEqual(['Album', 'SortName']);
    expect(musicSort('songs', 'Artist', 'Descending')).toEqual({
      sortBy: ['Artist', 'Album', 'SortName'],
      sortOrder: ['Descending', 'Ascending', 'Ascending'],
    });
  });

  it('breaks other song sorts by title', () => {
    expect(musicSort('liked', 'DateCreated', 'Descending')).toEqual({ sortBy: ['DateCreated', 'Name'], sortOrder: ['Descending', 'Ascending'] });
  });

  it('leaves the other tabs on the sort name', () => {
    expect(musicSort('albums', 'SortName', 'Ascending').sortBy).toEqual(['SortName']);
    expect(musicSort('artists', 'DateCreated', 'Descending').sortBy).toEqual(['DateCreated', 'SortName']);
  });
});
