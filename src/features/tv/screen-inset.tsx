/**
 * TV Modern: art may run under the side menu rail. The tab content no longer
 * pads its left by the rail (`TvContent`); instead each page of a tab stack
 * sits in `TvScreenInset` (through `tvScreenLayout`), which pads it by the
 * rail unless the page asks for full bleed with `useTvFullBleed()` (Home, item
 * pages). Such a page pads its own text and rows by `TV_RAIL_INSET`, so the
 * content edge stays at the same place on every page. Classic and other
 * platforms keep the padding in `TvContent`: here the inset is 0 and the
 * hook does nothing.
 */
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { tvm, u } from '@/theme';

/** The rail's width that a Modern page keeps clear on its left. 0 in Classic and off TV. */
export const TV_RAIL_INSET: number = isTV && isTvModern ? u(tvm.size.rail) : 0;

const FullBleedContext = createContext<((on: boolean) => void) | null>(null);

/** Modern: this page draws under the rail (no left inset). A no-op in Classic and off TV. */
export function useTvFullBleed(): void {
  const set = useContext(FullBleedContext);
  useLayoutEffect(() => {
    if (!set) return;
    set(true);
    return () => set(false);
  }, [set]);
}

/** Modern: one page of a tab stack, padded by the rail unless it asked for full bleed. */
export function TvScreenInset({ children }: { children: ReactNode }) {
  const [bleed, setBleed] = useState(false);
  return (
    <FullBleedContext.Provider value={setBleed}>
      <View style={[styles.page, { paddingLeft: bleed ? 0 : TV_RAIL_INSET }]}>{children}</View>
    </FullBleedContext.Provider>
  );
}

const styles = StyleSheet.create({ page: { flex: 1 } });
