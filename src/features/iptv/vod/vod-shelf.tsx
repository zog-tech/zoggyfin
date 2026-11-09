/**
 * A titled row of IPTV tiles (Continue watching, Favourites). TV uses the
 * TV shelf (the focus keeps its place and the row scrolls); other platforms
 * a plain horizontal list.
 */
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { tileHeight } from '@/components/tile';
import { TvShelf } from '@/features/tv/shelf';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, gridLayout, spacing, tvFocusBleed, type, useLayout, useStyles } from '@/theme';

import type { LiveGroup } from '../nav';
import { vodDetailHref } from './vod-nav';
import { VodTile, type VodTileData } from './vod-tile';

export function VodShelf({
  title,
  items,
  onPress,
  onLongPress,
  firstFocus,
}: {
  title: string;
  items: VodTileData[];
  onPress: (d: VodTileData) => void;
  onLongPress?: (d: VodTileData) => void;
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
          renderTile={(d, i, onFocus) => <VodTile data={d} width={tileWidth} onPress={onPress} firstFocus={firstFocus && i === 0} index={i} onFocus={onFocus} />}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: g.gutter, gap: g.gap, paddingVertical: spacing.xs }}>
          {items.map((d) => (
            <VodTile key={d.key} data={d} width={tileWidth} onPress={onPress} onLongPress={onLongPress} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** Opens the page of a tile: a film, a series, or the series of an episode. */
export function openTile(group: LiveGroup, providerId: string, d: VodTileData, seriesOf?: (episodeId: string) => string | undefined): void {
  if (d.kind === 'film') router.push(vodDetailHref(group, 'film', providerId, d.id));
  else if (d.kind === 'series') router.push(vodDetailHref(group, 'series', providerId, d.id));
  else {
    const seriesId = seriesOf?.(d.id);
    if (seriesId) router.push(vodDetailHref(group, 'series', providerId, seriesId));
  }
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  block: { marginBottom: spacing.lg },
  title: { ...font(type.title3), color: c.text, marginBottom: spacing.sm },
}));
