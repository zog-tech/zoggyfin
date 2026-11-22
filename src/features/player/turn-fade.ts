/**
 * The rule for hiding the player controls while the screen turns.
 *
 * On a rotation the video view takes the new size at once (native layout),
 * but the controls depend on values that come to JS one after another: the
 * window, the safe-area insets, then measured heights. The controls laid out
 * in three or four steps during the turn, and on a phone each step showed as
 * a jump. The player hides the controls when the window turns and shows them
 * again when no size change came for `TURN_SETTLE_MS`, so only the finished
 * layout is seen.
 *
 * A screen can also give the size it laid out with. Then the content comes
 * back only after that size has the new orientation: on an iPhone the music
 * player showed its old layout at the new size for about 0.35 s after the
 * turn, longer than a fixed wait. Pure, so it is unit-tested.
 */

export interface Size {
  width: number;
  height: number;
}

/** No size change for this long: the turn (about 0.4 s on an iPhone) and the new layout are done. */
export const TURN_SETTLE_MS = 450;
/** With a laid-out size: the wait after the layout caught up, so the new frames are on the screen. */
export const TURN_LAYOUT_SETTLE_MS = 150;
/** The content stays out at least this long: the system turn animation. */
export const TURN_MIN_HIDDEN_MS = 400;
/** The content comes back after this long in any case. */
export const TURN_MAX_HIDDEN_MS = 1500;
/** The fade back in after a turn. */
export const TURN_FADE_IN_MS = 200;

/**
 * True when the window changed between portrait and landscape. A size change
 * that keeps the orientation (a split view, a window resize on the Mac) is
 * not a turn: the layout follows it in place.
 */
export function turned(prev: Size, next: Size): boolean {
  if (prev.width <= 0 || prev.height <= 0 || next.width <= 0 || next.height <= 0) return false;
  return prev.width > prev.height !== next.width > next.height;
}

/** True when the laid-out size has the window's orientation (a zero size cannot tell, so it counts). */
export function caughtUp(laidOut: Size, window: Size): boolean {
  if (laidOut.width <= 0 || laidOut.height <= 0 || window.width <= 0 || window.height <= 0) return true;
  return laidOut.width > laidOut.height === window.width > window.height;
}

export interface TurnClock {
  /** Now, in ms. */
  now: number;
  /** When the content went out. */
  hiddenAt: number;
  /** The last window or layout change. */
  changedAt: number;
  /** The laid-out size has the new orientation (always true without a laid-out size). */
  layoutReady: boolean;
  /** The screen gives its laid-out size. */
  tracksLayout: boolean;
}

/** How long to wait before the content may come back; 0 means show it now. */
export function turnWait(c: TurnClock): number {
  const hidden = c.now - c.hiddenAt;
  if (hidden >= TURN_MAX_HIDDEN_MS) return 0;
  if (!c.layoutReady) return Math.min(TURN_MAX_HIDDEN_MS - hidden, TURN_LAYOUT_SETTLE_MS);
  const quiet = c.tracksLayout ? TURN_LAYOUT_SETTLE_MS : TURN_SETTLE_MS;
  const wait = Math.max(quiet - (c.now - c.changedAt), c.tracksLayout ? TURN_MIN_HIDDEN_MS - hidden : 0);
  return Math.max(0, wait);
}
