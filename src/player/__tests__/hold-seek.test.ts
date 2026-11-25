import {
  DEFAULT_HOLD_TOP,
  HOLD_STEP_MS,
  HOLD_TOP_CHOICES,
  holdDirection,
  holdDistance,
  holdPaceLabel,
  holdSpeed,
  holdTarget,
  validHoldTop,
} from '../hold-seek';

describe('holdSpeed', () => {
  it('rises a step every HOLD_STEP_MS up to the top speed', () => {
    expect(holdSpeed(0, 480)).toBe(10);
    expect(holdSpeed(HOLD_STEP_MS - 1, 480)).toBe(10);
    expect(holdSpeed(HOLD_STEP_MS, 480)).toBe(30);
    expect(holdSpeed(2 * HOLD_STEP_MS, 480)).toBe(60);
    expect(holdSpeed(5 * HOLD_STEP_MS, 480)).toBe(480);
    expect(holdSpeed(60_000, 480)).toBe(480);
  });

  it('stops at the chosen top speed', () => {
    expect(holdSpeed(60_000, 240)).toBe(240);
    expect(holdSpeed(60_000, 30)).toBe(30);
    expect(holdSpeed(HOLD_STEP_MS, 30)).toBe(30);
  });

  it('keeps the first speed for a top below it, and for a negative time', () => {
    expect(holdSpeed(60_000, 1)).toBe(10);
    expect(holdSpeed(-500, 240)).toBe(10);
  });
});

describe('holdDistance', () => {
  it('adds each step at its speed', () => {
    const step = HOLD_STEP_MS / 1000;
    expect(holdDistance(0, 240)).toBe(0);
    expect(holdDistance(500, 240)).toBeCloseTo(5);
    expect(holdDistance(HOLD_STEP_MS, 240)).toBeCloseTo(10 * step);
    expect(holdDistance(2 * HOLD_STEP_MS, 240)).toBeCloseTo(10 * step + 30 * step);
    // At the top speed the time goes on at that speed.
    expect(holdDistance(5 * HOLD_STEP_MS + 2000, 240)).toBeCloseTo((10 + 30 + 60 + 120 + 240) * step + 480);
  });

  it('crosses most of a film in a few seconds at the default top speed', () => {
    // 8 s held: 19 min 40 s of video (3 min 40 s in the first 4 s, then 4 min a second).
    expect(holdDistance(8000, DEFAULT_HOLD_TOP)).toBeCloseTo(19 * 60 + 40);
    // A short hold stays near: under 15 s after a second.
    expect(holdDistance(1000, DEFAULT_HOLD_TOP)).toBeLessThan(15);
  });

  it('never goes down while the key is held', () => {
    let last = 0;
    for (let ms = 0; ms <= 20_000; ms += 100) {
      const d = holdDistance(ms, 480);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe('holdTarget', () => {
  it('moves forward and back from where the hold began', () => {
    expect(holdTarget({ dir: 1, from: 100, start: 0 }, 1000, 240, 3600)).toBeCloseTo(110);
    expect(holdTarget({ dir: -1, from: 100, start: 0 }, 1000, 240, 3600)).toBeCloseTo(90);
  });

  it('stays inside the video', () => {
    expect(holdTarget({ dir: -1, from: 1, start: 0 }, 10_000, 480, 3600)).toBe(0);
    expect(holdTarget({ dir: 1, from: 3590, start: 0 }, 10_000, 480, 3600)).toBe(3600);
    // An unknown length bounds only the start.
    expect(holdTarget({ dir: 1, from: 10, start: 0 }, 1000, 240, 0)).toBeCloseTo(20);
  });
});

describe('holdDirection', () => {
  it('maps the arrows and the media keys', () => {
    expect(holdDirection('left')).toBe(-1);
    expect(holdDirection('rewind')).toBe(-1);
    expect(holdDirection('right')).toBe(1);
    expect(holdDirection('fastForward')).toBe(1);
    expect(holdDirection('up')).toBeNull();
    expect(holdDirection('select')).toBeNull();
  });
});

describe('validHoldTop', () => {
  it('keeps a choice and replaces anything else with the default', () => {
    for (const v of HOLD_TOP_CHOICES) expect(validHoldTop(v)).toBe(v);
    // 10× was the first default: far too slow, so a saved 10 goes back to the default.
    expect(validHoldTop(10)).toBe(DEFAULT_HOLD_TOP);
    expect(validHoldTop('240')).toBe(DEFAULT_HOLD_TOP);
    expect(validHoldTop(undefined)).toBe(DEFAULT_HOLD_TOP);
    expect(DEFAULT_HOLD_TOP).toBe(240);
  });
});

describe('holdPaceLabel', () => {
  it('says how far the target moves each second', () => {
    expect(holdPaceLabel(30)).toBe('30 s a second');
    expect(holdPaceLabel(60)).toBe('1 min a second');
    expect(holdPaceLabel(240)).toBe('4 min a second');
  });
});
