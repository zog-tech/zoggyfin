import { type DetailAction, type FeedEntry, parseDetail, readEntry } from '@/extensions/feeds';
import { createKeyedGate } from '@/lib/async-gate';

import {
  canDownload,
  DEFAULT_ACTION_ICON,
  detailPlayable,
  detailShape,
  detailView,
  dropSettled,
  entryMenu,
  iconOrDefault,
  playRequestOf,
  pressToggle,
  settleToggle,
  type ToggleMap,
  toggleOn,
  withActionState,
} from '../detail-view';
import { parseEntryRoute } from '../routes';

const base = 'https://media.example.org';

const raw = {
  title: 'An entry',
  eyebrow: 'Example Media',
  image: '/img/e1.jpg',
  backdrop: '/img/e1-wide.jpg',
  lines: ['12 min', '2 days ago'],
  description: 'Plain text.',
  media: { id: 'e1', kind: 'video', duration: 734, playback: '/api/e1/play', download: '/api/e1/download' },
  progress: 0.4,
  actions: [
    {
      id: 'save',
      title: 'Save',
      icon: 'heart',
      state: { on: false, onTitle: 'Saved', onIcon: 'heart.fill' },
      request: { method: 'POST', path: '/api/e1/save', body: { on: '{{action.next}}' } },
    },
    { id: 'report', title: 'Report', icon: 'no.such.icon', request: { method: 'POST', path: '/api/e1/report' } },
  ],
  sections: [{ id: 'related', title: 'Related', feed: '/api/e1/related' }],
};

const detail = () => parseDetail(raw, base);
const save = (): DetailAction => detail().actions[0];
const grants = (playback: boolean, downloads: boolean) => ({ itemPath: false, jellyfinToken: false, playback, downloads });
const ext = (over: { playback?: boolean; downloads?: boolean; permissions?: string[] } = {}) => ({
  manifest: { permissions: (over.permissions ?? ['network', 'playback', 'downloads']) as ('network' | 'playback' | 'downloads')[] },
  grants: grants(over.playback ?? true, over.downloads ?? true),
});

describe('detailView', () => {
  it('maps a detail to the page', () => {
    const v = detailView(detail(), {}, { canDownload: true });
    expect(v).toMatchObject({
      title: 'An entry',
      eyebrow: 'Example Media',
      poster: `${base}/img/e1.jpg`,
      backdrop: `${base}/img/e1-wide.jpg`,
      lines: ['12 min', '2 days ago'],
      description: 'Plain text.',
      kind: 'video',
      primary: { label: 'Resume', progress: 0.4 },
    });
    expect(v.buttons.map((b) => b.key)).toEqual(['start-over', 'download', 'save', 'report']);
    expect(v.buttons[2]).toMatchObject({ label: 'Save', icon: 'heart', active: false, next: true });
    // An unknown icon name draws the default icon.
    expect(v.buttons[3]).toMatchObject({ label: 'Report', icon: DEFAULT_ACTION_ICON });
    expect(v.buttons[3].active).toBeUndefined();
    expect(v.sections.map((s) => s.id)).toEqual(['related']);
  });

  it('says Play with no progress, and has no Start over', () => {
    const v = detailView(parseDetail({ ...raw, progress: undefined }, base), {}, { canDownload: true });
    expect(v.primary).toEqual({ label: 'Play', progress: null });
    expect(v.buttons.map((b) => b.key)).not.toContain('start-over');
  });

  it('has no Play without a playback URL, and no Download without the grant', () => {
    const v = detailView(parseDetail({ ...raw, media: { id: 'e1', download: '/api/e1/download' } }, base), {}, { canDownload: false });
    expect(v.primary).toBeNull();
    expect(v.buttons.map((b) => b.key)).toEqual(['save', 'report']);
  });

  it('shows the on title and icon while on', () => {
    const on = parseDetail({ ...raw, actions: [{ ...raw.actions[0], state: { on: true, onTitle: 'Saved', onIcon: 'heart.fill' } }] }, base);
    expect(detailView(on, {}, { canDownload: true }).buttons.find((b) => b.key === 'save')).toMatchObject({ label: 'Saved', icon: 'heart.fill', active: true, next: false });
  });

  it('keeps unknown icon names out', () => {
    expect(iconOrDefault('heart')).toBe('heart');
    expect(iconOrDefault('rm -rf')).toBe(DEFAULT_ACTION_ICON);
    expect(iconOrDefault(undefined)).toBe(DEFAULT_ACTION_ICON);
  });
});

describe('the shape of the picture', () => {
  const shapeOf = (over: Record<string, unknown>) => detailView(parseDetail({ ...raw, ...over }, base), {}, { canDownload: true }).shape;

  it('is a thumb for a video, a square for audio, a poster with no media', () => {
    expect(shapeOf({})).toBe('thumb');
    expect(shapeOf({ media: { id: 'a1', kind: 'audio', playback: '/api/a1/play' } })).toBe('square');
    expect(shapeOf({ media: undefined })).toBe('poster');
  });

  it('takes the detail shape before the media kind', () => {
    expect(shapeOf({ shape: 'poster' })).toBe('poster');
    expect(shapeOf({ shape: 'square', media: undefined })).toBe('square');
    expect(detailShape({ shape: 'thumb' })).toBe('thumb');
  });

  it('ignores a shape the app does not know', () => {
    expect(parseDetail({ ...raw, shape: 'wide' }, base).shape).toBeUndefined();
    expect(shapeOf({ shape: 'wide' })).toBe('thumb');
  });
});

describe('icons of extension buttons', () => {
  it('keeps the common names and falls back only for unknown ones', () => {
    const actions = ['hand.thumbsup', 'hand.thumbsup.fill', 'bell', 'clock', 'bookmark', 'no.such.icon'].map((icon, i) => ({
      id: `a${i}`,
      title: `Action ${i}`,
      icon,
      request: { method: 'POST', path: `/api/e1/a${i}` },
    }));
    const v = detailView(parseDetail({ ...raw, actions }, base), {}, { canDownload: false });
    expect(v.buttons.filter((b) => b.key.startsWith('a')).map((b) => b.icon)).toEqual(['hand.thumbsup', 'hand.thumbsup.fill', 'bell', 'clock', 'bookmark', DEFAULT_ACTION_ICON]);
  });
});

describe('on/off buttons', () => {
  it('shows the new state at once and keeps it on success', () => {
    const a = save();
    let m: ToggleMap = {};
    m = pressToggle(m, a, true, 1);
    expect(toggleOn(m, a)).toBe(true);
    m = settleToggle(m, a.id, 1, true, { ok: true });
    expect(toggleOn(m, a)).toBe(true);
    expect(m[a.id].pending).toBe(false);
  });

  it('goes back when the request fails', () => {
    const a = save();
    let m = pressToggle({}, a, true, 1);
    m = settleToggle(m, a.id, 1, true, { ok: false });
    expect(toggleOn(m, a)).toBe(false);
  });

  it('takes the reply state as the truth', () => {
    const a = save();
    let m = pressToggle({}, a, true, 1);
    m = settleToggle(m, a.id, 1, true, { ok: true, on: false });
    expect(toggleOn(m, a)).toBe(false);
  });

  it('never lets a late reply to an older press win', () => {
    const a = save();
    const gate = createKeyedGate<string>();
    const t1 = gate.begin(a.id);
    let m = pressToggle({}, a, true, t1);
    const t2 = gate.begin(a.id);
    m = pressToggle(m, a, false, t2);
    // The newer press answers first, then the older one.
    m = settleToggle(m, a.id, t2, false, { ok: true });
    const after = settleToggle(m, a.id, t1, true, { ok: true, on: true });
    expect(toggleOn(after, a)).toBe(false);
    expect(after).toBe(m);
  });

  it('a late success of an older press is what a newer failure goes back to', () => {
    const a = save();
    let m = pressToggle({}, a, true, 1);
    m = pressToggle(m, a, false, 2);
    m = settleToggle(m, a.id, 1, true, { ok: true });
    expect(toggleOn(m, a)).toBe(false);
    m = settleToggle(m, a.id, 2, false, { ok: false });
    expect(toggleOn(m, a)).toBe(true);
  });

  it('a late failure of an older press changes nothing', () => {
    const a = save();
    let m = pressToggle({}, a, true, 1);
    m = pressToggle(m, a, false, 2);
    expect(settleToggle(m, a.id, 1, true, { ok: false })).toBe(m);
  });

  it('a fresh detail drops the settled buttons and keeps the running ones', () => {
    const a = save();
    let m = pressToggle({}, a, true, 1);
    expect(dropSettled(m)).toBe(m);
    m = settleToggle(m, a.id, 1, true, { ok: true });
    expect(dropSettled(m)).toEqual({});
  });
});

describe('long press menu', () => {
  const entry = (over: Record<string, unknown>) => readEntry({ id: 'e1', title: 'An entry', ...over }, 0, base) as FeedEntry;
  const media = { id: 'e1', playback: '/api/e1/play', download: '/api/e1/download' };

  it('has Play, Play from the beginning, Open and Download', () => {
    expect(entryMenu(entry({ media, progress: 0.3, detail: '/api/e1' }), { canDownload: true }).map((r) => r.label)).toEqual([
      'Play',
      'Play from the beginning',
      'Open',
      'Download',
    ]);
  });

  it('leaves out what does not apply', () => {
    expect(entryMenu(entry({ media }), { canDownload: false }).map((r) => r.id)).toEqual(['play']);
    expect(entryMenu(entry({ media: { id: 'e1', download: '/api/e1/download' } }), { canDownload: true }).map((r) => r.id)).toEqual(['download']);
    expect(entryMenu(entry({ media, progress: 1 }), { canDownload: false }).map((r) => r.id)).toEqual(['play']);
    expect(entryMenu(entry({ detail: '/api/e1' }), { canDownload: true })).toEqual([]);
  });

  it('shows Download only with the grant on a platform that saves files', () => {
    expect(canDownload(ext(), true)).toBe(true);
    expect(canDownload(ext({ downloads: false }), true)).toBe(false);
    expect(canDownload(ext({ permissions: ['network', 'playback'] }), true)).toBe(false);
    expect(canDownload(ext(), false)).toBe(false);
  });
});

describe('play request', () => {
  it('maps an entry as the player documents it', () => {
    const e = readEntry({ id: 'e1', title: 'An entry', subtitle: '12 min', image: '/img/e1.jpg', media: { id: 'm1', duration: 734, playback: '/api/e1/play' } }, 0, base) as FeedEntry;
    expect(playRequestOf('org.example.media', e)).toEqual({
      extension: 'org.example.media',
      mediaId: 'm1',
      playback: `${base}/api/e1/play`,
      title: 'An entry',
      subtitle: '12 min',
      image: `${base}/img/e1.jpg`,
      duration: 734,
    });
    expect(playRequestOf('x', e, 0)?.startSeconds).toBe(0);
  });

  it('maps a detail: the eyebrow is the subtitle', () => {
    expect(playRequestOf('x', detailPlayable(detail()))).toMatchObject({ mediaId: 'e1', title: 'An entry', subtitle: 'Example Media', image: `${base}/img/e1.jpg` });
  });

  it('gives null with nothing to play', () => {
    expect(playRequestOf('x', { title: 'No media' })).toBeNull();
    expect(playRequestOf('x', { media: { id: 'm', kind: 'video', download: `${base}/d` } })).toBeNull();
  });
});

describe('entry route', () => {
  it('opens a detail URL on the origin only', () => {
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: '/api/e1' }, base)).toEqual({ extId: 'x', entryId: 'e1', detail: `${base}/api/e1` });
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: 'https://other.example.net/api/e1' }, base)).toBeNull();
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: '//other.example.net/x' }, base)).toBeNull();
    expect(parseEntryRoute({ ext: 'x', entry: 'e1', detail: '/api/e1' }, undefined)).toBeNull();
  });
});

describe('withActionState', () => {
  const d = parseDetail(
    {
      title: 'An entry',
      actions: [
        { id: 'save', title: 'Save', state: { on: false, onTitle: 'Saved' }, request: { method: 'POST', path: '/save' } },
        { id: 'share', title: 'Share', request: { method: 'POST', path: '/share' } },
      ],
    },
    base,
  );

  it('writes the confirmed state of an on/off button into the detail', () => {
    const out = withActionState(d, 'save', true);
    expect(out.actions[0].state?.on).toBe(true);
    expect(out.actions[1]).toBe(d.actions[1]);
    expect(d.actions[0].state?.on).toBe(false);
  });

  it('returns the same detail when nothing changes', () => {
    expect(withActionState(d, 'save', false)).toBe(d);
    expect(withActionState(d, 'share', true)).toBe(d);
    expect(withActionState(d, 'missing', true)).toBe(d);
  });
});
