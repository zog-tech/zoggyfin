/**
 * A virtualized grid of plain tiles (IPTV titles, extension entries), laid
 * out like `ItemGrid`: the columns come from the width the grid really has
 * (`gridLayout`), and `key` changes with the column count so FlashList
 * rebuilds once. A grid can hold thousands of tiles.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type ReactElement, useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';

import { tileAspect, tileHeight, type TileShape } from '@/components/tile';
import { flashScroll, useTvPageScroll } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { gridLayout, spacing, tvFocusBleed, useLayout } from '@/theme';

import { PlainTile, type PlainTileData } from './plain-tile';

export function PlainGrid<T extends PlainTileData>({
  items,
  onPress,
  onLongPress,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
  focusFirstTile = true,
  shape = 'poster',
  onEndReached,
  refreshControl,
  renderTile,
  headerFullWidth = false,
}: {
  items: T[];
  onPress: (data: T) => void;
  onLongPress?: (data: T) => void;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
  /** TV: the first tile takes the first focus of the page. */
  focusFirstTile?: boolean;
  /** The tile shape. Poster by default. */
  shape?: TileShape;
  /** The list nears its end: load more. */
  onEndReached?: () => void;
  refreshControl?: ReactElement;
  /** Draws a tile in place of `PlainTile` (an extension entry that is a Jellyfin item). */
  renderTile?: (item: T, width: number, firstFocus: boolean) => ReactElement;
  /** The header spans the full width (rows that keep their own gutter), not the grid's padded width. */
  headerFullWidth?: boolean;
}) {
  const l = useLayout();
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const [measured, setMeasured] = useState(0);
  const width = measured || l.contentWidth;
  const { columns, tileWidth, gap, gutter } = gridLayout(shape, width, l.tv, l.width);
  // TV: room above the first row for the focus scale and ring. With a
  // header, the room goes between the header and the first row, or the
  // grown tile's ring touches the header.
  const bleed = l.tv ? tvFocusBleed(tileHeight(shape, tileWidth)) + spacing.lg : 0;
  const topPad = l.tv && !ListHeaderComponent ? bleed : spacing.sm;
  const header =
    ListHeaderComponent && (l.tv || headerFullWidth) ? (
      <View style={{ paddingBottom: l.tv ? bleed : 0, marginHorizontal: headerFullWidth ? -gutter : 0 }}>{ListHeaderComponent}</View>
    ) : (
      ListHeaderComponent
    );
  const aspect = tileAspect(shape);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== measured) setMeasured(w);
  };
  const list = useRef<FlashListRef<T>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => flashScroll(list.current?.getNativeScrollRef()), []), { onLayout });
  // The tile is a memo over plain data: the callbacks take the base type.
  const press = onPress as (d: PlainTileData) => void;
  const longPress = onLongPress as ((d: PlainTileData) => void) | undefined;

  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => (
      <View
        style={{
          marginBottom: gap + spacing.sm,
          paddingLeft: ((index % columns) * gap) / columns,
          paddingRight: ((columns - 1 - (index % columns)) * gap) / columns,
        }}>
        {renderTile ? (
          renderTile(item, tileWidth, l.tv && focusFirstTile && index === 0)
        ) : (
          <PlainTile data={item} width={tileWidth} aspectRatio={aspect} onPress={press} onLongPress={longPress} firstFocus={l.tv && focusFirstTile && index === 0} />
        )}
      </View>
    ),
    [columns, gap, tileWidth, aspect, press, longPress, l.tv, focusFirstTile, renderTile],
  );

  return (
    <FlashList
      ref={list}
      onLayout={onLayout}
      {...tvScroll.props}
      data={items}
      numColumns={columns}
      key={columns}
      keyExtractor={(it) => it.key}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomPad, paddingTop: topPad }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={ListEmptyComponent}
      ListFooterComponent={ListFooterComponent}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={refreshControl}
      renderItem={renderItem}
    />
  );
}
