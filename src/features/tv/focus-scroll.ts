/**
 * Where a TV page scrolls when a view in it takes the focus. Pure, so it is
 * unit-tested.
 *
 * The page moves as little as it can: the focused view (or its whole row)
 * stays a margin away from the top and bottom edges, so the focus ring and the
 * next view show. Near an end the page goes all the way, so the title above
 * the first control and any text after the last one come into view, because
 * no D-pad press reaches them. The offset never leaves the content, so the
 * page never scrolls past its end and cuts rows off.
 */

export interface FocusScrollInput {
  /** Where the page is now (or is gliding to). */
  offset: number;
  /** The focused view's edges in the content. */
  top: number;
  bottom: number;
  /** The visible height of the page and the height of its content. */
  viewport: number;
  content: number;
  /** The space kept between the focused view and an edge. */
  margin: number;
}

/** The share of the page height kept free above and below the focused view. */
export const FOCUS_SCROLL_MARGIN = 0.15;

export function focusScrollOffset({ offset, top, bottom, viewport, content, margin }: FocusScrollInput): number {
  const max = Math.max(0, content - viewport);
  let next = offset;
  if (bottom - top > viewport - margin * 2) next = top - margin;
  else if (top < offset + margin) next = top - margin;
  else if (bottom > offset + viewport - margin) next = bottom - viewport + margin;

  if (next < offset && next < viewport / 2 && bottom <= viewport - margin) next = 0;
  else if (next > offset && max - next < viewport / 2 && top - max >= margin) next = max;
  return Math.min(max, Math.max(0, next));
}
