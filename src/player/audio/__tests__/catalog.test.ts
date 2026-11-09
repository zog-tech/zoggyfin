import { isCatalogSong, mayPreload } from '../catalog';

describe('catalog songs', () => {
  it('knows a song by the mark at the end of its name', () => {
    expect(isCatalogSong({ Name: 'Song One ☁' })).toBe(true);
    expect(isCatalogSong({ Name: 'Song One ☁ ' })).toBe(true);
    expect(mayPreload({ Name: 'Song One ☁' })).toBe(false);
  });

  it('treats other songs as normal', () => {
    expect(isCatalogSong({ Name: 'Song One' })).toBe(false);
    expect(isCatalogSong({ Name: '☁ Clouds' })).toBe(false);
    expect(isCatalogSong({ Name: 'Song☁' })).toBe(false);
    expect(isCatalogSong({ Name: null })).toBe(false);
    expect(mayPreload({})).toBe(true);
  });
});
