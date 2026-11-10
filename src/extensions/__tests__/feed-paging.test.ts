import { createGate } from '@/lib/async-gate';

import {
  extensionFeedsKey,
  feedQueryKey,
  fetchFeedPage,
  flattenPages,
  isCapped,
  latestOnly,
  MAX_FEED_PAGES,
  MAX_QUERY_LENGTH,
  nextCursor,
  normalizeQuery,
  StaleSearchError,
  withFeedParams,
} from '../feeds';
import { buildRequest, type BuiltRequest } from '../http';
import { manifest } from '../test-utils/fixtures';

const base: BuiltRequest = { url: 'https://media.example.org/api/feed?sort=new', method: 'GET', headers: { Accept: 'application/json' } };
const scope = { serverId: 's1', userId: 'u1' };

describe('withFeedParams', () => {
  it('leaves the first page without a cursor', () => {
    expect(withFeedParams(base, {}).url).toBe('https://media.example.org/api/feed?sort=new');
    expect(withFeedParams(base, { cursor: null }).url).toBe('https://media.example.org/api/feed?sort=new');
  });

  it('adds the cursor and the search text, encoded, on the same origin', () => {
    const r = withFeedParams(base, { cursor: 'a b&c={{settings.apiKey}}', query: 'night & day' });
    const url = new URL(r.url);
    expect(url.origin).toBe('https://media.example.org');
    expect(url.searchParams.get('cursor')).toBe('a b&c={{settings.apiKey}}');
    expect(url.searchParams.get('query')).toBe('night & day');
    expect(url.searchParams.get('sort')).toBe('new');
    expect(r.headers).toBe(base.headers);
  });

  it('never fills templates in a cursor', async () => {
    const m = manifest();
    const sent: string[] = [];
    await fetchFeedPage(
      () => buildRequest(m, { method: 'GET', path: '/feed' }, { settings: { apiKey: 'secret' } }, { itemPath: false, jellyfinToken: false }, null),
      m.baseUrl,
      { cursor: '{{settings.apiKey}}' },
      {
        send: async (req) => {
          sent.push(req.url);
          return { items: [{ title: 'A' }], next: 'p2' };
        },
      },
    );
    expect(sent[0]).not.toContain('secret');
    expect(new URL(sent[0]).searchParams.get('cursor')).toBe('{{settings.apiKey}}');
  });
});

describe('fetchFeedPage', () => {
  it('returns the parsed page with its next cursor', async () => {
    const page = await fetchFeedPage(() => base, 'https://media.example.org', {}, { send: async () => ({ items: [{ id: 'e1', title: 'A', image: '/a.jpg' }], next: 'p2' }) });
    expect(page.next).toBe('p2');
    expect(page.entries[0]).toMatchObject({ key: 'e1', imageUrl: 'https://media.example.org/a.jpg' });
  });

  it('throws when the reply is not a feed', async () => {
    await expect(fetchFeedPage(() => base, 'https://media.example.org', {}, { send: async () => ({ nope: 1 }) })).rejects.toThrow('The feed is not in the expected format.');
  });
});

describe('nextCursor', () => {
  it('follows next until the feed ends', () => {
    expect(nextCursor([])).toBeUndefined();
    expect(nextCursor([{ cursor: null, next: 'p2' }])).toBe('p2');
    expect(nextCursor([{ cursor: null, next: 'p2' }, { cursor: 'p2', next: null }])).toBeUndefined();
  });

  it('stops at a cursor the feed sent before', () => {
    expect(nextCursor([{ cursor: null, next: 'p2' }, { cursor: 'p2', next: 'p2' }])).toBeUndefined();
    expect(nextCursor([{ cursor: null, next: 'p2' }, { cursor: 'p2', next: 'p3' }, { cursor: 'p3', next: 'p2' }])).toBeUndefined();
  });

  it('stops at the page cap and reports it', () => {
    const pages = Array.from({ length: MAX_FEED_PAGES }, (_, i) => ({ cursor: i ? `p${i}` : null, next: `p${i + 1}` }));
    expect(nextCursor(pages.slice(0, -1))).toBe(`p${MAX_FEED_PAGES - 1}`);
    expect(nextCursor(pages)).toBeUndefined();
    expect(isCapped(pages)).toBe(true);
    expect(isCapped(pages.slice(0, -1))).toBe(false);
    expect(isCapped([...pages.slice(0, -1), { cursor: 'x', next: null }])).toBe(false);
  });
});

describe('flattenPages', () => {
  it('keeps the order and shows each key once', () => {
    const row = (key: string, title = key) => ({ entry: { key, title } });
    const rows = flattenPages([{ entries: [row('a'), row('b')] }, { entries: [row('b', 'moved'), row('c')] }]);
    expect(rows.map((r) => r.entry.key)).toEqual(['a', 'b', 'c']);
    expect(rows[1].entry.title).toBe('b');
  });
});

describe('query keys', () => {
  it('sit under the session scope and the extension', () => {
    expect(extensionFeedsKey(scope, 'org.example')).toEqual(['jf', 's1', 'u1', 'ext-feed', 'org.example']);
    expect(feedQueryKey(scope, 'org.example', '/feed')).toEqual(['jf', 's1', 'u1', 'ext-feed', 'org.example', '/feed', null]);
    expect(feedQueryKey(scope, 'org.example', '/search', 'cat')).toEqual(['jf', 's1', 'u1', 'ext-feed', 'org.example', '/search', 'cat']);
  });

  it('never share a key between two accounts', () => {
    expect(feedQueryKey(scope, 'x', '/f')).not.toEqual(feedQueryKey({ serverId: 's1', userId: 'u2' }, 'x', '/f'));
  });
});

describe('search', () => {
  it('trims and cuts the text', () => {
    expect(normalizeQuery('  cat  ')).toBe('cat');
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('x'.repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('drops a late reply of an older search', async () => {
    const gate = createGate();
    let finishOld: (v: string) => void = () => undefined;
    const old = latestOnly(gate, () => new Promise<string>((r) => (finishOld = r)));
    const fresh = latestOnly(gate, async () => 'new');
    await expect(fresh).resolves.toBe('new');
    finishOld('old');
    await expect(old).rejects.toBeInstanceOf(StaleSearchError);
  });

  it('drops a reply that arrives after the search was cleared', async () => {
    const gate = createGate();
    let finish: (v: string) => void = () => undefined;
    const p = latestOnly(gate, () => new Promise<string>((r) => (finish = r)));
    gate.cancel();
    finish('late');
    await expect(p).rejects.toBeInstanceOf(StaleSearchError);
  });

  it('keeps the reply of the newest search', async () => {
    await expect(latestOnly(createGate(), async () => 1)).resolves.toBe(1);
  });
});
