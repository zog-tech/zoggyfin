import { parseManifest, type Manifest } from '@/extensions/schema';

import { DEFAULT_PAGE_ICON, pageIconName, pageTabIcon } from '../icons';
import {
  choosePhoneTab,
  chooseTabPage,
  hiddenTriggers,
  NO_PLACEMENT,
  pageTileId,
  type PhoneTab,
  phoneTabChoices,
  phoneTabPage,
  phoneTabValue,
  placementPlatform,
  placePages,
  type PlacementExtension,
  type PlacementPlatform,
  tabChoices,
  tabPagesOf,
  tabSlotPage,
  TV_MENU_MAX,
} from '../placement';

interface PageIn {
  id: string;
  title?: string;
  icon?: string;
  tab?: boolean;
  library?: boolean;
  home?: string[];
}

function manifest(id: string, pages: PageIn[]): Manifest {
  const r = parseManifest({
    schemaVersion: 2,
    id,
    name: `Name ${id}`,
    version: '1.0.0',
    baseUrl: 'https://media.example.org',
    contributes: {
      pages: pages.map((p) => ({
        id: p.id,
        title: p.title ?? `Title ${p.id}`,
        ...(p.icon ? { icon: p.icon } : null),
        placement: { tab: p.tab ?? false, library: p.library ?? false, home: p.home ?? [] },
        sections: [{ id: 'latest', title: 'Latest', feed: '/api/latest' }],
      })),
    },
  });
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

function ext(id: string, pages: PageIn[], over: Partial<PlacementExtension> = {}): PlacementExtension {
  return { manifest: manifest(id, pages), enabled: true, installedAt: 1, ...over };
}

const ids = (pages: { extId: string; pageId: string }[]) => pages.map((p) => `${p.extId}/${p.pageId}`);
const ALL: PlacementPlatform[] = ['phone', 'tablet', 'tv', 'web', 'desktop'];

describe('placementPlatform', () => {
  it('maps the platform facts to a kind', () => {
    expect(placementPlatform({ os: 'ios', isPad: false, tv: false, desktop: false })).toBe('phone');
    expect(placementPlatform({ os: 'android', isPad: false, tv: false, desktop: false })).toBe('phone');
    expect(placementPlatform({ os: 'ios', isPad: true, tv: false, desktop: false })).toBe('tablet');
    expect(placementPlatform({ os: 'android', isPad: false, tv: true, desktop: false })).toBe('tv');
    expect(placementPlatform({ os: 'web', isPad: false, tv: true, desktop: false })).toBe('tv');
    expect(placementPlatform({ os: 'web', isPad: false, tv: false, desktop: false })).toBe('web');
    expect(placementPlatform({ os: 'web', isPad: false, tv: false, desktop: true })).toBe('desktop');
  });
});

describe('placePages', () => {
  it('places nothing with no extension', () => {
    for (const p of ALL) expect(placePages(p, [])).toEqual(NO_PLACEMENT);
  });

  it('places nothing when no page asks for a tab or a tile', () => {
    const e = ext('a.one', [{ id: 'main', home: ['latest'] }]);
    for (const p of ALL) expect(placePages(p, [e])).toEqual(NO_PLACEMENT);
  });

  it('places one page with a tab and a tile per platform', () => {
    const e = ext('a.one', [{ id: 'main', title: 'Main', icon: 'film', tab: true, library: true }]);
    const page = { extId: 'a.one', pageId: 'main', title: 'Main', extensionName: 'Name a.one', icon: 'film' };
    // Phones: no tab slot, the Library tile.
    expect(placePages('phone', [e])).toEqual({ tab: null, replaces: null, library: [page], tvMenu: [] });
    // iPad, web, Mac: the tab, and no second tile for the same page.
    for (const p of ['tablet', 'web', 'desktop'] as const) {
      expect(placePages(p, [e])).toEqual({ tab: page, replaces: null, library: [], tvMenu: [] });
    }
    // TV: the side menu only.
    expect(placePages('tv', [e])).toEqual({ tab: null, replaces: null, library: [], tvMenu: [page] });
  });

  it('gives a tab-only page no Library tile (but on phones), and a library-only page no tab', () => {
    const e = ext('a.one', [
      { id: 'tab', tab: true },
      { id: 'lib', library: true },
    ]);
    // Phones: a tab-capable page is a Library tile by default.
    expect(ids(placePages('phone', [e]).library)).toEqual(['a.one/tab', 'a.one/lib']);
    expect(placePages('web', [e]).tab?.pageId).toBe('tab');
    expect(ids(placePages('web', [e]).library)).toEqual(['a.one/lib']);
    expect(ids(placePages('tv', [e]).tvMenu)).toEqual(['a.one/tab', 'a.one/lib']);
  });

  it('fills the slot with the first tab page by install date', () => {
    const late = ext('b.late', [{ id: 'main', tab: true }], { installedAt: 20 });
    const early = ext('a.early', [{ id: 'main', tab: true }], { installedAt: 10 });
    expect(placePages('web', [late, early]).tab?.extId).toBe('a.early');
    expect(tabSlotPage([late, early])?.extId).toBe('a.early');
  });

  it('fills the slot with the chosen page', () => {
    const early = ext('a.early', [{ id: 'main', tab: true }], { installedAt: 10 });
    const late = ext('b.late', [{ id: 'one', tab: true }, { id: 'two', tab: true }], { installedAt: 20, tab: 'two' });
    expect(placePages('desktop', [early, late]).tab).toMatchObject({ extId: 'b.late', pageId: 'two' });
    expect(ids(placePages('tv', [early, late]).tvMenu)).toEqual(['b.late/two', 'a.early/main']);
  });

  it('ignores a chosen page that is no longer tab-capable', () => {
    const e = ext('a.one', [{ id: 'main', tab: true }, { id: 'old' }], { tab: 'old' });
    expect(tabSlotPage([e])?.pageId).toBe('main');
  });

  it('skips a disabled extension', () => {
    const off = ext('a.off', [{ id: 'main', tab: true, library: true }], { enabled: false, installedAt: 1, tab: 'main' });
    const on = ext('b.on', [{ id: 'main', tab: true, library: true }], { installedAt: 2 });
    expect(placePages('web', [off, on]).tab?.extId).toBe('b.on');
    expect(ids(placePages('phone', [off, on]).library)).toEqual(['b.on/main']);
    expect(placePages('web', [off])).toEqual(NO_PLACEMENT);
  });

  it('lists Library tiles of two extensions in install order', () => {
    const a = ext('a.one', [{ id: 'main', library: true }], { installedAt: 5 });
    const b = ext('b.two', [{ id: 'main', library: true }, { id: 'more', library: true }], { installedAt: 1 });
    expect(ids(placePages('phone', [a, b]).library)).toEqual(['b.two/main', 'b.two/more', 'a.one/main']);
    expect(ids(placePages('tablet', [a, b]).library)).toEqual(['b.two/main', 'b.two/more', 'a.one/main']);
  });

  it('caps the TV side menu', () => {
    const a = ext('a.one', [{ id: 'p1', library: true }, { id: 'p2', tab: true }, { id: 'p3', library: true }]);
    const menu = placePages('tv', [a]).tvMenu;
    expect(menu).toHaveLength(TV_MENU_MAX);
    // The tab page comes first.
    expect(ids(menu)).toEqual(['a.one/p2', 'a.one/p1']);
  });

  it('follows the account: another list gives another placement', () => {
    const first = [ext('a.one', [{ id: 'main', tab: true }])];
    const second = [ext('b.two', [{ id: 'other', library: true }])];
    expect(placePages('web', first).tab?.extId).toBe('a.one');
    const after = placePages('web', second);
    expect(after.tab).toBeNull();
    expect(ids(after.library)).toEqual(['b.two/other']);
    expect(placePages('web', [])).toEqual(NO_PLACEMENT);
  });

  it('uses the default icon for an unknown icon name', () => {
    const e = ext('a.one', [{ id: 'main', icon: 'no.such.icon', tab: true }]);
    expect(placePages('web', [e]).tab?.icon).toBe(DEFAULT_PAGE_ICON);
  });
});

describe('tab choices', () => {
  it('lists the tab-capable pages', () => {
    const a = ext('a.one', [{ id: 'main', title: 'Main', tab: true }, { id: 'lib', library: true }], { installedAt: 2 });
    const b = ext('b.two', [{ id: 'x', tab: true }], { installedAt: 1 });
    expect(tabPagesOf(a)).toEqual([{ id: 'main', title: 'Main' }]);
    expect(ids(tabChoices([a, b]))).toEqual(['b.two/x', 'a.one/main']);
    expect(tabChoices([{ ...a, enabled: false }])).toEqual([]);
  });
});

describe('pageTileId', () => {
  it('is not a Jellyfin Id', () => {
    expect(pageTileId({ extId: 'a.one', pageId: 'main' })).toBe('zoggyfin.ext:a.one:main');
  });
});

describe('page icons', () => {
  it('keeps an icon name of the app', () => {
    expect(pageIconName('film')).toBe('film');
    expect(pageTabIcon('film')).toEqual({ sf: 'film', md: 'movie' });
  });

  it('falls back to the default icon', () => {
    expect(pageIconName(undefined)).toBe(DEFAULT_PAGE_ICON);
    expect(pageIconName('')).toBe(DEFAULT_PAGE_ICON);
    expect(pageIconName('toString')).toBe(DEFAULT_PAGE_ICON);
    expect(pageTabIcon('rocket.unknown')).toEqual({ sf: DEFAULT_PAGE_ICON, md: 'grid_view' });
  });
});

describe('chooseTabPage', () => {
  it('sets the page and clears the choice of other extensions', () => {
    const a = ext('a.one', [{ id: 'main', tab: true }], { tab: 'main' });
    const b = ext('b.two', [{ id: 'x', tab: true }, { id: 'y', tab: true }]);
    const c = ext('c.three', [{ id: 'z', tab: true }]);
    expect(chooseTabPage([a, b, c], 'b.two', 'y')).toEqual([
      { extId: 'a.one', page: undefined },
      { extId: 'b.two', page: 'y' },
    ]);
  });

  it('changes nothing when the page is already chosen', () => {
    const a = ext('a.one', [{ id: 'main', tab: true }], { tab: 'main' });
    expect(chooseTabPage([a], 'a.one', 'main')).toEqual([]);
  });
});

const REPLACE: { choice: PhoneTab; tab: '(library)' | '(music)' | '(saved)' | '(search)' }[] = [
  { choice: 'replace:(music)', tab: '(music)' },
  { choice: 'replace:(saved)', tab: '(saved)' },
  { choice: 'replace:(search)', tab: '(search)' },
  { choice: 'replace:(library)', tab: '(library)' },
];
const PHONE_ENV = { downloads: true, liveTab: false };
const visible = (h: Record<string, boolean>) => Object.entries(h).filter(([, hidden]) => !hidden).map(([k]) => k);

describe('On this phone', () => {
  const page = { extId: 'a.one', pageId: 'main', title: 'Main', extensionName: 'Name a.one', icon: 'film' };
  const both = (over: Partial<PlacementExtension> = {}) => ext('a.one', [{ id: 'main', title: 'Main', icon: 'film', tab: true, library: true }], over);

  it('is a Library tile by default, and the bar keeps its five tabs', () => {
    const r = placePages('phone', [both()]);
    expect(r).toEqual({ tab: null, replaces: null, library: [page], tvMenu: [] });
    expect(visible(hiddenTriggers(r, PHONE_ENV))).toEqual(['(home)', '(library)', '(music)', '(saved)', '(search)']);
  });

  it.each(REPLACE)('$choice: the page is a tab in place of $tab, and exactly one tab hides', ({ tab }) => {
    const r = placePages('phone', [both({ phoneTab: tab })]);
    expect(r).toEqual({ tab: page, replaces: tab, library: [], tvMenu: [] });
    const h = hiddenTriggers(r, PHONE_ENV);
    expect(h[tab]).toBe(true);
    expect(h['(home)']).toBe(false);
    expect(h['(ext)']).toBe(false);
    // Never a sixth tab: Android throws on one.
    expect(visible(h)).toHaveLength(5);
  });

  it('shows the chosen tab page of the extension, else its first', () => {
    const two = [{ id: 'one', tab: true }, { id: 'two', tab: true }];
    expect(placePages('phone', [ext('a.one', two, { phoneTab: '(music)' })]).tab?.pageId).toBe('one');
    expect(placePages('phone', [ext('a.one', two, { phoneTab: '(music)', tab: 'two' })]).tab?.pageId).toBe('two');
    // The other tab-capable page stays a tile.
    expect(ids(placePages('phone', [ext('a.one', two, { phoneTab: '(music)', tab: 'two' })]).library)).toEqual(['a.one/one']);
  });

  it('follows the phone choice, not the account tab slot of the other devices', () => {
    const a = ext('a.one', [{ id: 'main', tab: true }], { installedAt: 1, tab: 'main' });
    const b = ext('b.two', [{ id: 'x', tab: true }], { installedAt: 2, phoneTab: '(search)' });
    expect(placePages('phone', [a, b])).toMatchObject({ tab: { extId: 'b.two', pageId: 'x' }, replaces: '(search)' });
    expect(placePages('tablet', [a, b]).tab?.extId).toBe('a.one');
  });

  it('takes the first extension by install date when two have a choice (a sync race)', () => {
    const a = ext('a.one', [{ id: 'main', tab: true }], { installedAt: 5, phoneTab: '(music)' });
    const b = ext('b.two', [{ id: 'x', tab: true }], { installedAt: 2, phoneTab: '(search)' });
    expect(phoneTabPage([a, b])).toMatchObject({ page: { extId: 'b.two' }, replaces: '(search)' });
  });

  it('gives the tab back when the extension is off, removed, has no tab page, or the account has none', () => {
    const on = both({ phoneTab: '(music)' });
    expect(placePages('phone', [on]).replaces).toBe('(music)');
    // Turned off.
    expect(placePages('phone', [{ ...on, enabled: false }])).toEqual(NO_PLACEMENT);
    // Removed (another extension stays).
    const other = ext('b.two', [{ id: 'lib', library: true }]);
    expect(placePages('phone', [other])).toMatchObject({ tab: null, replaces: null });
    // An update took the tab-capable page away: the page is a plain Library tile.
    const noTab = ext('a.one', [{ id: 'main', library: true }], { phoneTab: '(music)' });
    expect(placePages('phone', [noTab])).toMatchObject({ tab: null, replaces: null, library: [{ pageId: 'main' }] });
    // Another account without it.
    expect(placePages('phone', [])).toEqual(NO_PLACEMENT);
    for (const r of [placePages('phone', [{ ...on, enabled: false }]), placePages('phone', [noTab])]) {
      expect(visible(hiddenTriggers(r, PHONE_ENV))).toEqual(['(home)', '(library)', '(music)', '(saved)', '(search)']);
    }
  });

  it('ignores a Downloads choice where there is no Downloads tab', () => {
    expect(placePages('phone', [both({ phoneTab: '(saved)' })], { downloads: false })).toMatchObject({ tab: null, replaces: null });
  });

  it('changes nothing on iPad, the web, the Mac app and TV', () => {
    const exts = [both(), ext('b.two', [{ id: 'tab', tab: true }, { id: 'lib', library: true }], { installedAt: 3 })];
    for (const tab of REPLACE.map((r) => r.tab)) {
      const chosen = [both({ phoneTab: tab }), exts[1]];
      for (const p of ['tablet', 'web', 'desktop', 'tv'] as const) {
        expect(placePages(p, chosen)).toEqual(placePages(p, exts));
        expect(placePages(p, chosen).replaces).toBeNull();
      }
    }
    // The web and the Mac app keep Live TV and the extension slot as before.
    const web = placePages('web', exts);
    expect(visible(hiddenTriggers(web, { downloads: false, liveTab: true }))).toEqual(['(home)', '(library)', '(music)', '(ext)', '(live)', '(search)']);
  });

  it('lists the choices, Home never among them', () => {
    expect(phoneTabChoices({ downloads: true }).map((o) => o.label)).toEqual([
      'Library tile',
      'Tab in place of Music',
      'Tab in place of Downloads',
      'Tab in place of Search',
      'Tab in place of Library',
    ]);
    expect(phoneTabChoices({ downloads: false }).map((o) => o.value)).not.toContain('replace:(saved)');
  });

  it('shows the value of the row only for the extension that is the tab', () => {
    const a = both({ phoneTab: '(music)' });
    const b = ext('b.two', [{ id: 'x', tab: true }], { installedAt: 9 });
    const r = placePages('phone', [a, b]);
    expect(phoneTabValue(r, 'a.one')).toBe('replace:(music)');
    expect(phoneTabValue(r, 'b.two')).toBe('none');
  });

  it('keeps one choice per account', () => {
    const a = ext('a.one', [{ id: 'main', tab: true }], { phoneTab: '(music)' });
    const b = ext('b.two', [{ id: 'x', tab: true }]);
    expect(choosePhoneTab([a, b], 'b.two', 'replace:(search)')).toEqual([
      { extId: 'a.one', tab: undefined },
      { extId: 'b.two', tab: '(search)' },
    ]);
    expect(choosePhoneTab([a, b], 'a.one', 'none')).toEqual([{ extId: 'a.one', tab: undefined }]);
    // A Library tile on one extension leaves the others alone.
    expect(choosePhoneTab([a, b], 'b.two', 'none')).toEqual([]);
    expect(choosePhoneTab([a, b], 'a.one', 'replace:(music)')).toEqual([]);
  });
});
