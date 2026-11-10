import { hostOf, isPushedRoot, isReplaceableTab, REPLACEABLE_TABS, rewriteTabPath, TAB_INFO, tabGroupFor, tabRootHref } from '../tab-destination';

describe('tabRootHref', () => {
  it('is the tab itself when nothing is replaced', () => {
    expect(tabRootHref('library', null)).toBe('/(tabs)/(library)/libraries');
    expect(tabRootHref('music', null)).toBe('/(tabs)/(music)/music');
    expect(tabRootHref('downloads', null)).toBe('/(tabs)/(saved)/downloads');
    expect(tabRootHref('search', null)).toBe('/(tabs)/(search)/search');
  });

  it('moves only the replaced tab', () => {
    expect(tabRootHref('downloads', '(saved)')).toBe('/(tabs)/(library)/more/downloads');
    expect(tabRootHref('music', '(music)')).toBe('/(tabs)/(library)/more/music');
    expect(tabRootHref('search', '(search)')).toBe('/(tabs)/(library)/more/search');
    // Library goes to Home: Home is never replaced.
    expect(tabRootHref('library', '(library)')).toBe('/(tabs)/(home)/more/library');
    // The other tabs stay where they are.
    expect(tabRootHref('downloads', '(music)')).toBe('/(tabs)/(saved)/downloads');
    expect(tabRootHref('library', '(saved)')).toBe('/(tabs)/(library)/libraries');
  });

  it('never sends a replaced tab into a hidden stack', () => {
    for (const tab of REPLACEABLE_TABS) {
      for (const dest of ['library', 'music', 'downloads', 'search'] as const) {
        expect(tabRootHref(dest, tab).startsWith(`/(tabs)/${tab}/`)).toBe(false);
      }
    }
  });
});

describe('tabGroupFor', () => {
  it('keeps every group with nothing replaced', () => {
    expect(tabGroupFor('(music)', null)).toBe('(music)');
    expect(tabGroupFor('(library)', null)).toBe('(library)');
  });

  it('moves the replaced group to its host stack', () => {
    expect(tabGroupFor('(music)', '(music)')).toBe('(library)');
    expect(tabGroupFor('(saved)', '(saved)')).toBe('(library)');
    expect(tabGroupFor('(search)', '(search)')).toBe('(library)');
    expect(tabGroupFor('(library)', '(library)')).toBe('(home)');
    expect(tabGroupFor('(music)', '(search)')).toBe('(music)');
    expect(tabGroupFor('(home)', '(library)')).toBe('(home)');
  });

  it('hosts in a tab that is never the replaced one', () => {
    for (const tab of REPLACEABLE_TABS) expect(hostOf(tab)).not.toBe(tab);
  });
});

describe('isPushedRoot', () => {
  it('is a root in its own tab and outside the tabs', () => {
    expect(isPushedRoot('(saved)', ['(tabs)', '(saved)', 'downloads'])).toBe(false);
    // The offline Downloads route has no tab.
    expect(isPushedRoot('(saved)', ['offline'])).toBe(false);
  });

  it('is a pushed page in another stack', () => {
    expect(isPushedRoot('(saved)', ['(tabs)', '(library)', 'more', 'downloads'])).toBe(true);
    expect(isPushedRoot('(library)', ['(tabs)', '(home)', 'more', 'library'])).toBe(true);
  });
});

describe('rewriteTabPath', () => {
  it('passes every path with nothing replaced', () => {
    expect(rewriteTabPath('/downloads', null)).toBe('/downloads');
    expect(rewriteTabPath('/(tabs)/(music)/item/1', null)).toBe('/(tabs)/(music)/item/1');
  });

  it('sends the root of a replaced tab to its new place', () => {
    expect(rewriteTabPath('/downloads', '(saved)')).toBe('/more/downloads');
    expect(rewriteTabPath('/(tabs)/(saved)/downloads', '(saved)')).toBe('/more/downloads');
    expect(rewriteTabPath('/music/', '(music)')).toBe('/more/music');
    expect(rewriteTabPath('/search?q=film', '(search)')).toBe('/more/search?q=film');
    expect(rewriteTabPath('/libraries', '(library)')).toBe('/more/library');
  });

  it('reads app links and web links', () => {
    expect(rewriteTabPath('zoggyfin://downloads', '(saved)')).toBe('/more/downloads');
    expect(rewriteTabPath('zoggyfin:///libraries', '(library)')).toBe('/more/library');
    expect(rewriteTabPath('https://app.example.org/search?q=a', '(search)')).toBe('/more/search?q=a');
    // Not a tab link: the link passes as it came.
    expect(rewriteTabPath('zoggyfin://join?code=1', '(saved)')).toBe('zoggyfin://join?code=1');
    expect(rewriteTabPath('not a link', '(saved)')).toBe('not a link');
  });

  it('moves a path inside a replaced stack to the host stack', () => {
    expect(rewriteTabPath('/(tabs)/(music)/item/42?type=Playlist', '(music)')).toBe('/(tabs)/(library)/item/42?type=Playlist');
    expect(rewriteTabPath('/(tabs)/(library)/library/7', '(library)')).toBe('/(tabs)/(home)/library/7');
  });

  it('leaves other paths alone', () => {
    expect(rewriteTabPath('/downloads', '(music)')).toBe('/downloads');
    expect(rewriteTabPath('/accept-invite', '(saved)')).toBe('/accept-invite');
    expect(rewriteTabPath('/', '(library)')).toBe('/');
    expect(rewriteTabPath('/item/1', '(music)')).toBe('/item/1');
  });
});

describe('tab facts', () => {
  it('knows every replaceable tab and nothing else', () => {
    expect(REPLACEABLE_TABS.every(isReplaceableTab)).toBe(true);
    expect(isReplaceableTab('(home)')).toBe(false);
    expect(isReplaceableTab('(ext)')).toBe(false);
    expect(isReplaceableTab(3)).toBe(false);
    expect(Object.keys(TAB_INFO).sort()).toEqual([...REPLACEABLE_TABS].sort());
  });
});
