import type { BaseItemDto } from '@/api/types';
import { mergeTopSongs } from '../artist-top';

const song = (Id: string, Name: string, artist = 'Akon'): BaseItemDto => ({ Id, Name, Type: 'Audio', Artists: [artist] });

describe('mergeTopSongs', () => {
  const library = [song('lib1', 'Gangsta Bop'), song('lib2', 'Smack That'), song('lib3', 'Album Cut')];

  it('keeps the library list without the plugin', () => {
    expect(mergeTopSongs(null, library).map((s) => s.Id)).toEqual(['lib1', 'lib2', 'lib3']);
    expect(mergeTopSongs([], library, 2).map((s) => s.Id)).toEqual(['lib1', 'lib2']);
  });

  it('puts the plugin list first, then the library songs it does not have', () => {
    const catalog = [song('cat1', 'Lonely ☁'), song('lib2', 'Smack That'), song('cat2', 'Boom Body ☁', 'Shaggy')];
    expect(mergeTopSongs(catalog, library).map((s) => s.Id)).toEqual(['cat1', 'lib2', 'cat2', 'lib1', 'lib3']);
  });

  it('shows a catalog song the library has as the library item', () => {
    const catalog = [song('cat9', 'Gangsta Bop ☁')];
    expect(mergeTopSongs(catalog, library).map((s) => s.Id)).toEqual(['lib1', 'lib2', 'lib3']);
  });

  it('keeps songs with the same name by other artists', () => {
    const catalog = [song('cat1', 'Gangsta Bop ☁', 'Someone Else')];
    expect(mergeTopSongs(catalog, library).map((s) => s.Id)).toEqual(['cat1', 'lib1', 'lib2', 'lib3']);
  });

  it('stops at the limit', () => {
    const catalog = Array.from({ length: 30 }, (_, i) => song(`cat${i}`, `Song ${i} ☁`));
    expect(mergeTopSongs(catalog, library)).toHaveLength(20);
  });
});
