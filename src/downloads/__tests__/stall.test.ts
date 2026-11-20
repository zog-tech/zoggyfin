import { NUDGE_AFTER_MS, NUDGE_GAP_MS, QUIET_AFTER_MS, stallAction } from '../stall';

const T = 1_000_000;
const running = { state: 'downloading' as const, progressAt: T, speed: 3_000_000, bytesDone: 821_000_000 };
const yes = { canNudge: true };

describe('stallAction', () => {
  it('does nothing while bytes arrive', () => {
    expect(stallAction(running, T + QUIET_AFTER_MS - 1, yes)).toBe('none');
  });

  it('drops the old speed after a quiet time', () => {
    expect(stallAction(running, T + QUIET_AFTER_MS, yes)).toBe('quiet');
    expect(stallAction({ ...running, speed: 0 }, T + QUIET_AFTER_MS, yes)).toBe('none');
  });

  it('nudges a stalled download once a minute passed', () => {
    expect(stallAction(running, T + NUDGE_AFTER_MS, yes)).toBe('nudge');
    expect(stallAction({ ...running, speed: 0 }, T + NUDGE_AFTER_MS, yes)).toBe('nudge');
  });

  it('waits between nudges', () => {
    const now = T + NUDGE_AFTER_MS + 10_000;
    expect(stallAction({ ...running, speed: 0 }, now, { canNudge: true, lastNudge: now - NUDGE_GAP_MS + 1 })).toBe('none');
    expect(stallAction({ ...running, speed: 0 }, now, { canNudge: true, lastNudge: now - NUDGE_GAP_MS })).toBe('nudge');
  });

  it('never nudges when it may not (background, offline, no engine support) or before any bytes', () => {
    expect(stallAction(running, T + NUDGE_AFTER_MS, { canNudge: false })).toBe('quiet');
    expect(stallAction({ ...running, bytesDone: 0 }, T + NUDGE_AFTER_MS, yes)).toBe('quiet');
  });

  it('ignores downloads that do not run', () => {
    for (const state of ['queued', 'paused', 'failed', 'completed', 'cancelled'] as const) {
      expect(stallAction({ ...running, state }, T + NUDGE_AFTER_MS, yes)).toBe('none');
    }
    expect(stallAction({ ...running, progressAt: null }, T + NUDGE_AFTER_MS, yes)).toBe('none');
  });
});
