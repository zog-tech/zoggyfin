/**
 * Rules of the mini player that need no React. Pure, so it is unit-tested.
 * On a phone the audio mini player has no close button: a swipe down stops it
 * (a second X would sit next to the search field's clear X).
 */

export const DISMISS_DISTANCE = 56;
export const DISMISS_VELOCITY = 600;

export function showsCloseButton(o: { inline: boolean; isAudio: boolean; web: boolean; tv: boolean }): boolean {
  if (o.inline) return false;
  // Video, Live TV, TV and the web keep the button: no swipe with a remote or a mouse.
  return !o.isAudio || o.web || o.tv;
}

export function canSwipeDismiss(o: { isAudio: boolean; web: boolean; tv: boolean }): boolean {
  return o.isAudio && !o.web && !o.tv;
}

/** Past the distance, or a fast fling down, stops playback. */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  return translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY;
}
