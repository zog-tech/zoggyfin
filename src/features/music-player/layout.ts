/**
 * Sizes of the music player (Now Playing). Pure, so it is unit-tested.
 *
 * A wide window has two columns of the same width: the player on the left,
 * the queue or lyrics on the right. The left column has a fixed width (half
 * the window), so the art and the controls are computed from the width the
 * column really gets. A flex column lost part of its width to the padding of
 * the right column, and the art then touched the left edge.
 */
import { spacing } from '@/theme/theme';

/** Two columns (player | queue or lyrics) from this window width. */
export const WIDE = 900;

export interface NowPlayingSizes {
  wide: boolean;
  /** The width of the left (player) column; the window width on a narrow window. */
  columnWidth: number;
  /** The width of the title row, scrubber and controls. */
  contentWidth: number;
  /** The side of the square artwork. */
  artSize: number;
}

export function nowPlayingSizes(o: { width: number; height: number; insetTop: number; insetBottom: number; longForm: boolean }): NowPlayingSizes {
  const wide = o.width >= WIDE;
  const columnWidth = wide ? Math.floor(o.width / 2) : o.width;
  const contentWidth = Math.min(columnWidth, wide ? 560 : 600) - spacing.xl * 2;
  // Room for the title, scrubber, transport and bottom rows below the art.
  const below = o.longForm ? 330 : 360;
  // Wide windows also stack the header and the title above the controls in one column.
  const artSize = Math.max(140, Math.min(contentWidth, o.height - o.insetTop - o.insetBottom - below - (wide ? 110 : 40), 560));
  return { wide, columnWidth, contentWidth, artSize };
}
