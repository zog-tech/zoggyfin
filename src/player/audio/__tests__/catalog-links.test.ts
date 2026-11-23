const mockKv = new Map<string, string>();
jest.mock('@/storage/kv', () => ({
  storage: {
    getString: (k: string) => mockKv.get(k),
    set: (k: string, v: string) => void mockKv.set(k, v),
    remove: (k: string) => void mockKv.delete(k),
  },
}));

type Links = typeof import('../catalog-links');
// A fresh module each time: as after an app restart.
const load = () => jest.requireActual<Links>('../catalog-links');

describe('catalog links store', () => {
  beforeEach(() => {
    mockKv.clear();
    jest.resetModules();
  });

  it('saves a link and reads it back after a restart', () => {
    const first = load();
    first.linkCatalogSong('cat1', 'lib1');
    expect(first.savedId('cat1')).toBe('lib1');
    jest.resetModules();
    const again = load();
    expect(again.savedId('cat1')).toBe('lib1');
    expect(again.savedId('lib1')).toBe('lib1');
  });

  it('starts empty on a bad saved value', () => {
    mockKv.set('catalog.links', '{not json');
    const links = load();
    expect(links.savedId('cat1')).toBe('cat1');
  });
});
