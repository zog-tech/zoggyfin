/**
 * Layout from the window or content width (design system §2). Pure: no React,
 * so it is unit-tested. TV gets its own 10-foot sizes (§ TV in the spec).
 */
import { type Breakpoint, breakpointFor, gridFor, type GridResult, layout, spacing, type TileKind } from './theme';

/**
 * TV sizes, designed on a 1920-point-wide screen (Apple TV). Android TV
 * reports 960 dp, so every value is scaled by `width / 1920`.
 */
export const tv = {
  baseWidth: 1920,
  /**
   * The overscan-safe area: 5 % of each edge (Android TV and Fire TV ask for
   * 48 x 27 dp at 1080p). Controls, text and focus marks stay inside it;
   * backgrounds and artwork may bleed to the edge.
   */
  safeX: 96,
  safeY: 54,
  /** The collapsed side menu: a slim rail of icons, inside the safe area. */
  railWidth: 184,
  /** The side menu when it is open (icons and labels). */
  menuWidth: 520,
  /** The page margin: the same 5 % as the safe area. */
  gutter: 96,
  /**
   * Row and grid tiles are sized like the streaming apps on TV: about seven
   * posters or four and a half wide tiles across, close together, so a row
   * reads as a strip and the next row shows below.
   */
  tileGap: 24,
  sectionGap: 36,
  rowTileWidth: { poster: 200, thumb: 340, square: 230, circle: 170 } satisfies Record<TileKind, number>,
  gridMinTile: { poster: 196, thumb: 340, square: 220, circle: 160 } satisfies Record<TileKind, number>,
  /** Type sizes are the phone sizes times this (before the screen scale). */
  typeScale: 1.8,
  /** The focused tile grows by this much (its ring then stays clear of the next tile at `tileGap`). */
  focusScale: 1.06,
  /** Focus ring width and gap in points (not scaled with the screen). */
  focusRingWidth: 3,
  focusRingGap: 3,
  railItemHeight: 72,
  railIcon: 40,
  /** The Home billboard takes this share of the screen height. */
  billboardFactor: 0.44,
} as const;

export function tvScale(width: number): number {
  return Math.max(0.5, width / tv.baseWidth);
}

/** The TV safe-area inset (overscan) for a screen width, in points. Zero off TV. */
export interface SafeInset {
  x: number;
  y: number;
}

export function tvSafeInset(width: number): SafeInset {
  const s = tvScale(width);
  return { x: Math.round(tv.safeX * s), y: Math.round(tv.safeY * s) };
}

/**
 * The space a focused TV tile of this size needs on each side: it grows by
 * `focusScale` around its centre and the ring sits outside it. A row or a
 * scroll view with less padding than this cuts the ring off.
 */
export function tvFocusBleed(size: number): number {
  return Math.ceil((size * (tv.focusScale - 1)) / 2 + tv.focusRingWidth + tv.focusRingGap + 2);
}

/**
 * TV: a full-width list row (a track, an episode) whose focus fill must stay
 * inside the safe area. The row stops one gutter before the right edge, and
 * its fill reaches `spacing.md` into the left gutter; with `padX` as the
 * row's own side padding, the content keeps the page's left edge.
 */
export function tvRowInset(gutter: number): { marginLeft: number; marginRight: number; padX: number } {
  const padX = Math.min(spacing.md, gutter);
  return { marginLeft: gutter - padX, marginRight: gutter, padX };
}

/**
 * The space after the last TV Home row: just enough for the last row to
 * scroll up to the top of the list, and no more. With more, Android's
 * ScrollView scrolls on into the empty space when Down has no row to go to,
 * and the rows slide out of view.
 */
export function tvPageEndPadding(viewportHeight: number, rowsHeight: number, lastRowTop: number): number {
  return Math.max(0, Math.round(viewportHeight - (rowsHeight - lastRowTop)));
}

export interface LayoutInfo {
  tv: boolean;
  bp: Breakpoint;
  /** Width the screen content gets (the window minus a sidebar or rail). */
  contentWidth: number;
  gutter: number;
  gap: number;
  /** Vertical gap between Home rows. */
  sectionGap: number;
  /** Tile width in a horizontal row. */
  rowTile: Record<TileKind, number>;
  /** TV: the overscan-safe inset from each screen edge (see `tv.safeX`). Zero elsewhere. */
  safe: SafeInset;
}

/**
 * Layout for a window. `sidebar` is the width of a visible sidebar (iPad) or
 * the TV rail; grids and rows use the width that is left.
 */
export function layoutFor(width: number, opts: { tv?: boolean; sidebar?: number } = {}): LayoutInfo {
  if (opts.tv) {
    const s = tvScale(width);
    const rail = (opts.sidebar ?? tv.railWidth) * s;
    const r = (k: TileKind) => Math.round(tv.rowTileWidth[k] * s);
    return {
      tv: true,
      bp: 'wide',
      contentWidth: Math.max(0, width - rail),
      gutter: Math.round(tv.gutter * s),
      gap: Math.round(tv.tileGap * s),
      sectionGap: Math.round(tv.sectionGap * s),
      rowTile: { poster: r('poster'), thumb: r('thumb'), square: r('square'), circle: r('circle') },
      safe: tvSafeInset(width),
    };
  }
  const contentWidth = Math.max(0, width - (opts.sidebar ?? 0));
  const bp = breakpointFor(contentWidth);
  return {
    tv: false,
    bp,
    contentWidth,
    gutter: layout.gutter[bp],
    gap: layout.tileGap[bp],
    sectionGap: 28,
    rowTile: {
      poster: layout.rowTileWidth.poster[bp],
      thumb: layout.rowTileWidth.thumb[bp],
      square: layout.rowTileWidth.square[bp],
      circle: layout.rowTileWidth.circle[bp],
    },
    safe: { x: 0, y: 0 },
  };
}

/** Grid columns and tile width for a content width. TV uses the 10-foot minimum tile widths. */
export function gridLayout(kind: TileKind, contentWidth: number, isTv = false, screenWidth = contentWidth): GridResult {
  if (!isTv) return gridFor(kind, contentWidth);
  const s = tvScale(screenWidth);
  const gutter = Math.round(tv.gutter * s);
  const gap = Math.round(tv.tileGap * s);
  const min = tv.gridMinTile[kind] * s;
  const [lo, hi] = layout.gridColumnLimits[kind];
  const inner = contentWidth - gutter * 2;
  const columns = Math.min(hi, Math.max(lo, Math.floor((inner + gap) / (min + gap))));
  const tileWidth = Math.floor((inner - gap * (columns - 1)) / columns);
  return { columns, tileWidth, gap, gutter };
}
