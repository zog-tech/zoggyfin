/**
 * A virtualized poster grid of IPTV titles, laid out like `ItemGrid`: the
 * columns come from the width the grid really has (`gridLayout`), and `key`
 * changes with the column count so FlashList rebuilds once. A category can
 * hold thousands of films.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type ReactElement, useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';

import { tileHeight } from '@/components/tile';
import { flashScroll, useTvPageScroll } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { gridLayout, spacing, tvFocusBleed, useLayout } from '@/theme';

import { VodTile, type VodTileData } from './vod-tile';

export function VodGrid({
  items,
  onPress,
  onLongPress,
  ListHeaderComponent,
  ListEmptyComponent,
  focusFirstTile = true,
}: {
  items: VodTileData[];
  onPress: (data: VodTileData) => void;
  onLongPress?: (data: VodTileData) => void;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  /** TV: the first tile takes the first focus of the page. */
  focusFirstTile?: boolean;
}) {
  const l = useLayout();
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const [measured, setMeasured] = useState(0);
  const width = measured || l.contentWidth;
  const { columns, tileWidth, gap, gutter } = gridLayout('poster', width, l.tv, l.width);
  // TV: room above the first row for the focus scale and ring. With a
  // header, the room goes between the header and the first row, or the
  // grown tile's ring touches the header.
  const bleed = l.tv ? tvFocusBleed(tileHeight('poster', tileWidth)) + spacing.lg : 0;
  const topPad = l.tv && !ListHeaderComponent ? bleed : spacing.sm;
  const header = l.tv && ListHeaderComponent ? <View style={{ paddingBottom: bleed }}>{ListHeaderComponent}</View> : ListHeaderComponent;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== measured) setMeasured(w);
  };
  const list = useRef<FlashListRef<VodTileData>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => flashScroll(list.current?.getNativeScrollRef()), []), { onLayout });

  const renderItem = useCallback(
    ({ item, index }: { item: VodTileData; index: number }) => (
      <View
        style={{
          marginBottom: gap + spacing.sm,
          paddingLeft: ((index % columns) * gap) / columns,
          paddingRight: ((columns - 1 - (index % columns)) * gap) / columns,
        }}>
        <VodTile data={item} width={tileWidth} onPress={onPress} onLongPress={onLongPress} firstFocus={l.tv && focusFirstTile && index === 0} />
      </View>
    ),
    [columns, gap, tileWidth, onPress, onLongPress, l.tv, focusFirstTile],
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
      renderItem={renderItem}
    />
  );
}
