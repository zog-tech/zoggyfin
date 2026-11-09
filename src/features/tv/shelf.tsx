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
import { type ComponentRef, createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { type FocusTarget, TvFocusGuide } from './focus';
import { tvDrivenScroll } from './scroll';
import { shelfWindow, type ShelfWindow } from './shelf-window';

/** Home on TV: the page that scrolls the row with the focus under the billboard. */
export interface TvRowPage {
  scrollTo: (row: FocusTarget | null) => void;
  /** A row mounts; the page sizes its end so the last row can scroll up and no further. Returns the cleanup. */
  track: (row: RefObject<FocusTarget | null>) => () => void;
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
  useEffect(() => page?.track(target), [page, target]);

  const count = items.length;
  const perScreen = useWindowDimensions().width / step;
  // The window and the focus it was made for. It changes only when the focus nears an end of it.
  const [state, setState] = useState<{ win: ShelfWindow; focus: number }>(() => ({ win: shelfWindow(null, 0, count, perScreen), focus: 0 }));
  // A new item count or screen width fits the same window again, around the same focus.
  const shown = shelfWindow(state.win, state.focus, count, perScreen);
  const live = useRef({ shown, count, perScreen });
  useEffect(() => {
    live.current = { shown, count, perScreen };
  });
  const follow = useCallback((index: number) => {
    const { shown: cur, count: n, perScreen: per } = live.current;
    const next = shelfWindow(cur, index, n, per);
    if (next === cur) return;
    live.current = { ...live.current, shown: next };
    setState({ win: next, focus: index });
  }, []);

  const onFocusAt = useCallback(
    (item: T, index: number) => {
      scroll.current?.scrollTo({ x: index * step, animated: true });
      follow(index);
      page?.scrollTo(target.current);
      onFocusItem?.(item, index);
    },
    [step, page, target, onFocusItem, follow],
  );

  // The list starts `bleed` before the first tile, so the tile left of the
  // focused one is cut off by the list edge instead of showing under the rail.
  const inset = Math.min(bleed, gutter);
  return (
    <TvFocusGuide ref={row} autoFocus>
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
