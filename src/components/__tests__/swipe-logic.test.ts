import { activeOffsetX, armed, COMMIT_X, FLING_VX, swipeEnd, swipeOffset } from '../swipe-logic';

const both = { leading: true, trailing: true };
const leadingOnly = { leading: true, trailing: false };
const trailingOnly = { leading: false, trailing: true };

describe('activeOffsetX', () => {
  it('starts in both directions when both sides have an action', () => {
    expect(activeOffsetX(both)).toEqual([-12, 12]);
  });

  it('never starts toward a side with no action', () => {
    const [left, right] = activeOffsetX(leadingOnly);
    expect(right).toBe(12);
    expect(left).toBeLessThan(-1000);
    const [l2, r2] = activeOffsetX(trailingOnly);
    expect(l2).toBe(-12);
    expect(r2).toBeGreaterThan(1000);
  });
});

describe('swipeOffset', () => {
  it('follows the finger up to the threshold', () => {
    expect(swipeOffset(50, both)).toBe(50);
    expect(swipeOffset(-80, both)).toBe(-80);
  });

  it('resists past the threshold and never runs away', () => {
    const past = swipeOffset(COMMIT_X + 200, both);
    expect(past).toBeGreaterThan(COMMIT_X);
    expect(past).toBeLessThan(COMMIT_X + 40);
    expect(swipeOffset(-(COMMIT_X + 200), both)).toBe(-past);
  });

  it('does not move toward a side with no action', () => {
    expect(swipeOffset(-60, leadingOnly)).toBe(0);
    expect(swipeOffset(60, trailingOnly)).toBe(0);
  });

  it('is armed from the threshold on', () => {
    expect(armed(COMMIT_X - 1)).toBe(false);
    expect(armed(swipeOffset(COMMIT_X, both))).toBe(true);
    expect(armed(swipeOffset(-COMMIT_X - 30, both))).toBe(true);
  });
});

describe('swipeEnd', () => {
  it('runs the leading action on a full swipe right', () => {
    expect(swipeEnd(COMMIT_X, 0, both)).toBe('leading');
  });

  it('runs the trailing action on a full swipe left', () => {
    expect(swipeEnd(-COMMIT_X - 5, 0, both)).toBe('trailing');
  });

  it('springs back after a partial swipe', () => {
    expect(swipeEnd(COMMIT_X - 1, 0, both)).toBeNull();
    expect(swipeEnd(-40, -100, both)).toBeNull();
  });

  it('runs on a fast fling in the direction of travel', () => {
    expect(swipeEnd(30, FLING_VX, both)).toBe('leading');
    expect(swipeEnd(-30, -FLING_VX, both)).toBe('trailing');
  });

  it('cancels a fling back toward the middle, even past the threshold', () => {
    expect(swipeEnd(COMMIT_X + 20, -FLING_VX - 1, both)).toBeNull();
    expect(swipeEnd(-COMMIT_X - 20, FLING_VX + 1, both)).toBeNull();
  });

  it('never runs a side with no action', () => {
    expect(swipeEnd(-COMMIT_X * 2, -FLING_VX * 2, leadingOnly)).toBeNull();
    expect(swipeEnd(COMMIT_X * 2, FLING_VX * 2, trailingOnly)).toBeNull();
  });

  it('ignores a tiny flick', () => {
    expect(swipeEnd(4, FLING_VX * 2, both)).toBeNull();
  });
});
