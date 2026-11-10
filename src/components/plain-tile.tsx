/**
 * The tile of something that is not a Jellyfin item: an IPTV film, series
 * or episode, or an extension entry. The same look as the media tile
 * (`tile.tsx`, design system §7.3): one picture, a title, one line of
 * metadata, a white progress bar on the art, at most one badge. It only
 * takes plain data.
 *
 * A tile with no `onPress` is not a button (an extension entry that only
 * opens a panel, on TV): it takes no focus and does not dim.
 */
import { memo } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';

import { TileCaption, TileFocusFill } from '@/components/tile-caption';
import { Touchable } from '@/components/touchable';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, mediaColors, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

import { PlainArt, type PlainKind } from './plain-art';

export interface PlainTileData {
  key: string;
  id: string;
  kind: PlainKind;
  title: string;
  subtitle?: string | null;
  poster?: string | null;
  /** 0..1, or null for no bar. */
  progress?: number | null;
  /** A short label on the art, for example "New". */
  badge?: string | null;
}

export const PlainTile = memo(function PlainTile({
  data,
  width,
  aspectRatio = 2 / 3,
  onPress,
  onLongPress,
  firstFocus,
  onFocus,
  index = 0,
}: {
  data: PlainTileData;
  width: number;
  /** Poster (2:3) by default; 16:9 for stills. */
  aspectRatio?: number;
  /** No `onPress`: the tile is not a button. */
  onPress?: (data: PlainTileData) => void;
  onLongPress?: (data: PlainTileData) => void;
  /** TV: take the first focus of the page. */
  firstFocus?: boolean;
  /**
   * The tile took the focus (TV). Pass a stable function: the tile is a memo.
   * Work for `tvFocusRest` must use the data as its key: the tile drops it on blur.
   */
  onFocus?: (data: PlainTileData, index: number) => void;
  /** The tile's place in its row, passed back to `onFocus`. */
  index?: number;
}) {
  const s = useStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const progress = data.progress ?? null;
  const label = [data.title, data.subtitle, data.badge, progress !== null ? `${Math.round(progress * 100)} percent watched` : null].filter(Boolean).join(', ');
  const body = (
    <>
      <TileFocusFill artHeight={width / aspectRatio} radius={radius.md} />
      <View>
        <PlainArt uri={data.poster} name={data.title} id={data.id} kind={data.kind} width={width} aspectRatio={aspectRatio} showTitle={progress === null} />
        {data.badge ? (
          <View style={s.badge}>
            <Text style={s.badgeText} numberOfLines={1}>
              {data.badge}
            </Text>
          </View>
        ) : null}
        {progress !== null ? (
          <View style={s.progress}>
            <View style={[s.progressFill, { width: `${Math.max(2, Math.round(progress * 100))}%` }]} />
          </View>
        ) : null}
      </View>
      <TileCaption title={data.title} sub={data.subtitle} lines={fontScale >= 1.5 ? 2 : 1} />
    </>
  );
  if (!onPress) {
    return (
      <View style={{ width }} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Touchable
      kind="tile"
      radius={radius.md}
      // TV: the lit caption strip is the focus mark (design system §7.19).
      ring={!isTV}
      onPress={() => onPress(data)}
      onLongPress={onLongPress ? () => onLongPress(data) : undefined}
      firstFocus={firstFocus}
      onFocus={onFocus ? () => onFocus(data, index) : undefined}
      // The focus left before it rested: work keyed by this tile's data must not run.
      onBlur={onFocus ? () => tvFocusRest.drop(data) : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ width }}>
      {body}
    </Touchable>
  );
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
  progress: {
    position: 'absolute' as const,
    left: scaled(sizes.progressInset),
    right: scaled(sizes.progressInset),
    bottom: scaled(sizes.progressInset),
    height: scaled(sizes.progress),
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: mediaColors.white, borderRadius: radius.pill },
  badge: {
    position: 'absolute' as const,
    top: scaled(sizes.badgeInset),
    left: scaled(sizes.badgeInset),
    maxWidth: '80%' as const,
    minHeight: scaled(sizes.badge),
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
  },
  badgeText: { ...font(type.footnote), fontWeight: '600' as const, color: mediaColors.white },
}));
