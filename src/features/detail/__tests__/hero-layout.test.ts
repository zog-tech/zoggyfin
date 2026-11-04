import { fitRoundActions, heroHeight, heroLayout, solidHeaderAfter } from '../hero-layout';

describe('heroLayout', () => {
  it('uses the wide hero for a video with only a wide primary image', () => {
    expect(heroLayout({ Type: 'Video', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 1.78 })).toBe('wide');
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 1.78 })).toBe('wide');
  });
  it('keeps the tall backdrop when the item has a backdrop', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 0.67, BackdropImageTags: ['b'] })).toBe('backdrop');
    expect(heroLayout({ Type: 'Series', BackdropImageTags: ['b'] })).toBe('backdrop');
  });
  it('uses the tall hero for a portrait poster alone', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Primary: 'p' }, PrimaryImageAspectRatio: 0.67 })).toBe('backdrop');
  });
  it('uses the wide hero for thumbs, episodes and image-less videos', () => {
    expect(heroLayout({ Type: 'Movie', ImageTags: { Thumb: 't' } })).toBe('wide');
    expect(heroLayout({ Type: 'Episode', ImageTags: { Primary: 'p' } })).toBe('wide');
    expect(heroLayout({ Type: 'Video' })).toBe('wide');
  });
  it('uses square and circle art for music and people', () => {
    expect(heroLayout({ Type: 'MusicAlbum' })).toBe('square');
    expect(heroLayout({ Type: 'Playlist' })).toBe('square');
    expect(heroLayout({ Type: 'MusicArtist' })).toBe('circle');
    expect(heroLayout({ Type: 'Person' })).toBe('circle');
  });
  it('sizes the hero', () => {
    expect(heroHeight('backdrop', 393, 852, false)).toBe(477);
    expect(heroHeight('backdrop', 393, 1000, false)).toBe(520);
    expect(heroHeight('wide', 393, 852, false)).toBe(221);
    expect(heroHeight('square', 393, 852, false)).toBe(0);
  });
});

describe('fitRoundActions', () => {
  const row = [{ id: 'start' }, { id: 'download', spare: true }, { id: 'playlist', spare: true }, { id: 'played', spare: true }, { id: 'fav', spare: true }, { id: 'together' }, { id: 'more' }];
  it('keeps every action with the big gap when they fit', () => {
    expect(fitRoundActions(row, 600, 56, [20, 8])).toEqual({ items: row, gap: 20 });
  });
  it('makes the gap smaller first', () => {
    expect(fitRoundActions(row, 7 * 56 + 6 * 8, 56, [20, 8]).gap).toBe(8);
  });
  it('moves spare actions out of the row, last first, on a phone', () => {
    const r = fitRoundActions(row, 361, 56, [20, 8]);
    expect(r.items.map((x) => x.id)).toEqual(['start', 'download', 'playlist', 'together', 'more']);
    expect(r.gap).toBe(8);
  });
  it('shows all actions before the first layout', () => {
    expect(fitRoundActions(row, 0, 56, [20, 8]).items).toHaveLength(7);
  });
});

describe('solidHeaderAfter', () => {
  it('waits until the hero scrolls out from under the bar', () => {
    expect(solidHeaderAfter(true, 500, 60)).toBe(440);
  });
  it('never goes below the top of the page for a short hero', () => {
    expect(solidHeaderAfter(true, 40, 60)).toBe(0);
  });
  it('gives a page with no hero the solid bar once content moves under it', () => {
    expect(solidHeaderAfter(false, 0, 60)).toBe(1);
  });
});
