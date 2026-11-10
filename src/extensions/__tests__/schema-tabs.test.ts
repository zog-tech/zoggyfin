import { findPageSection, homeRowKey, type Manifest, pageSections, parseManifest } from '../schema';
import { readSavedManifest } from '../migrate';
import { rawV2 } from '../test-utils/fixtures';

function ok(data: unknown): Manifest {
  const r = parseManifest(data);
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

function error(data: unknown): string {
  const r = parseManifest(data);
  if (r.ok) throw new Error('expected an error');
  return r.error;
}

const sec = (id: string, extra: object = {}) => ({ id, title: id.toUpperCase(), feed: `/api/${id}`, ...extra });
const tabs = [
  { id: 'films', title: 'Films', sections: [sec('new'), sec('all', { layout: 'grid' })], search: { feed: '/api/search/films' } },
  { id: 'shows', title: 'Shows', sections: [sec('airing'), sec('later', { layout: 'list' })] },
];
const withPage = (page: object) => ({ ...rawV2, contributes: { ...rawV2.contributes, pages: [{ id: 'main', title: 'Main', ...page }] } });

describe('page tabs', () => {
  it('reads a page with only tabs; its sections are the first tab’s, for app versions without tabs', () => {
    const p = ok(withPage({ tabs, search: { feed: '/api/search' } })).contributes.pages![0];
    expect(p.tabs?.map((t) => t.id)).toEqual(['films', 'shows']);
    expect(p.tabs?.[1].sections[1]).toMatchObject({ id: 'later', layout: 'list', shape: 'thumb' });
    expect(p.tabs?.[0].search).toEqual({ feed: '/api/search/films' });
    expect(p.sections.map((s) => s.id)).toEqual(['new', 'all']);
    expect(pageSections(p).map((s) => s.id)).toEqual(['new', 'all', 'airing', 'later']);
  });

  it('lets tabs win over sections, and keeps sections as the fallback', () => {
    const p = ok(withPage({ tabs, sections: [sec('flat')] })).contributes.pages![0];
    expect(p.tabs).toHaveLength(2);
    expect(p.sections.map((s) => s.id)).toEqual(['flat']);
    expect(pageSections(p).map((s) => s.id)).toEqual(['new', 'all', 'airing', 'later']);
  });

  it('falls back to sections when tabs are not valid', () => {
    for (const bad of ['x', [tabs[0]], [...tabs, ...[3, 4, 5, 6, 7].map((n) => ({ ...tabs[0], id: `t${n}`, sections: [sec(`s${n}`)] }))], [tabs[0], { ...tabs[1], id: 'films' }], [tabs[0], { ...tabs[1], sections: [sec('new')] }], [tabs[0], { ...tabs[1], sections: [] }]]) {
      const p = ok(withPage({ tabs: bad, sections: [sec('flat')] })).contributes.pages![0];
      expect(p.tabs).toBeUndefined();
      expect(p.sections.map((s) => s.id)).toEqual(['flat']);
    }
  });

  it('refuses a page whose tabs are not valid and that has no sections, naming the field', () => {
    expect(error(withPage({ tabs: [tabs[0]] }))).toMatch(/^contributes\.pages\.0\.tabs: /);
    expect(error(withPage({ tabs: [tabs[0], { ...tabs[1], id: 'films' }] }))).toBe('contributes.pages.0.tabs: the id "films" is used twice');
    expect(error(withPage({ tabs: [tabs[0], { ...tabs[1], sections: [sec('all')] }] }))).toBe('contributes.pages.0.tabs: the section id "all" is used twice');
    expect(error(withPage({ tabs: [tabs[0], { ...tabs[1], title: '' }] }))).toMatch(/^contributes\.pages\.0\.tabs\.1\.title: /);
    expect(error(withPage({}))).toBe('contributes.pages.0.sections: a page needs sections or tabs');
  });

  it('keeps the section limit per tab', () => {
    const nine = Array.from({ length: 9 }, (_, i) => sec(`x${i}`));
    expect(error(withPage({ tabs: [tabs[0], { ...tabs[1], sections: nine }] }))).toMatch(/^contributes\.pages\.0\.tabs\.1\.sections: /);
  });

  it('lets a Home row name a section inside any tab', () => {
    const m = ok(withPage({ tabs, placement: { home: ['airing', 'new'] } }));
    expect(m.contributes.homeSections?.map((h) => [h.id, h.feed])).toEqual([
      [homeRowKey('main', 'airing'), '/api/airing'],
      [homeRowKey('main', 'new'), '/api/new'],
    ]);
    expect(error(withPage({ tabs, placement: { home: ['nope'] } }))).toBe('contributes.pages.0.placement.home: the page has no section "nope"');
    expect(findPageSection(m.contributes.pages![0], 'later')?.layout).toBe('list');
  });

  it('reads its own saved model again, so a restart keeps the tabs', () => {
    const m = ok(withPage({ tabs, placement: { home: ['airing'] } }));
    const again = readSavedManifest(JSON.parse(JSON.stringify(m)));
    expect(again?.contributes.pages).toEqual(m.contributes.pages);
  });
});
