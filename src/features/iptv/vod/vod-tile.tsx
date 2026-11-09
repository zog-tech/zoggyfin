/**
 * The tile of an IPTV film, series or episode. The same look as the media
 * tile (`components/tile.tsx`, design system §7.3): one picture, a title, one
 * line of metadata, a white progress bar on the art. It only takes provider
 * data, not a Jellyfin item.
 */
import { memo } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { TileCaption, TileFocusFill } from '@/components/tile-caption';
import { Touchable } from '@/components/touchable';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, mediaColors, radius, scaled, sizes, useStyles } from '@/theme';

import { VodArt } from './vod-art';

export interface VodTileData {
  key: string;
  id: string;
  kind: 'film' | 'series' | 'episode';
  title: string;
  subtitle?: string | null;
  poster?: string | null;
  /** 0..1, or null for no bar. */
  progress?: number | null;
}

export const VodTile = memo(function VodTile({
  data,
  width,
  aspectRatio = 2 / 3,
  onPress,
  onLongPress,
  firstFocus,
  onFocus,
  index = 0,
}: {
  data: VodTileData;
  width: number;
  /** Poster (2:3) by default; 16:9 for episode stills. */
  aspectRatio?: number;
  onPress: (data: VodTileData) => void;
  onLongPress?: (data: VodTileData) => void;
  /** TV: take the first focus of the page. */
  firstFocus?: boolean;
  /**
   * The tile took the focus (TV). Pass a stable function: the tile is a memo.
   * Work for `tvFocusRest` must use the data as its key: the tile drops it on blur.
   */
  onFocus?: (data: VodTileData, index: number) => void;
  /** The tile's place in its row, passed back to `onFocus`. */
  index?: number;
}) {
  const s = useStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const progress = data.progress ?? null;
  const label = [data.title, data.subtitle, progress !== null ? `${Math.round(progress * 100)} percent watched` : null].filter(Boolean).join(', ');
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
      <TileFocusFill artHeight={width / aspectRatio} radius={radius.md} />
      <View>
        <VodArt uri={data.poster} name={data.title} id={data.id} kind={data.kind} width={width} aspectRatio={aspectRatio} showTitle={progress === null} />
        {progress !== null ? (
          <View style={s.progress}>
            <View style={[s.progressFill, { width: `${Math.max(2, Math.round(progress * 100))}%` }]} />
          </View>
        ) : null}
      </View>
      <TileCaption title={data.title} sub={data.subtitle} lines={fontScale >= 1.5 ? 2 : 1} />
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
}));
