import { parseDetail, parseFeed, parseFeedPage, readMediaRef } from '../feeds';
import { ExtensionError } from '../http';

const base = 'https://media.example.org';
const other = 'https://other.example.net';

describe('parseFeedPage', () => {
  it('reads a v1 feed as one page', () => {
    const p = parseFeedPage({ items: [{ itemId: 'j1' }, { title: 'Card' }] }, base);
    expect(p.entries.map((e) => e.key)).toEqual(['j1', '1']);
    expect(p.next).toBeNull();
  });

  it('reads the cursor of the next page', () => {
    expect(parseFeedPage({ items: [], next: 'abc' }, base).next).toBe('abc');
  });

  it('treats a null, empty, long or wrong-type cursor as the last page', () => {
    for (const next of [null, '', 'x'.repeat(1001), 5, { url: '/p/2' }]) {
      expect(parseFeedPage({ items: [{ title: 'A' }], next }, base)).toMatchObject({ next: null, entries: [{ title: 'A' }] });
    }
  });

  it('refuses a reply that is not a feed, with no URL in the error', () => {
    expect(() => parseFeedPage({ entries: [] }, base)).toThrow('The feed is not in the expected format.');
    expect(() => parseFeedPage({ items: Array.from({ length: 101 }, () => ({ title: 'A' })) }, base)).toThrow();
  });

  it('gives the same entries as the Home row parser', () => {
    const data = { items: [{ title: 'A', image: '/a.jpg' }, 7], next: 'n' };
    expect(parseFeed(data, base)).toEqual(parseFeedPage(data, base).entries);
  });
});

describe('feed entry, v2 fields', () => {
  const entry = {
    id: 'e123',
    title: 'An entry',
    subtitle: '12 min · 2 days ago',
    image: '/img/e123.jpg',
    progress: 0.4,
    badge: 'New',
    detail: '/api/entries/e123',
    media: { id: 'e123', kind: 'video', duration: 734, playback: '/api/entries/e123/play', download: '/api/entries/e123/download' },
  };

  it('reads badge, detail and media, with full URLs on the origin', () => {
    const [e] = parseFeed({ items: [entry] }, base);
    expect(e).toMatchObject({
      key: 'e123',
      badge: 'New',
      imageUrl: `${base}/img/e123.jpg`,
      detail: `${base}/api/entries/e123`,
      media: { id: 'e123', kind: 'video', duration: 734, playback: `${base}/api/entries/e123/play`, download: `${base}/api/entries/e123/download` },
    });
  });

  it('keeps the v1 fields', () => {
    const [e] = parseFeed({ items: [{ ...entry, itemId: 'j1', panel: 'main', link: 'https://example.org/x' }] }, base);
    expect(e).toMatchObject({ itemId: 'j1', panel: 'main', link: 'https://example.org/x' });
  });

  it('resolves paths under the base path', () => {
    const [e] = parseFeed({ items: [entry] }, `${base}/ext`);
    expect(e.detail).toBe(`${base}/ext/api/entries/e123`);
    expect(e.media?.playback).toBe(`${base}/ext/api/entries/e123/play`);
  });

  it('leaves out a detail or a media URL on another origin, and keeps the entry', () => {
    const [e] = parseFeed({ items: [{ ...entry, detail: `${other}/d`, media: { ...entry.media, download: `${other}/f.mp4` } }] }, base);
    expect(e.title).toBe('An entry');
    expect(e.detail).toBeUndefined();
    expect(e.media?.playback).toBe(`${base}/api/entries/e123/play`);
    expect(e.media?.download).toBeUndefined();
  });

  it('leaves out media with nothing on the origin to play or save', () => {
    const [e] = parseFeed({ items: [{ ...entry, media: { id: 'e1', playback: `${other}/p` } }] }, base);
    expect(e.media).toBeUndefined();
    expect(readMediaRef({ id: 'e1' }, base)).toBeNull();
  });

  it('leaves out a bad v2 field on its own, so v1 feeds show as before', () => {
    const [e] = parseFeed({ items: [{ title: 'A', badge: 'x'.repeat(41), detail: 5, media: 'video' }] }, base);
    expect(e).toMatchObject({ title: 'A', key: '0' });
    expect(e.badge).toBeUndefined();
    expect(e.detail).toBeUndefined();
    expect(e.media).toBeUndefined();
  });

  it('reads media kind with video as the default, and refuses another kind', () => {
    expect(readMediaRef({ id: 'a', playback: '/p' }, base)?.kind).toBe('video');
    expect(readMediaRef({ id: 'a', kind: 'audio', playback: '/p' }, base)?.kind).toBe('audio');
    expect(readMediaRef({ id: 'a', kind: 'image', playback: '/p' }, base)).toBeNull();
    expect(readMediaRef({ id: 'a', duration: -1, playback: '/p' }, base)).toBeNull();
  });

  it('still drops an entry with no itemId and no title', () => {
    expect(parseFeed({ items: [{ media: entry.media }] }, base)).toEqual([]);
  });
});

describe('parseDetail', () => {
  const detail = {
    title: 'An entry',
    eyebrow: 'Example Media',
    image: '/img/e123.jpg',
    backdrop: '/img/e123-wide.jpg',
    lines: ['12 min', '2 days ago'],
    description: 'Plain text.',
    media: { id: 'e123', kind: 'video', playback: '/api/entries/e123/play', download: '/api/entries/e123/download' },
    progress: 0.4,
    actions: [
      {
        id: 'save',
        title: 'Save',
        icon: 'heart',
        state: { on: false, onTitle: 'Saved', onIcon: 'heart.fill' },
        request: { method: 'POST', path: '/api/entries/e123/save', body: { on: '{{action.next}}' } },
      },
    ],
    sections: [{ id: 'related', title: 'Related', layout: 'row', shape: 'thumb', feed: '/api/entries/e123/related' }],
  };

  it('reads a full detail', () => {
    const d = parseDetail(detail, base);
    expect(d).toMatchObject({
      title: 'An entry',
      eyebrow: 'Example Media',
      imageUrl: `${base}/img/e123.jpg`,
      backdropUrl: `${base}/img/e123-wide.jpg`,
      lines: ['12 min', '2 days ago'],
      description: 'Plain text.',
      progress: 0.4,
      media: { id: 'e123', playback: `${base}/api/entries/e123/play` },
    });
    expect(d.actions[0]).toMatchObject({ id: 'save', state: { on: false, onTitle: 'Saved', onIcon: 'heart.fill' }, request: { method: 'POST' } });
    expect(d.sections).toEqual([{ id: 'related', title: 'Related', layout: 'row', shape: 'thumb', feed: '/api/entries/e123/related' }]);
  });

  it('refuses a reply with no title, with no URL in the error', () => {
    expect(() => parseDetail({ ...detail, title: '' }, base)).toThrow(ExtensionError);
    expect(() => parseDetail(null, base)).toThrow('The extension sent a page the app cannot read.');
  });

  it('leaves out bad actions, lines and sections one by one', () => {
    const d = parseDetail(
      {
        ...detail,
        lines: ['ok', 5, '', 'x'.repeat(121)],
        actions: [{ id: 'bad', title: 'Bad' }, detail.actions[0], { ...detail.actions[0], title: 'Again' }, { ...detail.actions[0], id: 'flip', state: { on: 'yes' } }],
        sections: [{ id: 's', title: 'S', layout: 'carousel', feed: '/f' }, detail.sections[0], detail.sections[0]],
      },
      base,
    );
    expect(d.lines).toEqual(['ok']);
    expect(d.actions.map((a) => [a.id, a.title])).toEqual([['save', 'Save']]);
    expect(d.sections.map((s) => s.id)).toEqual(['related']);
  });

  it('applies the origin rule to pictures, actions, sections and media', () => {
    const d = parseDetail(
      {
        ...detail,
        image: `${other}/i.jpg`,
        backdrop: `${other}/b.jpg`,
        media: { id: 'x', playback: `${other}/p` },
        actions: [{ ...detail.actions[0], request: { method: 'POST', path: `${other}/save` } }],
        sections: [{ ...detail.sections[0], feed: `${other}/feed` }],
      },
      base,
    );
    expect(d.imageUrl).toBeUndefined();
    expect(d.backdropUrl).toBeUndefined();
    expect(d.media).toBeUndefined();
    expect(d.actions).toEqual([]);
    expect(d.sections).toEqual([]);
  });

  it('reads a minimal detail', () => {
    expect(parseDetail({ title: 'T' }, base)).toEqual({ title: 'T', lines: [], actions: [], sections: [] });
  });
});
