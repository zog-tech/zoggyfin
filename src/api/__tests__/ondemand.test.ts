import { ONDEMAND_MAX_SECTIONS, parseOnDemandHome } from '../ondemand';

const song = (id: string, extra: Record<string, unknown> = {}) => ({ Id: id, Name: `Song ${id}`, Type: 'Audio', ...extra });
const album = (id: string) => ({ Id: id, Name: `Album ${id}`, Type: 'MusicAlbum' });

const valid = {
  Version: 1,
  Sections: [
    { Id: 'trending-songs', Title: 'Trending songs', ItemType: 'Audio', Items: [song('s1'), song('s2')] },
    { Id: 'top-albums', Title: 'Top albums', ItemType: 'MusicAlbum', Items: [album('a1')] },
  ],
};

describe('parseOnDemandHome', () => {
  it('parses a valid answer in order', () => {
    const home = parseOnDemandHome(valid);
    expect(home?.version).toBe(1);
    expect(home?.sections.map((s) => [s.id, s.title, s.itemType, s.items.length])).toEqual([
      ['trending-songs', 'Trending songs', 'Audio', 2],
      ['top-albums', 'Top albums', 'MusicAlbum', 1],
    ]);
  });

  it('returns null for a body that is not the answer', () => {
    expect(parseOnDemandHome(null)).toBeNull();
    expect(parseOnDemandHome(undefined)).toBeNull();
    expect(parseOnDemandHome('<!doctype html><html></html>')).toBeNull();
    expect(parseOnDemandHome([])).toBeNull();
    expect(parseOnDemandHome({ Version: 1 })).toBeNull();
    expect(parseOnDemandHome({ Version: 1, Sections: {} })).toBeNull();
    expect(parseOnDemandHome({ Version: 'one', Sections: [] })).toBeNull();
    expect(parseOnDemandHome({ Version: 0, Sections: [] })).toBeNull();
  });

  it('parses a newer version whose shape fits', () => {
    const home = parseOnDemandHome({ ...valid, Version: 3, Extra: { x: 1 } });
    expect(home?.version).toBe(3);
    expect(home?.sections).toHaveLength(2);
  });

  it('keeps unknown fields of items and ignores unknown fields of sections', () => {
    const home = parseOnDemandHome({
      Sections: [{ Id: 'x', Title: 'X', Layout: 'big', Items: [song('s1', { CatalogRank: 4 })] }],
    });
    expect(home?.version).toBe(1);
    expect(home?.sections[0].itemType).toBeUndefined();
    expect((home?.sections[0].items[0] as Record<string, unknown>).CatalogRank).toBe(4);
  });

  it('drops malformed sections and items', () => {
    const home = parseOnDemandHome({
      Version: 1,
      Sections: [
        null,
        'row',
        { Title: 'No id', Items: [song('s1')] },
        { Id: 'no-title', Items: [song('s1')] },
        { Id: 'no-items', Title: 'No items' },
        { Id: 'mixed', Title: 'Mixed', Items: [song('s1'), null, { Id: 's2' }, { Name: 'x', Type: 'Audio' }, song(''), 7, song('s1'), song('s3')] },
      ],
    });
    expect(home?.sections.map((s) => s.id)).toEqual(['mixed']);
    expect(home?.sections[0].items.map((i) => i.Id)).toEqual(['s1', 's3']);
  });

  it('drops empty sections and a repeated section id', () => {
    const home = parseOnDemandHome({
      Sections: [
        { Id: 'empty', Title: 'Empty', Items: [] },
        { Id: 'a', Title: 'A', Items: [song('s1')] },
        { Id: 'a', Title: 'A again', Items: [song('s2')] },
      ],
    });
    expect(home?.sections.map((s) => s.title)).toEqual(['A']);
  });

  it('gives an empty list when no section is usable', () => {
    expect(parseOnDemandHome({ Version: 1, Sections: [] })).toEqual({ version: 1, sections: [] });
  });

  it('caps the items of a row and the number of rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => song(`s${i}`));
    const rows = Array.from({ length: 20 }, (_, i) => ({ Id: `r${i}`, Title: `Row ${i}`, Items: many }));
    const home = parseOnDemandHome({ Sections: rows }, 20);
    expect(home?.sections).toHaveLength(ONDEMAND_MAX_SECTIONS);
    expect(home?.sections[0].items).toHaveLength(20);
  });
});
