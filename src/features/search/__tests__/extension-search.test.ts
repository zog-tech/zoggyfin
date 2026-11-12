import { withFeedParams } from '@/extensions/feeds/paging';
import { buildRequest } from '@/extensions/http';
import { type Manifest, parseManifest } from '@/extensions/schema';
import { rawV2 } from '@/extensions/test-utils/fixtures';
import type { InstalledExtension } from '@/extensions/types';

import { globalSearches, globalSearchQuery, globalSectionView, MAX_GLOBAL_SEARCHES } from '../extension-search';

function manifest(data: unknown): Manifest {
  const r = parseManifest(data);
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

const grants = { itemPath: false, jellyfinToken: false, playback: true, downloads: false };

function installed(m: Manifest, enabled = true): InstalledExtension {
  return { manifestUrl: `${m.baseUrl}/manifest.json`, manifest: m, enabled, grants, installedAt: 0 };
}

type Page = Record<string, unknown>;
const withPages = (id: string, pages: Page[]) => ({ ...rawV2, id, name: `Name ${id}`, contributes: { pages } });
const sec = (sid: string, extra: object = {}) => ({ id: sid, title: sid, feed: `/api/${sid}`, ...extra });
const page = (pid: string, extra: Page = {}): Page => ({ id: pid, title: `Page ${pid}`, sections: [sec(`${pid}-row`), sec(`${pid}-grid`, { layout: 'grid', shape: 'poster' })], ...extra });

describe('the search contract', () => {
  it('reads `global` and `title`, and leaves them out of a search without them', () => {
    const m = manifest(withPages('org.example.a', [page('films', { search: { feed: '/api/search', global: true, title: 'From the catalogue' } }), page('other', { search: { feed: '/api/other' } })]));
    expect(m.contributes.pages?.[0].search).toEqual({ feed: '/api/search', global: true, title: 'From the catalogue' });
    expect(m.contributes.pages?.[1].search).toEqual({ feed: '/api/other' });
  });

  it('refuses a title that is too long or empty, and a `global` that is not a boolean', () => {
    for (const search of [{ feed: '/s', title: 'x'.repeat(41) }, { feed: '/s', title: '  ' }, { feed: '/s', global: 'yes' }]) {
      expect(parseManifest(withPages('org.example.a', [page('p', { search })])).ok).toBe(false);
    }
  });

  it('reads a tab search with `global`', () => {
    const tabs = [
      { id: 't1', title: 'One', sections: [sec('a')] },
      { id: 't2', title: 'Two', sections: [sec('b', { layout: 'grid', shape: 'square' })], search: { feed: '/api/tab-search', global: true } },
    ];
    const m = manifest(withPages('org.example.a', [{ id: 'p', title: 'Tabbed', tabs }]));
    expect(m.contributes.pages?.[0].tabs?.[1].search).toEqual({ feed: '/api/tab-search', global: true });
  });
});

describe('globalSearches', () => {
  const globalExt = manifest(withPages('org.example.global', [page('films', { search: { feed: '/api/films/search', global: true, title: 'From IPTV' } })]));
  const plainExt = manifest(rawV2);

  it('runs a search with `global: true` and never one without it', () => {
    expect(globalSearches([installed(plainExt), installed(globalExt)])).toEqual([
      { key: 'org.example.global:/api/films/search', extId: 'org.example.global', extensionName: 'Name org.example.global', feed: '/api/films/search', title: 'From IPTV', shape: 'poster' },
    ]);
    expect(globalSearches([installed(plainExt)])).toEqual([]);
  });

  it('skips an extension that is turned off', () => {
    expect(globalSearches([installed(globalExt, false)])).toEqual([]);
  });

  it('titles a section with the page title when the search has no title, and uses wide tiles with no grid', () => {
    const m = manifest(withPages('org.example.b', [{ id: 'p', title: 'Shows', sections: [sec('r')], search: { feed: '/api/s', global: true } }]));
    expect(globalSearches([installed(m)])[0]).toMatchObject({ title: 'Shows', shape: 'thumb' });
  });

  it('orders by extension, page, then the page search before tab searches; one request per feed', () => {
    const tabs = [
      { id: 't1', title: 'One', sections: [sec('a', { layout: 'grid', shape: 'square' })] },
      { id: 't2', title: 'Two', sections: [sec('b')], search: { feed: '/api/t2', global: true, title: 'Tab two' } },
      { id: 't3', title: 'Three', sections: [sec('c')], search: { feed: '/api/page', global: true } },
    ];
    const a = manifest(withPages('org.example.a', [{ id: 'p1', title: 'Tabbed', tabs, search: { feed: '/api/page', global: true } }, page('p2', { search: { feed: '/api/p2', global: true } })]));
    const b = manifest(withPages('org.example.b', [page('q', { search: { feed: '/api/page', global: true } })]));
    const out = globalSearches([installed(b), installed(a)]);
    expect(out.map((s) => s.key)).toEqual(['org.example.b:/api/page', 'org.example.a:/api/page', 'org.example.a:/api/t2', 'org.example.a:/api/p2']);
    // The page search shows with the shape of the first tab that uses it.
    expect(out[1]).toMatchObject({ title: 'Tabbed', shape: 'square' });
    expect(out[2]).toMatchObject({ title: 'Tab two', shape: 'thumb' });
  });

  it('runs at most MAX_GLOBAL_SEARCHES feeds', () => {
    const many = Array.from({ length: 5 }, (_, i) => installed(manifest(withPages(`org.example.n${i}`, [page('p', { search: { feed: '/api/s', global: true } })]))));
    expect(globalSearches(many)).toHaveLength(MAX_GLOBAL_SEARCHES);
    expect(globalSearches(many).map((s) => s.extId)).toEqual(['org.example.n0', 'org.example.n1', 'org.example.n2', 'org.example.n3']);
  });

  it('builds the request on the extension origin with the query on the URL', () => {
    const s = globalSearches([installed(globalExt)])[0];
    const req = withFeedParams(buildRequest(globalExt, { method: 'GET', path: s.feed }, { settings: {} }, grants, null), { query: 'the matrix' });
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://media.example.org/api/films/search?query=the+matrix');
    expect(req.headers.Authorization).toBeUndefined();
  });
});

describe('globalSearchQuery', () => {
  const on = { offline: false, genre: null, filter: 'all' as const };

  it('needs 2 characters after trimming', () => {
    expect(globalSearchQuery(' a ', on)).toBe('');
    expect(globalSearchQuery(' ab ', on)).toBe('ab');
  });

  it('does not run offline, in a genre, or under a filter with no films or shows', () => {
    expect(globalSearchQuery('matrix', { ...on, offline: true })).toBe('');
    expect(globalSearchQuery('matrix', { ...on, genre: 'Drama' })).toBe('');
    expect(globalSearchQuery('matrix', { ...on, filter: 'music' })).toBe('');
    expect(globalSearchQuery('matrix', { ...on, filter: 'people' })).toBe('');
    expect(globalSearchQuery('matrix', { ...on, filter: 'movies' })).toBe('matrix');
    expect(globalSearchQuery('matrix', { ...on, filter: 'shows' })).toBe('matrix');
  });

  it('cuts a long text to the feed limit', () => {
    expect(globalSearchQuery('x'.repeat(300), on)).toHaveLength(200);
  });
});

describe('globalSectionView', () => {
  it('shows a loading line, then the rows; empty and failed take no room', () => {
    expect(globalSectionView({ status: 'loading', count: 0 })).toBe('loading');
    expect(globalSectionView({ status: 'ready', count: 3 })).toBe('rows');
    expect(globalSectionView({ status: 'ready', count: 0 })).toBe('hidden');
    expect(globalSectionView({ status: 'error', count: 0 })).toBe('hidden');
  });
});
