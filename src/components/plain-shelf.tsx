/**
 * A titled row of plain tiles (IPTV Continue watching and Favourites).
 * TV uses the TV shelf (the focus keeps its place and the row scrolls, only
 * the tiles near the focus are mounted); other platforms a plain
 * horizontal list.
 */
import { ScrollView, Text, View } from 'react-native';

import { tileHeight } from '@/components/tile';
import { TvShelf } from '@/features/tv/shelf';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, gridLayout, spacing, tvFocusBleed, type, useLayout, useStyles } from '@/theme';

import { PlainTile, type PlainTileData } from './plain-tile';

export function PlainShelf<T extends PlainTileData>({
  title,
  items,
  onPress,
  onLongPress,
  firstFocus,
}: {
  title: string;
  items: T[];
  onPress: (d: T) => void;
  onLongPress?: (d: T) => void;
  /** TV: the first tile takes the first focus of the page. */
  firstFocus?: boolean;
}) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  if (!items.length) return null;
  const g = gridLayout('poster', l.contentWidth, l.tv, l.width);
  // A row shows a little more than the grid's column count, so it reads as a row that scrolls.
  const tileWidth = Math.round(g.tileWidth * (l.tv ? 0.85 : 0.9));
  const bleed = l.tv ? tvFocusBleed(tileHeight('poster', tileWidth)) : 0;
  // The tile is a memo over plain data: the callbacks take the base type.
  const press = onPress as (d: PlainTileData) => void;
  const longPress = onLongPress as ((d: PlainTileData) => void) | undefined;
  return (
    <View style={s.block}>
      <Text style={[s.title, { paddingHorizontal: g.gutter }]} accessibilityRole="header">
        {title}
      </Text>
      {isTV ? (
        <TvShelf
          items={items}
          keyOf={(d) => d.key}
          tileWidth={tileWidth}
          gap={g.gap}
          gutter={g.gutter}
          bleed={bleed}
          padV={bleed}
          renderTile={(d, i, onFocus) => (
            <PlainTile data={d} width={tileWidth} onPress={press} firstFocus={firstFocus && i === 0} index={i} onFocus={onFocus as (d: PlainTileData, i: number) => void} />
          )}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: g.gutter, gap: g.gap, paddingVertical: spacing.xs }}>
          {items.map((d) => (
            <PlainTile key={d.key} data={d} width={tileWidth} onPress={press} onLongPress={longPress} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  block: { marginBottom: spacing.lg },
  title: { ...font(type.title3), color: c.text, marginBottom: spacing.sm },
}));
