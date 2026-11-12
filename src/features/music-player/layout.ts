/**
 * Sizes of the music player (Now Playing). Pure, so it is unit-tested.
 *
 * Three layouts, picked from the window:
 * - `stack`: one column (phone portrait, narrow windows).
 * - `wide`: two columns of the same width, the player on the left and the
 *   queue or lyrics on the right. The left column has a fixed width (half
 *   the window), so the art and the controls are computed from the width the
 *   column really gets. A flex column lost part of its width to the padding
 *   of the right column, and the art then touched the left edge.
 * - `landscape`: a short, wide window (a phone on its side). The art is on
 *   the left at the full usable height, the title and the controls are on
 *   the right. The side insets (notch, Dynamic Island) pad both edges. The
 *   one-column layout gave the art 140 pt and pushed the controls off the
 *   bottom, and the two-column layout (a Pro Max is 932 pt wide) had no
 *   room for the art either.
 *
 * Every size comes from one set of inputs (the window frame and the safe
 * area insets), so a rotation gives the final layout in one render.
 */
import { spacing } from '@/theme/theme';

/** Two columns (player | queue or lyrics) from this window width. */
export const WIDE = 900;
/** A window lower than this and wider than high gets the landscape layout. */
export const SHORT = 500;
/** The landscape controls column: never narrower (the transport row fits) or wider than this. */
export const LANDSCAPE_CONTROLS = { min: 280, max: 440 } as const;

export type NowPlayingMode = 'stack' | 'wide' | 'landscape';

export interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface NowPlayingSizes {
  mode: NowPlayingMode;
  wide: boolean;
  /** The width of the left column: the player (wide), the art or the panel (landscape); the window width in `stack`. */
  columnWidth: number;
  /** The width of the title row, scrubber and controls. */
  contentWidth: number;
  /** The side of the square artwork. */
  artSize: number;
  /** Landscape only: the padding around the two columns (the safe area, at least the page margin). Zero otherwise. */
  pad: Edges;
  /** Landscape only: the gap between the art and the controls. */
  gap: number;
}

export interface NowPlayingInput {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
  insetLeft?: number;
  insetRight?: number;
  longForm: boolean;
}

const NO_PAD: Edges = { top: 0, bottom: 0, left: 0, right: 0 };

/** The bottom padding of the whole screen: the home indicator, at least the page margin. */
export function bottomPad(insetBottom: number): number {
  return Math.max(insetBottom, spacing.lg);
}

export function isLandscape(width: number, height: number): boolean {
  return height < SHORT && width > height;
}

export function nowPlayingSizes(o: NowPlayingInput): NowPlayingSizes {
  if (isLandscape(o.width, o.height)) return landscapeSizes(o);
  const wide = o.width >= WIDE;
  const columnWidth = wide ? Math.floor(o.width / 2) : o.width;
  const contentWidth = Math.min(columnWidth, wide ? 560 : 600) - spacing.xl * 2;
  // Room for the title, scrubber, transport and bottom rows below the art.
  const below = o.longForm ? 330 : 360;
  // Wide windows also stack the header and the title above the controls in one column.
  const artSize = Math.max(140, Math.min(contentWidth, o.height - o.insetTop - o.insetBottom - below - (wide ? 110 : 40), 560));
  return { mode: wide ? 'wide' : 'stack', wide, columnWidth, contentWidth, artSize, pad: NO_PAD, gap: 0 };
}

function landscapeSizes(o: NowPlayingInput): NowPlayingSizes {
  const pad: Edges = {
    top: Math.max(o.insetTop, spacing.lg),
    bottom: bottomPad(o.insetBottom),
    left: Math.max(o.insetLeft ?? 0, spacing.xl),
    right: Math.max(o.insetRight ?? 0, spacing.xl),
  };
  const gap = spacing.xxxl;
  const usable = o.width - pad.left - pad.right;
  const artSize = Math.floor(Math.max(120, Math.min(o.height - pad.top - pad.bottom, usable - gap - LANDSCAPE_CONTROLS.min, 560)));
  const contentWidth = Math.floor(Math.max(LANDSCAPE_CONTROLS.min, Math.min(LANDSCAPE_CONTROLS.max, usable - gap - artSize)));
  return { mode: 'landscape', wide: false, columnWidth: artSize, contentWidth, artSize, pad, gap };
}
