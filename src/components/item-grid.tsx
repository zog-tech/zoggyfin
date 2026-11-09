import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type ReactElement, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, RefreshControl, StyleSheet, View } from 'react-native';

import { usePrefetchItem } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { tvDrivenScroll } from '@/features/tv/scroll';
import { useOpenItem } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { gridLayout, spacing, tvFocusBleed, useLayout, useTheme } from '@/theme';

import { useItemMenu } from './action-sheet';
import { refreshTint, useRefreshSpinner } from './refresh-spinner';
import { Tile, tileHeight, type TileShape } from './tile';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

interface ItemGridProps {
  items: BaseItemDto[];
  shape: TileShape;
  onEndReached?: () => void;
  isFetchingMore?: boolean;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  /** Pull to refresh. The spinner shows only for a pull, not for background refetches. */
  onRefresh?: () => unknown;
  /** Overrides the default "open item" press. */
  onPress?: (item: BaseItemDto) => void;
  /** Insets for a grid under a transparent or large-title header. Default true. */
  autoInset?: boolean;
  /** TV: the first tile takes the first focus. Off when the header holds rows of tiles above the grid. Default true. */
  focusFirstTile?: boolean;
  /** The screen has no header bar (a tab's root page): the iOS 26 refresh spinner sits higher. */
  headerless?: boolean;
  /** Draws its own tile for an item it knows (the Live TV tile in the Library). Null keeps the media tile. */
  renderTile?: (item: BaseItemDto, tile: { width: number; preferredFocus: boolean }) => ReactElement | null;
  /** Long press (right click on the web and the Mac app) opens the item actions. Not on TV. Default true. */
  itemMenu?: boolean;
}

/**
 * A virtualized grid of tiles (FlashList). Columns come from the width the
 * grid really has (`gridFor` in the theme), so a sidebar, Split View or the
 * TV rail give the right column count. `key` changes with the column count,
 * so FlashList rebuilds once instead of animating cells.
 *
 * TV: the row with the focus scrolls to the middle of the grid. Android's
 * ScrollView alone scrolls only until the focused tile shows, so the focused
 * row sat on the bottom edge with its title and focus ring cut off. The end
 * padding is only the focus room, so Down on the last row has no empty space
 * to scroll into (like the Home rows, `tvPageEndPadding`). Android's own
 * focus scroll is off (`tvDrivenScroll`): on fast Up presses it paged up past
 * rows FlashList had not drawn, and the grid then slid back to the focus.
 */
export function ItemGrid({
  items,
  shape,
  onEndReached,
  isFetchingMore,
  ListHeaderComponent,
  ListEmptyComponent,
  onRefresh,
  onPress,
  autoInset = true,
  focusFirstTile = true,
  headerless = false,
  renderTile,
  itemMenu = true,
}: ItemGridProps) {
  const l = useLayout();
  const tabBottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset });
  const { c } = useTheme();
  const openItem = useOpenItem();
  const pull = usePullRefresh(onRefresh);
  useRefreshSpinner(pull.refreshing, headerless);
  const open = onPress ?? openItem;
  const menu = useItemMenu();
  const longPress = itemMenu && !l.tv ? menu.open : undefined;
  const prefetch = usePrefetchItem();
  const [measured, setMeasured] = useState(0);
  const width = measured || l.contentWidth;
  const g = gridLayout(shape, width, l.tv, l.width);
  const { columns, tileWidth, gap, gutter } = g;
  // TV: room above the first row and below the last for the focus scale and ring.
  const focusRoom = tvFocusBleed(tileHeight(shape, tileWidth)) + spacing.lg;
  const topPad = l.tv ? focusRoom : autoInset ? spacing.xs : spacing.lg;
  const bottomPad = l.tv ? focusRoom : tabBottomPad;

  const list = useRef<FlashListRef<BaseItemDto>>(null);
  const focusedRow = useRef(-1);
  const centerRow = useCallback(
    (index: number) => {
      const row = Math.floor(index / columns);
      if (row === focusedRow.current) return;
      focusedRow.current = row;
      // The offset from the row's layout: scrollToIndex sent the focus back to the first tile on Android TV.
      const grid = list.current;
      const cell = grid?.getLayout(row * columns);
      if (!grid || !cell) return;
      const view = grid.getWindowSize().height;
      // The first row shows the header too: Android no longer scrolls to the focus on its own.
      const offset = row === 0 ? 0 : Math.max(0, grid.getFirstItemOffset() + cell.y - (view - cell.height) / 2);
      grid.scrollToOffset({ offset, animated: true });
    },
    [columns],
  );

  // TV: one stable function for every tile (the tile is a memo). The row centres at once;
  // the prefetch waits until the focus rests (features/tv/focus-settle).
  const onTileFocus = useCallback(
    (it: BaseItemDto, index: number) => {
      centerRow(index);
      tvFocusRest.push(() => prefetch(it), it.Id ?? it);
    },
    [centerRow, prefetch],
  );

  // TV: the focus can reach the header (the filter chips) past rows not drawn yet; the grid then scrolls to the top.
  const showHeader = useCallback(() => {
    focusedRow.current = -1;
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);
  const header = l.tv && ListHeaderComponent ? <View onFocusCapture={showHeader}>{ListHeaderComponent}</View> : ListHeaderComponent;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== measured) setMeasured(w);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: BaseItemDto; index: number }) => (
      // Equal gaps: each cell gives up the same share of the gaps.
      <View
        style={{
          marginBottom: gap + spacing.sm,
          paddingLeft: ((index % columns) * gap) / columns,
          paddingRight: ((columns - 1 - (index % columns)) * gap) / columns,
        }}>
        {renderTile?.(item, { width: tileWidth, preferredFocus: l.tv && focusFirstTile && index === 0 }) ?? (
          <Tile
            item={item}
            width={tileWidth}
            shape={shape}
            onPress={open}
            onLongPress={longPress}
            preferredFocus={l.tv && focusFirstTile && index === 0}
            index={index}
            onFocusItem={l.tv ? onTileFocus : undefined}
          />
        )}
      </View>
    ),
    [columns, gap, tileWidth, shape, open, longPress, l.tv, onTileFocus, focusFirstTile, renderTile],
  );

  return (
    <>
      <FlashList
        ref={list}
        onLayout={onLayout}
        data={items}
        numColumns={columns}
        key={columns}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        contentInsetAdjustmentBehavior={autoInset ? 'automatic' : 'never'}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomPad, paddingTop: topPad }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.8}
        refreshControl={pull.onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} /> : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={ListEmptyComponent}
        ListFooterComponent={isFetchingMore ? <ActivityIndicator style={styles.footer} color={c.text2} /> : null}
        renderItem={renderItem}
        // TV: the app scrolls to the focused row. A header with rows of tiles (focusFirstTile off) keeps Android's own focus scroll.
        {...(l.tv && focusFirstTile ? tvDrivenScroll : null)}
        // TV: three screens of rows above and below are drawn. With less, a burst of Up presses
        // outran the scroll and Android found the header before the next row.
        drawDistance={l.tv ? l.height * 3 : undefined}
      />
      {menu.sheet}
    </>
  );
}

const styles = StyleSheet.create({
  footer: { marginVertical: spacing.xl },
});
