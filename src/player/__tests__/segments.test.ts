import {
  countdownClock,
  countdownLeft,
  endCountdownLeft,
  endPlaysNext,
  externalSegments,
  nextUpModeOf,
  nextUpPhase,
  nextUpStartsAt,
  normalizeSegments,
  setCountdownRunning,
  skipPromptAt,
  skipPromptFor,
} from '../segments';

const T = 10_000_000;

const raw = [
  { Type: 'Outro' as const, StartTicks: 1300 * T, EndTicks: 1400 * T },
  { Type: 'Intro' as const, StartTicks: 30 * T, EndTicks: 90 * T },
  { Type: 'Unknown' as const, StartTicks: 0, EndTicks: 5 * T },
  { Type: 'Recap' as const, StartTicks: 0, EndTicks: 1 * T },
];

describe('normalizeSegments', () => {
  it('keeps known kinds, drops tiny ones, sorts by start', () => {
    expect(normalizeSegments(raw)).toEqual([
      { label: 'intro', title: 'Intro', start: 30, end: 90 },
      { label: 'outro', title: 'Credits', start: 1300, end: 1400 },
    ]);
  });
  it('handles a missing list (older servers)', () => {
    expect(normalizeSegments(undefined)).toEqual([]);
  });
});

describe('skipPromptAt', () => {
  const segs = normalizeSegments(raw);
  it('offers Skip Intro inside the intro', () => {
    expect(skipPromptAt(segs, 45, 1400, true)).toMatchObject({ label: 'Skip Intro', target: 90 });
  });
  it('hides outside and in the last second of a segment', () => {
    expect(skipPromptAt(segs, 10, 1400, true)).toBeNull();
    expect(skipPromptAt(segs, 89.5, 1400, true)).toBeNull();
  });
  it('shows Skip Credits only without a next episode', () => {
    expect(skipPromptAt(segs, 1350, 1400, false)).toMatchObject({ label: 'Skip Credits', target: 1400 });
    expect(skipPromptAt(segs, 1350, 1400, true)).toBeNull();
  });
  it('shows Skip Credits for mid-file credits even with a next episode', () => {
    const mid = normalizeSegments([{ Type: 'Outro', StartTicks: 500 * T, EndTicks: 600 * T }]);
    expect(skipPromptAt(mid, 550, 1400, true)).toMatchObject({ label: 'Skip Credits', target: 600 });
  });
});

describe('skipPromptFor', () => {
  const intro = { label: 'intro', title: 'Intro', start: 30, end: 90 };
  const credits = { label: 'outro', title: 'Credits', start: 1300, end: 1400 };

  it('builds the same prompt as skipPromptAt for the segment it picks', () => {
    const at = skipPromptAt([intro], 45, 1400, false);
    expect(at).not.toBeNull();
    expect(skipPromptFor(intro, 1400)).toEqual(at);
  });

  it('seeks no further than the end of the video', () => {
    expect(skipPromptFor(credits, 1350).target).toBe(1350);
    expect(skipPromptFor(credits, 0).target).toBe(1400);
  });
});

describe('next-up timing', () => {
  it('starts at the end credits', () => {
    expect(nextUpStartsAt(normalizeSegments(raw), 1400)).toBe(1300);
  });
  it('falls back to 30 s before the end', () => {
    expect(nextUpStartsAt([], 1400)).toBe(1370);
  });
  it('does not show for short videos or unknown duration', () => {
    expect(nextUpStartsAt([], 60)).toBeNull();
    expect(nextUpStartsAt([], 0)).toBeNull();
  });
  it('moves through hidden, counting and dismissed', () => {
    const base = { startsAt: 1300, hasNext: true, dismissedAt: null };
    expect(nextUpPhase({ ...base, position: 100 })).toBe('hidden');
    expect(nextUpPhase({ ...base, position: 1310 })).toBe('counting');
    expect(nextUpPhase({ ...base, position: 1320, dismissedAt: 1310 })).toBe('dismissed');
    expect(nextUpPhase({ ...base, position: 1310, hasNext: false })).toBe('hidden');
    // Seeking back before the trigger hides it; after a dismissal before the trigger it counts again.
    expect(nextUpPhase({ ...base, position: 1305, dismissedAt: 200 })).toBe('counting');
  });
  it('counts down from 10 s', () => {
    const clock = countdownClock(0, true);
    expect(countdownLeft(clock, 4000)).toBe(6);
    expect(countdownLeft(clock, 12000)).toBe(0);
  });
  it('holds the countdown while the video is paused', () => {
    // Shown while paused: no time passes.
    let clock = countdownClock(0, false);
    expect(countdownLeft(clock, 60_000)).toBe(10);
    // Plays for 4 s, pauses for a minute, plays 2 s more.
    clock = setCountdownRunning(clock, true, 60_000);
    clock = setCountdownRunning(clock, false, 64_000);
    expect(countdownLeft(clock, 124_000)).toBe(6);
    clock = setCountdownRunning(clock, true, 124_000);
    expect(countdownLeft(clock, 126_000)).toBe(4);
    expect(countdownLeft(clock, 200_000)).toBe(0);
  });
  it('returns the same clock when the state does not change', () => {
    const running = countdownClock(0, true);
    expect(setCountdownRunning(running, true, 500)).toBe(running);
    const held = countdownClock(0, false);
    expect(setCountdownRunning(held, false, 500)).toBe(held);
  });
});

// Extension media (a YouTube video): the last seconds are content, so only the real end starts the next title.
describe('next-up at the end (extension media)', () => {
  it('takes the mode from the external source', () => {
    expect(nextUpModeOf(null)).toBe('credits');
    expect(nextUpModeOf({})).toBe('credits');
    expect(nextUpModeOf({ external: { source: {} } })).toBe('credits');
    expect(nextUpModeOf({ external: { source: { nextAtEnd: true } } })).toBe('end');
  });
  it('shows the card only in the last 10 s, not 30 s before the end', () => {
    expect(nextUpStartsAt([], 600, 'end')).toBe(590);
    expect(nextUpStartsAt([], 600)).toBe(570);
  });
  it('ignores a SponsorBlock outro: the outro is still part of the video', () => {
    const outro = externalSegments([{ label: 'outro', title: 'Outro', start: 560, end: 600 }]);
    expect(nextUpStartsAt(outro, 600, 'end')).toBe(590);
    expect(nextUpStartsAt(outro, 600)).toBe(560);
  });
  it('shows for short videos down to 30 s, never with no length', () => {
    expect(nextUpStartsAt([], 45, 'end')).toBe(35);
    expect(nextUpStartsAt([], 20, 'end')).toBeNull();
    expect(nextUpStartsAt([], 0, 'end')).toBeNull();
  });
  it('the ring follows the time left in the video', () => {
    expect(endCountdownLeft(590, 600)).toBe(10);
    expect(endCountdownLeft(596.5, 600)).toBe(3.5);
    expect(endCountdownLeft(600, 600)).toBe(0);
    expect(endCountdownLeft(300, 600)).toBe(10);
    expect(endCountdownLeft(5, 0)).toBe(10);
  });
  it('the end starts the next title unless the card was cancelled', () => {
    const base = { mode: 'end' as const, autoplay: true, hasNext: true, startsAt: 590, dismissedAt: null };
    expect(endPlaysNext(base)).toBe(true);
    expect(endPlaysNext({ ...base, dismissedAt: 592 })).toBe(false);
    // A dismissal before the card (an old one) does not count.
    expect(endPlaysNext({ ...base, dismissedAt: 100 })).toBe(true);
    expect(endPlaysNext({ ...base, autoplay: false })).toBe(false);
    expect(endPlaysNext({ ...base, hasNext: false })).toBe(false);
    expect(endPlaysNext({ ...base, startsAt: null, dismissedAt: 5 })).toBe(true);
  });
  it('keeps the Jellyfin rule: autoplay and a next item', () => {
    const base = { mode: 'credits' as const, autoplay: true, hasNext: true, startsAt: 1300, dismissedAt: 1310 };
    expect(endPlaysNext(base)).toBe(true);
    expect(endPlaysNext({ ...base, autoplay: false })).toBe(false);
  });
});
