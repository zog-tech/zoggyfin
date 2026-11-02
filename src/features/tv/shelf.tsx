/**
 * A TV row of tiles. Not virtualized: Home rows are short, and a recycled
 * cell under the focus made tiles go blank and the focus jump on fast D-pad
 * presses. The focused tile keeps a fixed place at the leading edge of the
 * row (the row scrolls, not the focus), and Up or Down into a row lands on
 * the tile that had the focus there last (an autoFocus focus guide).
 */
import { type ComponentRef, createContext, type ReactNode, type RefObject, useContext, useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { type FocusTarget, TvFocusGuide } from './focus';
import { tvDrivenScroll } from './scroll';

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
  /** `onFocus(index)` must run when the tile takes the focus. */
  renderTile: (item: T, index: number, onFocus: (index: number) => void) => ReactNode;
}) {
  const page = useContext(TvRowScroll);
  const step = tileWidth + gap;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const row = useRef<FocusTarget | null>(null);
  const target = anchor ?? row;
  useEffect(() => page?.track(target), [page, target]);
  const onFocusAt = (index: number) => {
    scroll.current?.scrollTo({ x: index * step, animated: true });
    page?.scrollTo(target.current);
  };

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
        contentContainerStyle={{ paddingLeft: inset, paddingRight: gutter, paddingVertical: padV, gap }}>
        {/* onFocusAt reads the refs in a focus event, not during render. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {items.map((it, i) => (
          <View key={keyOf(it, i)}>{renderTile(it, i, onFocusAt)}</View>
        ))}
      </ScrollView>
    </TvFocusGuide>
  );
}
