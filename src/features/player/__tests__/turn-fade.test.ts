import { caughtUp, turned, turnWait, TURN_LAYOUT_SETTLE_MS, TURN_MAX_HIDDEN_MS, TURN_MIN_HIDDEN_MS, TURN_SETTLE_MS } from '../turn-fade';

describe('turned', () => {
  it('is true from portrait to landscape and back', () => {
    expect(turned({ width: 402, height: 874 }, { width: 874, height: 402 })).toBe(true);
    expect(turned({ width: 874, height: 402 }, { width: 402, height: 874 })).toBe(true);
  });

  it('is false for a size change in the same orientation', () => {
    expect(turned({ width: 1024, height: 1366 }, { width: 694, height: 1366 })).toBe(false);
    expect(turned({ width: 1200, height: 800 }, { width: 1400, height: 900 })).toBe(false);
  });

  it('is false for a zero size', () => {
    expect(turned({ width: 0, height: 0 }, { width: 874, height: 402 })).toBe(false);
    expect(turned({ width: 402, height: 874 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe('caughtUp', () => {
  it('is false while the layout keeps the old orientation', () => {
    expect(caughtUp({ width: 402, height: 874 }, { width: 874, height: 402 })).toBe(false);
  });

  it('is true when the layout has the window orientation, or a size is zero', () => {
    expect(caughtUp({ width: 874, height: 402 }, { width: 874, height: 402 })).toBe(true);
    expect(caughtUp({ width: 0, height: 0 }, { width: 874, height: 402 })).toBe(true);
  });
});

describe('turnWait', () => {
  const base = { hiddenAt: 1000, changedAt: 1000, layoutReady: true, tracksLayout: false };

  it('without a laid-out size, waits for the window to settle', () => {
    expect(turnWait({ ...base, now: 1000 })).toBe(TURN_SETTLE_MS);
    expect(turnWait({ ...base, now: 1000 + TURN_SETTLE_MS })).toBe(0);
  });

  it('keeps the content out while the layout is old', () => {
    // The iPhone case: the old layout stays about 0.35 s after the 0.4 s turn.
    const wait = turnWait({ ...base, tracksLayout: true, layoutReady: false, now: 1700 });
    expect(wait).toBeGreaterThan(0);
  });

  it('shows the content soon after the layout caught up, but not during the turn', () => {
    const t = { ...base, tracksLayout: true };
    expect(turnWait({ ...t, changedAt: 1050, now: 1050 })).toBe(TURN_MIN_HIDDEN_MS - 50);
    expect(turnWait({ ...t, changedAt: 1700, now: 1700 })).toBe(TURN_LAYOUT_SETTLE_MS);
    expect(turnWait({ ...t, changedAt: 1700, now: 1700 + TURN_LAYOUT_SETTLE_MS })).toBe(0);
  });

  it('shows the content after the time limit in any case', () => {
    expect(turnWait({ ...base, tracksLayout: true, layoutReady: false, now: 1000 + TURN_MAX_HIDDEN_MS })).toBe(0);
  });
});
