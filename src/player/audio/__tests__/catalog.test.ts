import { addLink, emptyLinks, isCatalogSong, linkedId, mayPreload, parseLinks, sameSong, savedName } from '../catalog';

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

describe('savedName', () => {
  it('drops the catalog mark only', () => {
    expect(savedName('Song One ☁')).toBe('Song One');
    expect(savedName('Song One ☁ ')).toBe('Song One');
    expect(savedName('Song One')).toBe('Song One');
    expect(savedName('☁ Clouds')).toBe('☁ Clouds');
    expect(savedName(null)).toBe(null);
  });
});

describe('catalog links', () => {
  it('links a catalog id to the saved id', () => {
    const a = addLink(emptyLinks(), 'cat1', 'lib1');
    expect(linkedId(a, 'cat1')).toBe('lib1');
    expect(linkedId(a, 'lib1')).toBe('lib1');
    expect(linkedId(a, 'other')).toBe('other');
    expect(linkedId(a, null)).toBe(null);
  });

  it('counts a catalog id and its saved id as one song', () => {
    const a = addLink(emptyLinks(), 'cat1', 'lib1');
    expect(sameSong(a, 'cat1', 'lib1')).toBe(true);
    expect(sameSong(a, 'lib1', 'cat1')).toBe(true);
    expect(sameSong(a, 'cat1', 'cat1')).toBe(true);
    expect(sameSong(a, 'cat1', 'lib2')).toBe(false);
    expect(sameSong(a, null, 'lib1')).toBe(false);
  });

  it('returns the same object when nothing changes', () => {
    const a = addLink(emptyLinks(), 'cat1', 'lib1');
    expect(addLink(a, 'cat1', 'lib1')).toBe(a);
    expect(addLink(a, 'x', 'x')).toBe(a);
    expect(addLink(a, '', 'lib1')).toBe(a);
  });

  it('drops the oldest links past the limit', () => {
    let a = emptyLinks();
    for (let i = 0; i < 5; i++) a = addLink(a, `cat${i}`, `lib${i}`, 3);
    expect(Object.keys(a.links)).toEqual(['cat2', 'cat3', 'cat4']);
    // A link set again is the newest.
    a = addLink(a, 'cat2', 'libX', 3);
    a = addLink(a, 'cat5', 'lib5', 3);
    expect(Object.keys(a.links)).toEqual(['cat4', 'cat2', 'cat5']);
  });

  it('reads saved links and never throws on a bad value', () => {
    expect(parseLinks({ version: 1, links: { cat1: 'lib1', bad: 3, same: 'same' } }).links).toEqual({ cat1: 'lib1' });
    expect(parseLinks({ version: 2, links: { cat1: 'lib1' } }).links).toEqual({});
    expect(parseLinks(null).links).toEqual({});
    expect(parseLinks('x').links).toEqual({});
    expect(parseLinks({ version: 1, links: [] }).links).toEqual({});
  });
});
