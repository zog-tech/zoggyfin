/**
 * The rules of a row swipe (`swipe-row.tsx`): when the pan starts, how far the
 * row follows the finger, and which action an end of the pan runs.
 *
 * "Leading" is the action at the left edge: the finger moves right to show
 * it. "Trailing" is at the right edge: the finger moves left.
 *
 * Pure, so it is unit-tested. The functions are worklets: the gesture runs
 * them on the UI thread.
 */

export type SwipeSide = 'leading' | 'trailing';

export interface SwipeSides {
  leading: boolean;
  trailing: boolean;
}

/** Horizontal travel that starts the swipe. A smaller vertical travel first lets the list scroll. */
export const ACTIVATE_X = 12;
/** Vertical travel that hands the touch to the list before the swipe starts. */
export const FAIL_Y = 10;
/** Travel past which a release runs the action. */
export const COMMIT_X = 110;
/** A release faster than this (points per second) in the direction of travel runs the action. */
export const FLING_VX = 900;
/** Touches that start this near the left edge of the row go to the back swipe of the stack. */
export const EDGE_X = 24;
/** Travel the row shows past the threshold before it resists. */
const OVERSHOOT = 40;

/** Far enough that the pan never starts in this direction. */
const NEVER = 10_000;

/**
 * `activeOffsetX` for the pan: it starts only toward a side that has an
 * action, so the other direction stays free for the pager and the back swipe.
 */
export function activeOffsetX(sides: SwipeSides): [number, number] {
  'worklet';
  return [sides.trailing ? -ACTIVATE_X : -NEVER, sides.leading ? ACTIVATE_X : NEVER];
}

/**
 * Where the row sits for a finger travel `dx`. It does not move toward a
 * side with no action. Past the threshold it moves slower, so the release
 * point is easy to feel.
 */
export function swipeOffset(dx: number, sides: SwipeSides): number {
  'worklet';
  const allowed = (dx > 0 && sides.leading) || (dx < 0 && sides.trailing);
  if (!allowed) return 0;
  const a = Math.abs(dx);
  const out = a <= COMMIT_X ? a : COMMIT_X + OVERSHOOT * (1 - 1 / ((a - COMMIT_X) / OVERSHOOT + 1));
  return dx > 0 ? out : -out;
}

/** True when a release at this travel runs the action (the label shows it). */
export function armed(offset: number): boolean {
  'worklet';
  return Math.abs(offset) >= COMMIT_X;
}

/**
 * The action a release runs, or null (the row springs back). Past the
 * threshold, or a fast fling in the direction of travel. A fling back toward
 * the middle cancels.
 */
export function swipeEnd(dx: number, vx: number, sides: SwipeSides): SwipeSide | null {
  'worklet';
  if (dx > 0 && sides.leading) {
    if (vx < -FLING_VX) return null;
    if (dx >= COMMIT_X || (vx >= FLING_VX && dx >= ACTIVATE_X)) return 'leading';
  }
  if (dx < 0 && sides.trailing) {
    if (vx > FLING_VX) return null;
    if (-dx >= COMMIT_X || (vx <= -FLING_VX && -dx >= ACTIVATE_X)) return 'trailing';
  }
  return null;
}
