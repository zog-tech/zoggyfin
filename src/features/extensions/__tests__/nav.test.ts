import { entryHref, extGroupOf, pageHref, pagePathname } from '../nav';

describe('extension hrefs', () => {
  it('builds a page href in each group, the extension tab too', () => {
    for (const g of ['(home)', '(library)', '(search)', '(ext)'] as const) {
      expect(pageHref(g, 'org.example.media', 'main')).toEqual({
        pathname: `/(tabs)/${g}/ext/[ext]/[page]`,
        params: { ext: 'org.example.media', page: 'main' },
      });
    }
    expect(pageHref('(ext)', 'org.example.media', 'main', 'latest')).toEqual({
      pathname: '/(tabs)/(ext)/ext/[ext]/[page]',
      params: { ext: 'org.example.media', page: 'main', section: 'latest' },
    });
  });

  it('builds an entry href in the extension tab', () => {
    expect(entryHref('(ext)', 'org.example.media', { key: 'e1', detail: 'https://media.example.org/d/1', title: 'One' })).toEqual({
      pathname: '/(tabs)/(ext)/ext/[ext]/entry/[entry]',
      params: { ext: 'org.example.media', entry: 'e1', detail: 'https://media.example.org/d/1', title: 'One' },
    });
  });

  it('finds the group of a route, Home by default', () => {
    expect(extGroupOf(['(tabs)', '(ext)', 'ext', '[ext]', '[page]'])).toBe('(ext)');
    expect(extGroupOf(['(tabs)', '(library)', 'ext', '[ext]', '[page]'])).toBe('(library)');
    expect(extGroupOf(['(tabs)', '(music)', 'music'])).toBe('(home)');
  });

  it('gives the pathname the TV side menu matches', () => {
    expect(pagePathname('org.example.media', 'main')).toBe('/ext/org.example.media/main');
  });
});
