/**
 * What Right does in the TV side menu. Right closes the menu, except in the
 * "Now playing" row: there it goes from the cover to the play/pause button first.
 *
 * Android moves the focus on its own and sends the key to JS too, in no fixed
 * order. So a play/pause button that took the focus a moment ago took it from
 * this same press, and the press must not close the menu.
 *
 * Pure, so it is unit-tested.
 */

/** The part of the "Now playing" row with the focus, or null for any other menu item. */
export type NowPart = 'cover' | 'toggle' | null;

/** A play/pause focus younger than this came from the same Right press. */
export const TOGGLE_FOCUS_GRACE_MS = 250;

export type MenuRightAction = 'focus-toggle' | 'stay' | 'close';

export function menuRightAction(part: NowPart, toggleFocusedAt: number, now: number): MenuRightAction {
  if (part === 'cover') return 'focus-toggle';
  if (part === 'toggle' && now - toggleFocusedAt < TOGGLE_FOCUS_GRACE_MS) return 'stay';
  return 'close';
}
