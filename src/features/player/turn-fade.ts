/**
 * The rule for hiding the player controls while the screen turns.
 *
 * On a rotation the video view takes the new size at once (native layout),
 * but the controls depend on values that come to JS one after another: the
 * window, the safe-area insets, then measured heights. The controls laid out
 * in three or four steps during the turn, and on a phone each step showed as
 * a jump. The player hides the controls when the window turns and shows them
 * again when no size change came for `TURN_SETTLE_MS`, so only the finished
 * layout is seen. Pure, so it is unit-tested.
 */

export interface Size {
  width: number;
  height: number;
}

/** No size change for this long: the turn (about 0.4 s on an iPhone) and the new layout are done. */
export const TURN_SETTLE_MS = 450;
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
