import {
  REMOTE_TIMING,
  type SeekSteps,
  TAP_IDLE,
  tapSeekDeadline,
  type TapSeekEffect,
  type TapSeekEvent,
  type TapSeekState,
  tapSeekTransition,
  type TapSide,
  type TapTiming,
  type TapZone,
  tapZone,
  TOUCH_TIMING,
} from '../tap-seek';

const STEP: SeekSteps = { left: 10, right: 10 };
const { windowMs: WINDOW, seekModeMs: SEEK_MODE } = TOUCH_TIMING;

/** Runs events in order, firing the timer when it is due before each event, and collects the effects. */
function run(events: TapSeekEvent[], start: TapSeekState = TAP_IDLE): { state: TapSeekState; effects: TapSeekEffect[] } {
  let state = start;
  const effects: TapSeekEffect[] = [];
  const step = (e: TapSeekEvent) => {
    const r = tapSeekTransition(state, e);
    state = r.state;
    if (r.effect) effects.push(r.effect);
  };
  for (const e of events) {
    const due = tapSeekDeadline(state);
    if (due !== null && e.type !== 'end' && due <= e.now) step({ type: 'tick', now: due });
    step(e);
  }
  return { state, effects };
}

const tap = (zone: TapZone, now: number, live = false, timing: TapTiming = TOUCH_TIMING): TapSeekEvent => ({
  type: 'tap',
  zone,
  live,
  now,
  step: STEP,
  timing,
});
const press = (zone: TapZone, now: number) => tap(zone, now, false, REMOTE_TIMING);
const media = (side: TapSide, now: number): TapSeekEvent => ({ type: 'seek', side, now, step: { left: 15, right: 30 }, timing: REMOTE_TIMING });
const tick = (now: number): TapSeekEvent => ({ type: 'tick', now });
const SEEK_BACK = { type: 'seek', seconds: -10 };
const SEEK_FWD = { type: 'seek', seconds: 10 };
const TOGGLE = { type: 'toggle' };

describe('tapZone', () => {
  it('splits the width in thirds', () => {
    expect(tapZone(10, 300)).toBe('left');
    expect(tapZone(150, 300)).toBe('middle');
    expect(tapZone(290, 300)).toBe('right');
  });
});

describe('tap seek (touch)', () => {
  it('a single tap toggles the controls after the window', () => {
    const first = tapSeekTransition(TAP_IDLE, tap('right', 0));
    expect(first.effect).toBeNull();
    expect(tapSeekDeadline(first.state)).toBe(WINDOW);
    const early = tapSeekTransition(first.state, tick(WINDOW - 1));
    expect(early.state).toBe(first.state);
    expect(early.effect).toBeNull();
    const due = tapSeekTransition(first.state, tick(WINDOW));
    expect(due.effect).toEqual(TOGGLE);
    expect(due.state).toEqual(TAP_IDLE);
  });

  it('a double tap on a side seeks once and starts seek mode', () => {
    const r = run([tap('left', 0), tap('left', 200)]);
    expect(r.effects).toEqual([SEEK_BACK]);
    expect(r.state).toEqual({ phase: 'seeking', side: 'left', seconds: 10, until: 200 + SEEK_MODE });
  });

  it('tap tap tap seeks twice and never toggles', () => {
    const r = run([tap('right', 0), tap('right', 150), tap('right', 600), tick(600 + SEEK_MODE)]);
    expect(r.effects).toEqual([SEEK_FWD, SEEK_FWD]);
    expect(r.state).toEqual(TAP_IDLE);
  });

  it('the seconds of a run add up, so the bubble shows the total', () => {
    const r = run([tap('right', 0), tap('right', 100), tap('right', 400), tap('right', 900)]);
    expect(r.state).toMatchObject({ phase: 'seeking', side: 'right', seconds: 30 });
  });

  it('a slow second tap is two single taps', () => {
    const r = run([tap('left', 0), tap('left', WINDOW + 50), tick(2 * WINDOW + 50)]);
    expect(r.effects).toEqual([TOGGLE, TOGGLE]);
  });

  it('a late timer still counts a slow second tap as a new first tap', () => {
    const first = tapSeekTransition(TAP_IDLE, tap('left', 0)).state;
    const r = tapSeekTransition(first, tap('left', WINDOW + 10));
    expect(r.effect).toEqual(TOGGLE);
    expect(r.state).toEqual({ phase: 'pending', zone: 'left', until: 2 * WINDOW + 10 });
  });

  it('a tap on the other side in seek mode turns the direction and seeks', () => {
    const r = run([tap('right', 0), tap('right', 100), tap('right', 300), tap('left', 500)]);
    expect(r.effects.at(-1)).toEqual(SEEK_BACK);
    expect(r.state).toMatchObject({ phase: 'seeking', side: 'left', seconds: 10 });
  });

  it('a middle tap in seek mode ends it and does nothing else', () => {
    const r = run([tap('right', 0), tap('right', 100), tap('middle', 400), tick(5000)]);
    expect(r.effects).toEqual([SEEK_FWD]);
    expect(r.state).toEqual(TAP_IDLE);
  });

  it('after seek mode ends, a tap waits again', () => {
    const r = run([tap('right', 0), tap('right', 100), tap('right', 100 + SEEK_MODE + 50)]);
    expect(r.effects).toEqual([SEEK_FWD]);
    expect(r.state).toMatchObject({ phase: 'pending', zone: 'right' });
  });

  it('seek mode expiry is quiet', () => {
    const seeking: TapSeekState = { phase: 'seeking', side: 'left', seconds: 20, until: SEEK_MODE };
    const r = tapSeekTransition(seeking, tick(SEEK_MODE));
    expect(r.state).toEqual(TAP_IDLE);
    expect(r.effect).toBeNull();
  });

  it('a double tap in the middle toggles once', () => {
    expect(run([tap('middle', 0), tap('middle', 100), tick(5000)]).effects).toEqual([TOGGLE]);
  });

  it('a second tap in another zone replaces the first tap', () => {
    const r = run([tap('left', 0), tap('right', 100), tick(5000)]);
    expect(r.effects).toEqual([TOGGLE]);
  });

  it('a live item never seeks: single and double taps toggle', () => {
    expect(run([tap('left', 0, true), tick(WINDOW)]).effects).toEqual([TOGGLE]);
    expect(run([tap('right', 0, true), tap('right', 100, true), tick(5000)]).effects).toEqual([TOGGLE]);
  });

  it('events with nothing to do return the same state', () => {
    expect(tapSeekTransition(TAP_IDLE, tick(100)).state).toBe(TAP_IDLE);
    expect(tapSeekTransition(TAP_IDLE, { type: 'end' }).state).toBe(TAP_IDLE);
  });
});

describe('tap seek (TV remote)', () => {
  const W = REMOTE_TIMING.windowMs;
  const M = REMOTE_TIMING.seekModeMs;

  it('Right Right Right seeks twice (+20 s) and never shows the controls', () => {
    const r = run([press('right', 0), press('right', 200), press('right', 200 + M - 100), tick(10_000)]);
    expect(r.effects).toEqual([SEEK_FWD, SEEK_FWD]);
  });

  it('presses slower than a finger still continue the run', () => {
    // The touch seek mode would have ended; the remote one has not.
    const gap = TOUCH_TIMING.seekModeMs + 100;
    expect(gap).toBeLessThan(M);
    const r = run([press('left', 0), press('left', 300), press('left', 300 + gap)]);
    expect(r.state).toMatchObject({ phase: 'seeking', side: 'left', seconds: 20 });
  });

  it('a single press shows the controls after the window', () => {
    expect(run([press('left', 0), tick(W)]).effects).toEqual([TOGGLE]);
  });

  it('another key ends seek mode with no effect, and a waiting press never shows the controls', () => {
    const seeking = run([press('right', 0), press('right', 200)]).state;
    expect(tapSeekTransition(seeking, { type: 'end' })).toEqual({ state: TAP_IDLE, effect: null });
    const waiting = run([press('right', 0)]).state;
    const ended = run([{ type: 'end' }, tick(10_000)], waiting);
    expect(ended.effects).toEqual([]);
  });

  it('rewind and fast forward seek at once, add up and keep seek mode', () => {
    const r = run([media('right', 0), media('right', 500), media('right', 1200)]);
    expect(r.effects).toEqual([
      { type: 'seek', seconds: 30 },
      { type: 'seek', seconds: 30 },
      { type: 'seek', seconds: 30 },
    ]);
    expect(r.state).toMatchObject({ phase: 'seeking', side: 'right', seconds: 90, until: 1200 + M });
  });

  it('a media key drops a waiting press: no controls', () => {
    const r = run([press('left', 0), media('left', 100), tick(10_000)]);
    expect(r.effects).toEqual([{ type: 'seek', seconds: -15 }]);
  });

  it('a D-pad press continues a run that a media key started', () => {
    const r = run([media('right', 0), press('right', 300)]);
    expect(r.effects.at(-1)).toEqual(SEEK_FWD);
    expect(r.state).toMatchObject({ phase: 'seeking', seconds: 40 });
  });
});
