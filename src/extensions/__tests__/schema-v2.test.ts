import { describePermission, homeRowKey, homeSectionsOfPages, type Manifest, pagesOf, parseManifest } from '../schema';
import { raw, rawV2 } from '../test-utils/fixtures';
import hello from '../../../examples/extensions/hello/zoggyfin-extension.json';

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

const page = rawV2.contributes.pages[0];
const withPages = (pages: unknown[]) => ({ ...rawV2, contributes: { ...rawV2.contributes, pages } });

describe('parseManifest, v1 normalized', () => {
  it('keeps every v1 field and turns each Home row into a one-section page', () => {
    const m = ok(raw);
    expect(m.schemaVersion).toBe(1);
    expect(m.contributes.homeSections).toEqual([{ id: 'latest', title: 'Latest', feed: '/feed', refreshSeconds: 10, shape: 'thumb' }]);
    expect(m.contributes.pages).toEqual([
      {
        id: 'latest',
        title: 'Latest',
        placement: { tab: false, library: false, home: ['latest'] },
        sections: [{ id: 'latest', title: 'Latest', layout: 'row', shape: 'thumb', feed: '/feed', refreshSeconds: 10 }],
      },
    ]);
    expect(m.contributes.itemActions?.[0].id).toBe('greet');
    expect(m.contributes.panels?.[0].id).toBe('main');
  });

  it('reads the pages of a v1 manifest saved before pages existed', () => {
    const m = ok(raw);
    const { pages: _pages, ...saved } = m.contributes;
    expect(pagesOf({ contributes: saved })).toEqual(m.contributes.pages);
    expect(pagesOf({ contributes: {} })).toEqual([]);
  });

  it('reads the v1 sample extension', () => {
    const m = ok(hello);
    expect(m.schemaVersion).toBe(1);
    expect(m.contributes.homeSections?.map((h) => h.id)).toEqual(pagesOf(m).map((p) => p.id));
  });

  it('refuses the v2 permissions in a v1 manifest', () => {
    expect(error({ ...raw, permissions: ['playback'] })).toMatch(/^permissions/);
  });

  it('names the schema version when it is missing', () => {
    const { schemaVersion: _v, ...rest } = raw;
    expect(error(rest)).toMatch(/^schemaVersion: /);
  });
});

describe('parseManifest, v2', () => {
  it('accepts pages, skip labels and the new permissions', () => {
    const m = ok(rawV2);
    expect(m.schemaVersion).toBe(2);
    expect(m.permissions).toEqual(['network', 'playback', 'downloads']);
    expect(m.contributes.pages?.[0].sections.map((s) => [s.id, s.layout, s.shape])).toEqual([
      ['latest', 'row', 'thumb'],
      ['all', 'grid', 'poster'],
      ['queue', 'list', 'thumb'],
    ]);
    expect(m.contributes.pages?.[0].search).toEqual({ feed: '/api/search', placeholder: 'Search Example' });
    expect(m.contributes.skipLabels).toEqual([
      { id: 'intro', title: 'Intro', default: 'ask' },
      { id: 'promo', title: 'Promotion', default: 'auto' },
    ]);
  });

  it('gives the Home rows of the pages as homeSections, so the Home row code reads them', () => {
    const m = ok(rawV2);
    expect(m.contributes.homeSections).toEqual([{ id: 'main:latest', title: 'Latest', feed: '/api/feed/latest', refreshSeconds: 300, shape: 'thumb' }]);
    expect(pagesOf(m)).toBe(m.contributes.pages);
  });

  it('fills defaults: placement off, row layout, thumb shape, ask', () => {
    const m = ok(withPages([{ id: 'p', title: 'P', sections: [{ id: 's', title: 'S', feed: '/f' }] }]));
    expect(m.contributes.pages?.[0].placement).toEqual({ tab: false, library: false, home: [] });
    expect(m.contributes.pages?.[0].sections[0]).toEqual({ id: 's', title: 'S', layout: 'row', shape: 'thumb', feed: '/f' });
    expect(m.contributes.homeSections).toBeUndefined();
    const s = ok({ ...rawV2, contributes: { skipLabels: [{ id: 'recap', title: 'Recap' }] } });
    expect(s.contributes.skipLabels?.[0].default).toBe('ask');
  });

  it('keeps a minimal v2 manifest empty', () => {
    const m = ok({ schemaVersion: 2, id: 'min', name: 'Min', version: '1', baseUrl: 'https://ext.example' });
    expect(m.permissions).toEqual(['network']);
    expect(m.contributes).toEqual({});
  });

  it('keeps the v1 lists except homeSections', () => {
    const m = ok({ ...rawV2, contributes: { ...raw.contributes, pages: [page] } });
    expect(m.contributes.itemActions?.[0].id).toBe('greet');
    expect(m.contributes.shareTargets?.[0].id).toBe('send');
    // A v2 Home row is a page section; the v1 list is ignored.
    expect(m.contributes.homeSections?.map((h) => h.id)).toEqual(['main:latest']);
  });

  it('names the first bad field', () => {
    expect(error(withPages([{ ...page, id: 'Bad Id' }]))).toMatch(/^contributes\.pages\.0\.id: /);
    expect(error(withPages([{ ...page, title: '' }]))).toMatch(/^contributes\.pages\.0\.title: /);
    expect(error(withPages([{ ...page, placement: { tab: 'yes' } }]))).toMatch(/^contributes\.pages\.0\.placement\.tab: /);
    expect(error(withPages([{ ...page, search: { placeholder: 'x' } }]))).toMatch(/^contributes\.pages\.0\.search\.feed: /);
    expect(error(withPages([{ ...page, sections: [{ ...page.sections[0], layout: 'carousel' }] }]))).toMatch(/^contributes\.pages\.0\.sections\.0\.layout: /);
    expect(error(withPages([{ ...page, sections: [{ ...page.sections[0], shape: 'round' }] }]))).toMatch(/^contributes\.pages\.0\.sections\.0\.shape: /);
    expect(error(withPages([{ ...page, sections: [{ ...page.sections[0], feed: '' }] }]))).toMatch(/^contributes\.pages\.0\.sections\.0\.feed: /);
    expect(error(withPages([{ ...page, sections: [{ ...page.sections[0], refreshSeconds: 1 }] }]))).toMatch(/^contributes\.pages\.0\.sections\.0\.refreshSeconds: /);
    expect(error(withPages([{ ...page, sections: [] }]))).toMatch(/^contributes\.pages\.0\.sections: /);
    expect(error({ ...rawV2, contributes: { skipLabels: [{ id: 'intro', title: 'Intro', default: 'always' }] } })).toMatch(/^contributes\.skipLabels\.0\.default: /);
    expect(error({ ...rawV2, permissions: ['camera'] })).toMatch(/^permissions/);
  });

  it('keeps the limits: 5 pages, 8 sections per page, 10 skip labels', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ ...page, id: `p${i}`, placement: undefined }));
    expect(error(withPages(pages))).toMatch(/^contributes\.pages: /);
    expect(ok(withPages(pages.slice(0, 5))).contributes.pages).toHaveLength(5);
    const sections = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, title: 'S', feed: '/f' }));
    expect(error(withPages([{ id: 'p', title: 'P', sections }]))).toMatch(/^contributes\.pages\.0\.sections: /);
    expect(ok(withPages([{ id: 'p', title: 'P', sections: sections.slice(0, 8) }])).contributes.pages?.[0].sections).toHaveLength(8);
    const labels = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, title: 'L' }));
    expect(error({ ...rawV2, contributes: { skipLabels: labels } })).toMatch(/^contributes\.skipLabels: /);
  });

  it('refuses an id used twice in each list', () => {
    expect(error(withPages([page, page]))).toMatch(/^contributes\.pages: the id "main" is used twice/);
    expect(error(withPages([{ ...page, sections: [page.sections[0], page.sections[0]] }]))).toMatch(/^contributes\.pages\.0\.sections: the id "latest" is used twice/);
    expect(error({ ...rawV2, contributes: { skipLabels: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] } })).toMatch(/^contributes\.skipLabels: the id "a" is used twice/);
    expect(error(withPages([{ ...page, placement: { home: ['latest', 'latest'] } }]))).toMatch(/placement\.home: the id "latest" is used twice/);
  });

  it('refuses a Home row that names no section of the page', () => {
    expect(error(withPages([{ ...page, placement: { home: ['nope'] } }]))).toBe('contributes.pages.0.placement.home: the page has no section "nope"');
  });

  it('refuses a schema version it does not read', () => {
    expect(error({ ...rawV2, schemaVersion: 3 })).toMatch(/versions 1 and 2.*version 3/);
    expect(error({ ...rawV2, schemaVersion: '2' })).toMatch(/has version 2\.$/);
  });
});

describe('Home row keys', () => {
  it('keeps the section id for a v1 page and joins page and section for v2', () => {
    expect(homeRowKey('latest', 'latest')).toBe('latest');
    expect(homeRowKey('main', 'latest')).toBe('main:latest');
  });

  it('follows page order, then placement order', () => {
    const rows = homeSectionsOfPages([
      { id: 'a', title: 'A', placement: { tab: false, library: false, home: ['y', 'x'] }, sections: [
        { id: 'x', title: 'X', layout: 'row', shape: 'thumb', feed: '/x' },
        { id: 'y', title: 'Y', layout: 'grid', shape: 'poster', feed: '/y' },
      ] },
      { id: 'b', title: 'B', placement: { tab: true, library: false, home: ['z'] }, sections: [{ id: 'z', title: 'Z', layout: 'row', shape: 'square', feed: '/z' }] },
    ]);
    expect(rows.map((r) => [r.id, r.shape])).toEqual([
      ['a:y', 'poster'],
      ['a:x', 'thumb'],
      ['b:z', 'square'],
    ]);
  });
});

describe('describePermission, v2', () => {
  it('describes playback and downloads with the host', () => {
    const m = { name: 'Example Media', baseUrl: 'https://media.example.org' };
    expect(describePermission('playback', m)).toMatchObject({ title: 'Play media from media.example.org', sensitive: false });
    expect(describePermission('downloads', m)).toMatchObject({ title: 'Save files from media.example.org', sensitive: false });
  });
});
