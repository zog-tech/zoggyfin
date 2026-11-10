import { readEntry, type FeedEntry } from '@/extensions/feeds';
import { parseManifest, type Manifest } from '@/extensions/schema';

import { firstParam, parseEntryRoute, resolveHomeRow, resolvePageRoute } from '../routes';
import { emptyAction, emptyText, entryTap, failedText, sectionBody, sectionMode, tileOfEntry } from '../section-view';

const base = 'https://media.example.org';

function v2(): Manifest {
  const r = parseManifest({
    schemaVersion: 2,
    id: 'org.example.media',
    name: 'Example Media',
    version: '2.0.0',
    baseUrl: base,
    contributes: {
      pages: [
        {
          id: 'main',
          title: 'Example',
          placement: { home: ['latest', 'queue'] },
          search: { feed: '/api/search' },
          sections: [
            { id: 'latest', title: 'Latest', layout: 'row', feed: '/api/latest' },
            { id: 'queue', title: 'Queue', layout: 'list', feed: '/api/queue' },
            { id: 'all', title: 'Everything', layout: 'grid', shape: 'poster', feed: '/api/all' },
          ],
        },
        { id: 'more', title: 'More', placement: { home: ['latest'] }, sections: [{ id: 'latest', title: 'More latest', feed: '/api/more' }] },
      ],
    },
  });
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

function v1(): Manifest {
  const r = parseManifest({
    schemaVersion: 1,
    id: 'org.example.old',
    name: 'Old',
    version: '1.0.0',
    baseUrl: base,
    contributes: { homeSections: [{ id: 'picks', title: 'Picks', feed: '/picks' }] },
  });
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

const entry = (raw: Record<string, unknown>): FeedEntry => {
  const e = readEntry(raw, 0, base);
  if (!e) throw new Error('bad entry');
  return e;
};

describe('section modes', () => {
  const sections = v2().contributes.pages![0].sections;

  it('makes the last grid or list infinite and earlier ones previews', () => {
    expect(sections.map((_, i) => sectionMode(sections, i))).toEqual(['row', 'preview', 'infinite']);
  });

  it('keeps a row a row, even when it is last', () => {
    expect(sectionMode([{ layout: 'grid' }, { layout: 'row' }], 1)).toBe('row');
    expect(sectionMode([{ layout: 'grid' }, { layout: 'row' }], 0)).toBe('preview');
  });

  it('makes a section on its own infinite', () => {
    expect(sectionMode([{ layout: 'list' }], 0)).toBe('infinite');
  });
});

describe('section body', () => {
  it('shows entries whenever there are some, also after a failed refresh', () => {
    expect(sectionBody({ status: 'ready', count: 3 }, 'row', 'page')).toBe('entries');
    expect(sectionBody({ status: 'error', count: 3 }, 'row', 'home')).toBe('entries');
  });

  it('shows a note for a section that failed, on a page and on Home', () => {
    expect(sectionBody({ status: 'error', count: 0 }, 'row', 'page')).toBe('failed');
    expect(sectionBody({ status: 'error', count: 0 }, 'row', 'home')).toBe('failed');
    expect(failedText('Example Media')).toBe('Example Media is not available now.');
  });

  it('takes no room on Home while loading or when empty', () => {
    expect(sectionBody({ status: 'loading', count: 0 }, 'row', 'home')).toBe('hidden');
    expect(sectionBody({ status: 'ready', count: 0 }, 'row', 'home')).toBe('hidden');
  });

  it('shows a placeholder on a page while loading', () => {
    expect(sectionBody({ status: 'loading', count: 0 }, 'preview', 'page')).toBe('placeholder');
    expect(sectionBody({ status: 'loading', count: 0 }, 'infinite', 'page')).toBe('placeholder');
  });

  it('says why a section is empty with the feed message, and offers its panel button only where panels exist', () => {
    expect(emptyText(undefined)).toBe('Nothing here yet.');
    expect(emptyText('Sign in to see your list.')).toBe('Sign in to see your list.');
    const action = { title: 'Sign in', panel: 'account' };
    expect(emptyAction(action, true)).toBe(action);
    expect(emptyAction(action, false)).toBeNull();
    expect(emptyAction(undefined, true)).toBeNull();
  });

  it('keeps an empty section on a page with its title, for every mode', () => {
    // A page never drops a section without a word: an empty row or preview keeps its title and says so.
    expect(sectionBody({ status: 'ready', count: 0 }, 'row', 'page')).toBe('empty');
    expect(sectionBody({ status: 'ready', count: 0 }, 'preview', 'page')).toBe('empty');
    expect(sectionBody({ status: 'ready', count: 0 }, 'infinite', 'page')).toBe('empty');
  });
});

describe('entry tap order', () => {
  const all = { id: 'e1', itemId: 'j1', title: 'An entry', detail: '/api/e1', media: { id: 'e1', playback: '/api/e1/play' }, panel: 'p', link: 'https://example.org/e1' };
  const on = { hasItem: true, panels: true };

  it('opens a Jellyfin item first, when it loaded', () => {
    expect(entryTap(entry(all), on)).toEqual({ kind: 'item', itemId: 'j1' });
  });

  it('then the detail page, then playback, then a panel, then a link', () => {
    expect(entryTap(entry(all), { ...on, hasItem: false })).toEqual({ kind: 'detail', url: `${base}/api/e1` });
    const { detail: _d, ...noDetail } = all;
    expect(entryTap(entry(noDetail), { ...on, hasItem: false })).toMatchObject({ kind: 'media', media: { id: 'e1', playback: `${base}/api/e1/play` } });
    const { media: _m, ...noMedia } = noDetail;
    expect(entryTap(entry(noMedia), { ...on, hasItem: false })).toEqual({ kind: 'panel', panel: 'p' });
    const { panel: _p, ...noPanel } = noMedia;
    expect(entryTap(entry(noPanel), { ...on, hasItem: false })).toEqual({ kind: 'link', url: 'https://example.org/e1' });
  });

  it('skips media that can only be saved', () => {
    expect(entryTap(entry({ title: 'A', media: { id: 'm', download: '/d' }, link: 'https://example.org/' }), on)).toEqual({ kind: 'link', url: 'https://example.org/' });
  });

  it('says so when a panel is the only target and the platform has none (TV)', () => {
    expect(entryTap(entry({ title: 'A', panel: 'p' }), { hasItem: false, panels: false })).toEqual({ kind: 'no-panel' });
    expect(entryTap(entry({ title: 'A', panel: 'p', link: 'https://example.org/' }), { hasItem: false, panels: false })).toEqual({ kind: 'link', url: 'https://example.org/' });
  });

  it('does nothing for an entry with no target', () => {
    expect(entryTap(entry({ title: 'A' }), on)).toBeNull();
    expect(entryTap(entry({ itemId: 'j1', title: 'A' }), { hasItem: false, panels: true })).toBeNull();
  });
});

describe('tile of an entry', () => {
  it('carries the card fields and the media kind', () => {
    expect(tileOfEntry(entry({ id: 'e1', title: 'A', subtitle: 'B', image: '/a.jpg', progress: 0.5, badge: 'New', media: { id: 'm', kind: 'audio', playback: '/p' } }))).toEqual({
      key: 'e1',
      id: 'e1',
      kind: 'audio',
      title: 'A',
      subtitle: 'B',
      poster: `${base}/a.jpg`,
      progress: 0.5,
      badge: 'New',
    });
    expect(tileOfEntry(entry({ title: 'A' }))).toMatchObject({ key: '0', id: '0', kind: 'video', poster: null, progress: null, badge: null });
  });
});

describe('page route params', () => {
  it('finds the page, or one of its sections for "See all"', () => {
    const m = v2();
    expect(resolvePageRoute(m, { page: 'main' })?.sections.map((s) => s.id)).toEqual(['latest', 'queue', 'all']);
    const one = resolvePageRoute(m, { page: ['main'], section: 'queue' });
    expect(one?.section?.id).toBe('queue');
    expect(one?.sections.map((s) => s.id)).toEqual(['queue']);
  });

  it('gives null for an unknown page or section, or no manifest', () => {
    expect(resolvePageRoute(v2(), { page: 'nope' })).toBeNull();
    expect(resolvePageRoute(v2(), { page: 'main', section: 'nope' })).toBeNull();
    expect(resolvePageRoute(v2(), {})).toBeNull();
    expect(resolvePageRoute(undefined, { page: 'main' })).toBeNull();
  });

  it('reads the first value of a param', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('')).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe('Home rows', () => {
  it('maps a Home row id back to its page and section', () => {
    const m = v2();
    const ids = (m.contributes.homeSections ?? []).map((h) => h.id);
    expect(ids).toEqual(['main:latest', 'main:queue', 'more:latest']);
    expect(resolveHomeRow(m, 'main:queue')).toMatchObject({ page: { id: 'main' }, section: { id: 'queue', layout: 'list' } });
    expect(resolveHomeRow(m, 'more:latest')).toMatchObject({ page: { id: 'more' }, section: { feed: '/api/more' } });
    expect(resolveHomeRow(m, 'main:all')).toBeNull();
  });

  it('keeps a v1 Home row under its own id', () => {
    expect(resolveHomeRow(v1(), 'picks')).toMatchObject({ page: { id: 'picks' }, section: { id: 'picks', layout: 'row', feed: '/picks' } });
    expect(resolveHomeRow(v1(), 'nope')).toBeNull();
  });
});

describe('entry route params', () => {
  it('reads the params and keeps the detail URL on the origin', () => {
    expect(parseEntryRoute({ ext: 'org.example.media', entry: 'e1', detail: `${base}/api/e1`, title: 'An entry' }, base)).toEqual({
      extId: 'org.example.media',
      entryId: 'e1',
      detail: `${base}/api/e1`,
      title: 'An entry',
    });
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: '/api/e1' }, base)).toEqual({ extId: 'x', entryId: 'e1', detail: `${base}/api/e1` });
  });

  it('refuses a detail URL on another origin, or missing values', () => {
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: 'https://other.example.net/api/e1' }, base)).toBeNull();
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: `${base}/api/e1` }, undefined)).toBeNull();
    expect(parseEntryRoute({ ext: 'x', detail: `${base}/api/e1` }, base)).toBeNull();
    expect(parseEntryRoute({ ext: 'x', entry: 'e1' }, base)).toBeNull();
  });
});

describe('the Hello Pages sample', () => {
  it('is a valid version 2 manifest with a row, a list and a paging grid', () => {
    const r = parseManifest(require('../../../../examples/extensions/hello/pages-extension.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const page = r.manifest.contributes.pages![0];
    expect(page.sections.map((s) => s.layout)).toEqual(['row', 'list', 'grid']);
    expect(page.sections.map((_, i) => sectionMode(page.sections, i))).toEqual(['row', 'preview', 'infinite']);
    expect(page.search?.feed).toBe('/pages/search');
    expect(r.manifest.contributes.homeSections?.map((h) => h.id)).toEqual(['main:latest']);
  });
});
