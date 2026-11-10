import { parseManifest } from '@/extensions/schema';
import { rawV2 } from '@/extensions/test-utils/fixtures';

import { initialTabIndex, onTabRequest, rememberTab, requestTab, resetRememberedTabs, tabSearch } from '../page-tabs';
import { resolveHomeRow, resolvePageRoute } from '../routes';

const sec = (id: string) => ({ id, title: id, feed: `/api/${id}` });
const tabs = [
  { id: 'a', title: 'A', sections: [sec('a1'), sec('a2')] },
  { id: 'b', title: 'B', sections: [sec('b1')], search: { feed: '/api/search/b' } },
  { id: 'c', title: 'C', sections: [sec('c1')] },
];

function manifest(page: object) {
  const r = parseManifest({ ...rawV2, contributes: { pages: [{ id: 'main', title: 'Main', ...page }] } });
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

describe('page tabs', () => {
  beforeEach(resetRememberedTabs);

  it('opens on the first tab, then on the tab chosen last on that page in this session', () => {
    expect(initialTabIndex(tabs, 'ext', 'main')).toBe(0);
    rememberTab('ext', 'main', 'c');
    expect(initialTabIndex(tabs, 'ext', 'main')).toBe(2);
    expect(initialTabIndex(tabs, 'ext', 'other')).toBe(0);
    expect(initialTabIndex(tabs, 'ext2', 'main')).toBe(0);
  });

  it('opens on the first tab when the remembered one is gone after an update', () => {
    rememberTab('ext', 'main', 'gone');
    expect(initialTabIndex(tabs, 'ext', 'main')).toBe(0);
  });

  it('a tab request tells the open pages and is remembered for a page that opens next', () => {
    const seen: string[] = [];
    const stop = onTabRequest((e, p, t) => seen.push(`${e}/${p}/${t}`));
    requestTab('ext', 'main', 'b');
    stop();
    requestTab('ext', 'main', 'c');
    expect(seen).toEqual(['ext/main/b']);
    expect(initialTabIndex(tabs, 'ext', 'main')).toBe(2);
  });

  it('uses the tab search, else the page search', () => {
    const page = { search: { feed: '/api/search' } };
    expect(tabSearch(tabs[1], page)).toEqual({ feed: '/api/search/b' });
    expect(tabSearch(tabs[0], page)).toEqual({ feed: '/api/search' });
    expect(tabSearch(tabs[0], {})).toBeUndefined();
  });

  it('routes a page with tabs to its tabs, and "See all" to a section inside a tab', () => {
    const m = manifest({ tabs, sections: [sec('flat')], placement: { home: ['b1'] } });
    const route = resolvePageRoute(m, { page: 'main' });
    expect(route?.tabs?.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    const seeAll = resolvePageRoute(m, { page: 'main', section: 'a2' });
    expect(seeAll?.tabs).toBeUndefined();
    expect(seeAll?.section?.id).toBe('a2');
    expect(resolvePageRoute(m, { page: 'main', section: 'flat' })?.section?.id).toBe('flat');
    expect(resolveHomeRow(m, 'main:b1')?.section.feed).toBe('/api/b1');
  });

  it('routes a page without tabs as before', () => {
    const route = resolvePageRoute(manifest({ sections: [sec('x')] }), { page: 'main' });
    expect(route?.tabs).toBeUndefined();
    expect(route?.sections.map((s) => s.id)).toEqual(['x']);
  });
});
