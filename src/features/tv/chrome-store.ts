/**
 * TV: state of the app chrome that pages read.
 * - `menuOpen`: the side menu is open. Home's preview stops while the user moves in the menu.
 * - `shownTab`: the tab the user picked in the side menu, shown before the router has switched to
 *   it (side-menu.tsx). Null when the router's tab is the one shown.
 * - `moves`: counts focus moves on Home. A preview pauses at once on a move (its video made every
 *   frame of the page's glide cost twice as much) and starts again only after a new rest.
 */
import { create } from 'zustand';

interface TvChrome {
  menuOpen: boolean;
  shownTab: string | null;
  moves: number;
}

export const useTvChrome = create<TvChrome>(() => ({ menuOpen: false, shownTab: null, moves: 0 }));

/** The playing preview's pause, called at once on a move (no React work in between). */
let pausePreview: (() => void) | null = null;
export function setPreviewPause(fn: (() => void) | null): void {
  pausePreview = fn;
}

/** The focus moved on Home (a tile or the featured buttons). */
export function noteHomeMove(): void {
  pausePreview?.();
  useTvChrome.setState((st) => ({ moves: st.moves + 1 }));
}
