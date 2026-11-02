import type { BaseItemDto } from '@/api/types';

import { browseGenres, genreCount, inGenre } from '../genres';

const genre = (Id: string, Name: string, MovieCount = 0, SeriesCount = 0): BaseItemDto => ({ Id, Name, Type: 'Genre', MovieCount, SeriesCount });

describe('browseGenres', () => {
  it('puts the largest genres first, then sorts by name', () => {
    const list = [genre('a', 'Drama', 3, 1), genre('b', 'Action', 10), genre('c', 'Comedy', 2, 2)];
    expect(browseGenres(list).map((g) => g.Name)).toEqual(['Action', 'Comedy', 'Drama']);
  });

  it('drops genres with no name, no Id or no items', () => {
    const list = [genre('a', ' '), genre('', 'Western', 4), genre('c', 'Empty'), genre('d', 'Horror', 1)];
    expect(browseGenres(list).map((g) => g.Name)).toEqual(['Horror']);
  });

  it('uses ChildCount from an older server', () => {
    expect(browseGenres([{ Id: 'x', Name: 'Old', ChildCount: 5 }])).toHaveLength(1);
  });

  it('keeps at most max genres and accepts no list', () => {
    expect(browseGenres([genre('a', 'A', 1), genre('b', 'B', 2)], 1).map((g) => g.Name)).toEqual(['B']);
    expect(browseGenres(undefined)).toEqual([]);
  });
});

describe('inGenre', () => {
  const items: BaseItemDto[] = [
    { Id: '1', Genres: ['Drama'] },
    { Id: '2', Genres: ['Science Fiction', 'Comedy'] },
    { Id: '3' },
  ];

  it('keeps the items of the genre, ignoring case and spaces', () => {
    expect(inGenre(items, ' science fiction').map((it) => it.Id)).toEqual(['2']);
  });

  it('keeps every item with no genre chosen', () => {
    expect(inGenre(items, null)).toHaveLength(3);
  });
});

describe('genreCount', () => {
  it('counts movies and shows', () => {
    expect(genreCount(genre('a', 'A', 1, 3))).toBe('1 movie · 3 shows');
    expect(genreCount(genre('a', 'A', 2))).toBe('2 movies');
    expect(genreCount(genre('a', 'A'))).toBeUndefined();
  });
});
