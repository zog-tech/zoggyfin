/**
 * Where a TV page scrolls when a view in it takes the focus. Pure, so it is
 * unit-tested.
 *
 * The page moves as little as it can: the focused view (or its whole row)
 * stays a margin away from the top and bottom edges, so the focus ring and the
 * next view show. Near an end the page goes all the way, so the title above
 * the first control and any text after the last one come into view, because
 * no D-pad press reaches them. On the way up that is any view that fits on
 * the first screen: an item page's buttons sit low on a full-screen banner,
 * and stopping a margin above them cut the show's title and logo off. The
 * offset never leaves the content, so the page never scrolls past its end
 * and cuts rows off.
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

  if (next < offset && bottom <= viewport - margin) next = 0;
  else if (next > offset && max - next < viewport / 2 && top - max >= margin) next = max;
  return Math.min(max, Math.max(0, next));
}

/** The space kept above a row that the page brings to its top. */
export const ROW_TOP_MARGIN = 0.04;

/**
 * Where the page scrolls when a row of tiles takes the focus: the row (with
 * its title) goes to the top of the page, like the streaming apps, so no part
 * of the row above stays at the top edge, cut off by it. Near the start the
 * page goes all the way up, so what is above the first row shows (the page
 * title, an item's art). The offset never leaves the content: the last rows
 * stop where the page ends.
 */
export function rowScrollOffset({ top, viewport, content, margin }: Omit<FocusScrollInput, 'offset' | 'bottom'>): number {
  const max = Math.max(0, content - viewport);
  const next = top - margin;
  if (next < viewport * 0.25) return 0;
  return Math.min(max, Math.max(0, next));
}
