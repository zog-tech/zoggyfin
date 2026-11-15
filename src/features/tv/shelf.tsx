/**
 * A TV row of tiles. Only the tiles near the focus are mounted (a window,
 * see shelf-window.ts); spacing in front of and after them keeps the row its
 * full width, so every tile keeps its place and the scroll offset stays put.
 * It is not a recycling list (FlashList): a recycled cell under the focus
 * made tiles go blank and the focus jump on fast D-pad presses. Here a tile
 * keeps its view while it is in the window, and the window always holds the
 * focused tile, so the focus never sits on a view that goes away.
 *
 * The focused tile keeps a fixed place at the leading edge of the row (the
 * row scrolls, not the focus), and Up or Down into a row lands on the tile
 * that had the focus there last (an autoFocus focus guide; that tile is
 * still mounted, because the window moves only with the focus).
 * The focus callback that a tile gets is stable (it takes the item and its
 * index), so a memo tile does not re-render when the row renders again.
 */
import { type ComponentRef, createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { interpolate, type SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { type FocusTarget, TvFocusGuide } from './focus';
import { tvDrivenScroll } from './scroll';
import { restingWindow, rowTraps, shelfWindow, type ShelfWindow } from './shelf-window';

/**
 * The row that had the focus last. Only that row mounts its full window of
 * tiles; the others mount only what is on screen (`restingWindow`).
 */
let activeShelf: object | null = null;
const shelfListeners = new Set<() => void>();
/**
 * The focus came into a row: it gets its full window once the focus has stayed a while, after
 * the page glide and the billboard change. Mounting a screenful of tiles took 30 ms on the UI
 * thread of a TV stick: in the middle of a glide or a fade that is a visible stutter, while
 * nothing moves it is not. Moving on to another row before then mounts nothing. The tiles a
 * press can reach before then are mounted (a resting row holds the screen after its remembered
 * tile and the one before it); a press near the end of them activates the row at once.
 * One timer for all rows.
 */
const ACTIVATE_AFTER_MS = 1100;
let pendingShelf: object | null = null;
let activateTimer: ReturnType<typeof setTimeout> | null = null;
function activateNow(id: object): void {
  if (activateTimer) clearTimeout(activateTimer);
  activateTimer = null;
  pendingShelf = null;
  if (activeShelf === id) return;
  activeShelf = id;
  shelfListeners.forEach((l) => l());
}
function setActiveShelf(id: object): void {
  if (activeShelf === id || pendingShelf === id) return;
  pendingShelf = id;
  if (activateTimer) clearTimeout(activateTimer);
  activateTimer = setTimeout(() => activateNow(id), ACTIVATE_AFTER_MS);
}
function subscribeShelves(l: () => void): () => void {
  shelfListeners.add(l);
  return () => {
    shelfListeners.delete(l);
  };
}

/** Home on TV: the page that scrolls the row with the focus under the billboard. */
export interface TvRowPage {
  scrollTo: (row: FocusTarget | null) => void;
  /**
   * A row mounts; the page sizes its end so the last row can scroll up and no further. With
   * `top`, the page writes the row's top in its content there (for the row fade). Returns the cleanup.
   */
  track: (row: RefObject<FocusTarget | null>, top?: SharedValue<number>) => () => void;
  /** The page's scroll offset on the UI thread, when it has one (Home). */
  scrollY?: SharedValue<number>;
}

/**
 * Home on TV: a row fades out as it slides up past the line where the focused row sits (under
 * the billboard), and fades back in when it comes down to it, like the streaming apps. Without
 * it the row was cut at a hard line while it moved. `top` is the row's top in the page content
 * (the page writes it, see `track`); the fade runs on the UI thread from the scroll offset.
 */
export function useRowFade(fadeDistance: number): { top: SharedValue<number>; style: ReturnType<typeof useAnimatedStyle> } {
  const page = useContext(TvRowScroll);
  const scrollY = page?.scrollY ?? null;
  const top = useSharedValue(-1);
  const style = useAnimatedStyle(() => {
    if (!scrollY || top.get() < 0) return { opacity: 1 };
    return { opacity: interpolate(top.get() - scrollY.get(), [-fadeDistance, 0], [0, 1], 'clamp') };
  });
  return { top, style };
}

export const TvRowScroll = createContext<TvRowPage | null>(null);

export function TvShelf<T>({
  items,
  keyOf,
  tileWidth,
  gap,
  gutter,
  bleed,
  padV,
  anchor,
  top,
  onFocusItem,
  renderTile,
}: {
  items: readonly T[];
  keyOf: (item: T, index: number) => string;
  tileWidth: number;
  gap: number;
  /** Where the first tile starts. */
  gutter: number;
  /** Room the focused tile needs around it (scale and ring). */
  bleed: number;
  padV: number;
  /** The view the page scrolls to (the row with its header). Default: the tiles. */
  anchor?: RefObject<FocusTarget | null>;
  /** Where the page writes the row's top (`useRowFade`). */
  top?: SharedValue<number>;
  /** A tile took the focus, after the row scrolled to it. Keep it stable (useCallback). */
  onFocusItem?: (item: T, index: number) => void;
  /** `onFocus(item, index)` must run when the tile takes the focus. It is stable: pass it as it is. */
  renderTile: (item: T, index: number, onFocus: (item: T, index: number) => void) => ReactNode;
}) {
  const page = useContext(TvRowScroll);
  const step = tileWidth + gap;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const row = useRef<FocusTarget | null>(null);
  const target = anchor ?? row;
  useEffect(() => page?.track(target, top), [page, target, top]);

  const count = items.length;
  const perScreen = useWindowDimensions().width / step;
  const [id] = useState(() => ({}));
  const active = useSyncExternalStore(subscribeShelves, () => activeShelf === id);
  // The window and the focus it was made for. It changes only when the focus nears an end of it.
  const [state, setState] = useState<{ win: ShelfWindow; focus: number }>(() => ({ win: shelfWindow(null, 0, count, perScreen), focus: 0 }));
  // A new item count or screen width fits the same window again, around the same focus.
  const full = shelfWindow(state.win, state.focus, count, perScreen);
  // Away from the focus the row mounts only what is on screen; the focus brings the full window back.
  // The tile the focus was on last. Read when the row goes to rest: that change renders the row.
  const lastFocus = useRef(0);
  // eslint-disable-next-line react-hooks/refs
  const shown = active ? full : restingWindow(lastFocus.current, count, perScreen);
  // Left and Right stay in the row except from its first and last tile (rowTraps). The focus may
  // outrun the window on fast presses: the next tile is then padding, and the press must not leave
  // the row (Left would open the side menu). The traps change only at the ends of the row.
  const [edgeFocus, setEdgeFocus] = useState(-1);
  const traps = rowTraps(edgeFocus, count);
  const live = useRef({ shown: full, count, perScreen, traps, active, resting: shown });
  useEffect(() => {
    live.current = { shown: full, count, perScreen, traps, active, resting: shown };
  });
  const follow = useCallback((index: number) => {
    const { shown: cur, count: n, perScreen: per, traps: had } = live.current;
    const want = rowTraps(index, n);
    if (want.left !== had.left || want.right !== had.right) {
      live.current = { ...live.current, traps: want };
      setEdgeFocus(index);
    }
    const next = shelfWindow(cur, index, n, per);
    if (next === cur) return;
    live.current = { ...live.current, shown: next };
    setState({ win: next, focus: index });
  }, []);

  const onFocusAt = useCallback(
    (item: T, index: number) => {
      scroll.current?.scrollTo({ x: index * step, animated: true });
      lastFocus.current = index;
      // Near the end of the tiles a resting row holds: the full window now, so the next presses find tiles.
      const { active: on, resting } = live.current;
      if (!on && (index <= resting.start || index >= resting.end - 2)) activateNow(id);
      else setActiveShelf(id);
      follow(index);
      page?.scrollTo(target.current);
      onFocusItem?.(item, index);
    },
    [step, page, target, onFocusItem, follow, id],
  );

  // The list starts `bleed` before the first tile, so the tile left of the
  // focused one is cut off by the list edge instead of showing under the rail.
  const inset = Math.min(bleed, gutter);
  return (
    <TvFocusGuide ref={row} autoFocus trapLeft={traps.left} trapRight={traps.right}>
      <ScrollView
        ref={scroll}
        {...tvDrivenScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginLeft: gutter - inset }}
        // The tiles outside the window become padding of the same width.
        contentContainerStyle={{
          paddingLeft: inset + shown.start * step,
          paddingRight: gutter + (count - shown.end) * step,
          paddingVertical: padV,
          gap,
        }}>
        {/* onFocusAt reads the refs in a focus event, not during render. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {items.slice(shown.start, shown.end).map((it, k) => {
          const i = shown.start + k;
          return <View key={keyOf(it, i)}>{renderTile(it, i, onFocusAt)}</View>;
        })}
      </ScrollView>
    </TvFocusGuide>
  );
}
