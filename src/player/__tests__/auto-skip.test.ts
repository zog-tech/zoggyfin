import {
  autoRanges,
  buttonShows,
  initialAutoSkip,
  modeOf,
  skippedNow,
  transitionAutoSkip,
  undoneRange,
  UNDO_WINDOW_MS,
  type AutoSkipRange,
  type AutoSkipState,
  type SkipContext,
} from '../auto-skip';
import { BUILTIN_LABELS, externalSegments, JELLYFIN_SKIP_SCOPE, nextUpStartsAt, normalizeSegments, rangeKey, skipPromptAt, type Segment } from '../segments';

const T = 10_000_000;
const intro: AutoSkipRange = { key: 'intro@0', title: 'Intro', start: 0, end: 12 };
const promo: AutoSkipRange = { key: 'promo@200', title: 'Promotion', start: 200, end: 245 };
const ranges = [intro, promo];
const time = (position: number, now = 1000, allowed = true) => ({ type: 'time' as const, position, ranges, allowed, now });

describe('auto-skip machine', () => {
  it('idle → skipped when the position enters an auto range, with the range to seek past', () => {
    const next = transitionAutoSkip(initialAutoSkip, time(3));
    expect(next).toEqual({ phase: 'skipped', done: ['intro@0'], blocked: [], range: intro, at: 1000 });
    expect(skippedNow(initialAutoSkip, next)).toBe(intro);
  });

  it('returns the same state outside a range, and in the last second of one', () => {
    expect(transitionAutoSkip(initialAutoSkip, time(100))).toBe(initialAutoSkip);
    expect(transitionAutoSkip(initialAutoSkip, time(11.5))).toBe(initialAutoSkip);
  });

  it('skips each range once per play', () => {
    const skipped = transitionAutoSkip(initialAutoSkip, time(3));
    const idle = transitionAutoSkip(skipped, { type: 'expire' });
    expect(idle).toEqual({ phase: 'idle', done: ['intro@0'], blocked: [] });
    // The user goes back into the intro later: no second skip.
    expect(transitionAutoSkip(idle, time(5, 50_000))).toBe(idle);
    expect(skippedNow(idle, idle)).toBeNull();
  });

  it('never skips when not allowed (a together session, a live stream)', () => {
    expect(transitionAutoSkip(initialAutoSkip, time(3, 1000, false))).toBe(initialAutoSkip);
  });

  it('a user seek into a range marks it, so it is not skipped', () => {
    const seek = transitionAutoSkip(initialAutoSkip, { type: 'userSeek', target: 210, ranges });
    expect(seek).toEqual({ phase: 'idle', done: ['promo@200'], blocked: [] });
    expect(transitionAutoSkip(seek, time(211))).toBe(seek);
    // A seek outside every range changes nothing.
    expect(transitionAutoSkip(seek, { type: 'userSeek', target: 100, ranges })).toBe(seek);
  });

  it('a user seek ends the undo window', () => {
    const skipped = transitionAutoSkip(initialAutoSkip, time(3));
    expect(transitionAutoSkip(skipped, { type: 'userSeek', target: 100, ranges })).toEqual({ phase: 'idle', done: ['intro@0'], blocked: [] });
  });

  it('undo returns to the range start and blocks auto skip for that range for the rest of the play', () => {
    const skipped = transitionAutoSkip(initialAutoSkip, time(3));
    const undone = transitionAutoSkip(skipped, { type: 'undo' });
    expect(undone).toEqual({ phase: 'idle', done: ['intro@0'], blocked: ['intro@0'] });
    expect(undoneRange(skipped, undone)).toBe(intro);
    expect(transitionAutoSkip(undone, time(0.5, 2000))).toBe(undone);
    // Undo with nothing to undo does nothing.
    expect(transitionAutoSkip(undone, { type: 'undo' })).toBe(undone);
    expect(undoneRange(undone, undone)).toBeNull();
  });

  it('the undo window ends by itself; then the next range can be skipped', () => {
    const skipped = transitionAutoSkip(initialAutoSkip, time(3, 1000));
    expect(transitionAutoSkip(skipped, time(13, 1000 + UNDO_WINDOW_MS - 1))).toBe(skipped);
    const later = transitionAutoSkip(skipped, time(13, 1000 + UNDO_WINDOW_MS));
    expect(later).toEqual({ phase: 'idle', done: ['intro@0'], blocked: [] });
    const promoSkip = transitionAutoSkip(later, time(201, 99_000));
    expect(skippedNow(later, promoSkip)).toBe(promo);
  });

  it('a second range within the window replaces the first', () => {
    const skipped = transitionAutoSkip(initialAutoSkip, time(3, 1000));
    const second = transitionAutoSkip(skipped, time(201, 2000));
    expect(second).toMatchObject({ phase: 'skipped', range: promo, done: ['intro@0', 'promo@200'] });
    expect(skippedNow(skipped, second)).toBe(promo);
  });

  it('expire and reset', () => {
    expect(transitionAutoSkip(initialAutoSkip, { type: 'expire' })).toBe(initialAutoSkip);
    expect(transitionAutoSkip(initialAutoSkip, { type: 'reset' })).toBe(initialAutoSkip);
    const skipped = transitionAutoSkip(initialAutoSkip, time(3));
    expect(transitionAutoSkip(skipped, { type: 'reset' })).toBe(initialAutoSkip);
  });
});

describe('labels', () => {
  const raw = [
    { Type: 'Intro' as const, StartTicks: 0, EndTicks: 30 * T },
    { Type: 'Outro' as const, StartTicks: 1300 * T, EndTicks: 1400 * T },
    { Type: 'Recap' as const, StartTicks: 40 * T, EndTicks: 60 * T },
    { Type: 'Preview' as const, StartTicks: 70 * T, EndTicks: 80 * T },
    { Type: 'Commercial' as const, StartTicks: 90 * T, EndTicks: 100 * T },
  ];

  it('maps the Jellyfin kinds to the built-in labels with the old button text', () => {
    const segs = normalizeSegments(raw);
    expect(segs.map((s) => s.label)).toEqual(['intro', 'recap', 'preview', 'commercial', 'outro']);
    expect(new Set(segs.map((s) => s.label))).toEqual(new Set(BUILTIN_LABELS));
    expect(skipPromptAt(segs, 5, 1400, false)?.label).toBe('Skip Intro');
    expect(skipPromptAt(segs, 45, 1400, false)?.label).toBe('Skip Recap');
    expect(skipPromptAt(segs, 75, 1400, false)?.label).toBe('Skip Preview');
    expect(skipPromptAt(segs, 95, 1400, false)?.label).toBe('Skip Ad');
    expect(skipPromptAt(segs, 1350, 1400, false)?.label).toBe('Skip Credits');
    expect(nextUpStartsAt(segs, 1400)).toBe(1300);
  });

  it('keeps an extension label and its title, and the end-credits rule for its outro', () => {
    const segs = externalSegments([
      { label: 'promo', title: 'Promotion', start: 200, end: 245 },
      { label: 'outro', title: 'Credits', start: 650, end: 700 },
      { label: 'bad', title: 'Bad', start: 10, end: 5 },
    ]);
    expect(segs.map((s) => s.label)).toEqual(['promo', 'outro']);
    expect(skipPromptAt(segs, 210, 700, false)?.label).toBe('Skip Promotion');
    expect(nextUpStartsAt(segs, 700)).toBe(650);
  });

  it('a hidden segment shows no button', () => {
    const segs = normalizeSegments(raw);
    expect(skipPromptAt(segs, 5, 1400, false, (s) => s.label !== 'intro')).toBeNull();
  });
});

describe('skip modes in the player', () => {
  const segs: Segment[] = [
    { label: 'intro', title: 'Intro', start: 0, end: 12 },
    { label: 'promo', title: 'Promotion', start: 200, end: 245 },
    { label: 'recap', title: 'Recap', start: 300, end: 320 },
  ];
  const ext: SkipContext = { scope: 'org.example.media', defaults: { intro: 'ask', promo: 'auto' }, choices: {} };

  it('uses the manifest default until the user changes it, and ask for an unknown label', () => {
    expect(segs.map((s) => modeOf(s, ext))).toEqual(['ask', 'auto', 'ask']);
    const changed: SkipContext = { ...ext, choices: { 'org.example.media:promo': { mode: 'off', at: 1 }, 'org.example.media:recap': { mode: 'auto', at: 2 } } };
    expect(segs.map((s) => modeOf(s, changed))).toEqual(['ask', 'off', 'auto']);
    expect(autoRanges(segs, changed).map((r) => r.key)).toEqual(['recap@300']);
  });

  it('Jellyfin labels default to ask', () => {
    const jf: SkipContext = { scope: JELLYFIN_SKIP_SCOPE, choices: {} };
    expect(modeOf({ label: 'intro' }, jf)).toBe('ask');
    expect(autoRanges(normalizeSegments([{ Type: 'Intro', StartTicks: 0, EndTicks: 30 * T }]), jf)).toEqual([]);
  });

  it('shows the button for ask, never for off, and for auto only where it did not skip by itself', () => {
    const [introSeg, promoSeg] = segs;
    expect(buttonShows(introSeg, ext, initialAutoSkip, true)).toBe(true);
    expect(buttonShows(promoSeg, ext, initialAutoSkip, true)).toBe(false);
    expect(buttonShows(promoSeg, ext, initialAutoSkip, false)).toBe(true);
    const undone: AutoSkipState = { phase: 'idle', done: [rangeKey(promoSeg)], blocked: [rangeKey(promoSeg)] };
    expect(buttonShows(promoSeg, ext, undone, true)).toBe(true);
    const justSkipped: AutoSkipState = { phase: 'skipped', done: [rangeKey(promoSeg)], blocked: [], range: { key: rangeKey(promoSeg), title: 'Promotion', start: 200, end: 245 }, at: 1 };
    expect(buttonShows(promoSeg, ext, justSkipped, true)).toBe(false);
    const off: SkipContext = { ...ext, choices: { 'org.example.media:intro': { mode: 'off', at: 1 } } };
    expect(buttonShows(introSeg, off, initialAutoSkip, true)).toBe(false);
  });
});
