/**
 * Which tiles of a TV row and which Home rows are mounted. A TV stick has
 * little memory, so only the tiles near the focus exist: about one screen
 * behind the focused tile, the visible screen and about one screen ahead.
 * The window moves only when the focus comes near one of its ends, so a held
 * D-pad renders the row once every few tiles, not on every press, and the
 * tile with the focus is always inside the window (it is never unmounted
 * under the focus, and the row's focus guide can always give it back).
 *
 * Home mounts its rows the same way: the rows above and on screen, and new
 * rows when the focused row comes within two screens of the last one.
 *
 * Pure, so it is unit-tested.
 */

/** Tiles `[start, end)` of a row are mounted. */
export interface ShelfWindow {
  start: number;
  end: number;
}

/**
 * The window for a row of `count` tiles with the focus on `focus`, where
 * `perScreen` tiles fill the screen. Returns `prev` (the same object) while
 * it still holds enough tiles on both sides of the focus.
 *
 * The focused tile sits at the leading edge, so the screen to its right is
 * always mounted, plus two tiles. Behind it, a screen of tiles stays mounted:
 * fast presses must find the next tile mounted while the row renders the new
 * window (with only two tiles behind, quick Left presses on the emulator
 * were lost). When the window moves, it moves a screen ahead in the
 * direction of travel, so it moves once per screen of presses.
 */
export function shelfWindow(prev: ShelfWindow | null, focus: number, count: number, perScreen: number): ShelfWindow {
  const screen = Math.max(1, Math.ceil(perScreen));
  const n = Math.max(0, count);
  const f = Math.min(Math.max(0, focus), Math.max(0, n - 1));
  const minAhead = screen + 2;
  const minBehind = screen;
  const fit = (start: number, end: number): ShelfWindow => ({ start: Math.max(0, start), end: Math.min(n, end) });
  if (!prev || prev.end > n || f < prev.start || f >= prev.end) return fit(f - minBehind, f + minAhead + screen + 1);
  if (prev.start > 0 && f - prev.start < minBehind) return fit(f - minBehind - screen, f + minAhead + 1);
  if (prev.end < n && prev.end - f <= minAhead) return fit(f - minBehind, f + minAhead + screen + 1);
  return prev;
}

/**
 * How many Home rows (sections) to mount. More rows mount, two at a time,
 * while the content below the focused row is shorter than two list heights.
 * Returns `mounted` when nothing more is needed. Before the list has a size,
 * it keeps what it has.
 */
export function rowsToMount({
  mounted,
  total,
  contentHeight,
  rowTop,
  listHeight,
}: {
  mounted: number;
  total: number;
  /** Height of the mounted rows. */
  contentHeight: number;
  /** Top of the row with the focus (0 before any row has it). */
  rowTop: number;
  listHeight: number;
}): number {
  if (mounted >= total || listHeight <= 0) return Math.min(mounted, total);
  if (contentHeight - Math.max(0, rowTop) >= 2 * listHeight) return mounted;
  return Math.min(total, mounted + 2);
}
