import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { DownloadBadge, downloadLabel } from '@/components/download-indicator';
import { Icon } from '@/components/icon';
import { useDownloadStatus } from '@/downloads';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { playedFraction, remainingLabel, subtitleFor } from '@/lib/format';
import { isTV } from '@/platform/tv';
import { createStyles,
  type AppTheme,
  font,
  iconSize,
  mediaColors,
  motion,
  radius,
  scaled,
  scriptStyle,
  sizes,
  type,
  useStyles,
  tv,
  tvFocusBleed,
  useTheme,
} from '@/theme';

import { ItemImage } from './item-image';
import { SHAPES, shapeFor, type TileShape } from './tile-shape';
import { Touchable, type TouchState } from './touchable';

export { shapeFor, shapeForList, type TileShape } from './tile-shape';

export interface TileProps {
  item: BaseItemDto;
  width: number;
  shape?: TileShape;
  onPress: (item: BaseItemDto) => void;
  onLongPress?: (item: BaseItemDto) => void;
  /** Override the title line. */
  title?: string | null;
  subtitle?: string | null;
  showProgress?: boolean;
  /** Title and metadata on the artwork over a scrim (Continue watching). */
  titleOnArt?: boolean;
  /** TV: take the first focus on the screen. */
  preferredFocus?: boolean;
  /** Only the artwork, no title under it (TV Home: the billboard shows the focused title). */
  artOnly?: boolean;
  /**
   * The tile took the focus (TV). Pass a stable function: the tile is a memo.
   * Work for `tvFocusRest` must use the item as its key: the tile drops it on blur.
   */
  onFocusItem?: (item: BaseItemDto, index: number) => void;
  /** The tile's place in its row or grid, passed back to `onFocusItem`. */
  index?: number;
}

function radiusFor(shape: TileShape): number {
  return shape === 'square' ? radius.sm : radius.md;
}

/**
 * The media tile (design system §7.3): one picture, a title and one line of
 * metadata, a white progress bar on the art, at most one badge. Flat at rest;
 * it lifts with the `raised` shadow only on hover and focus.
 */
export const Tile = memo(function Tile({
  item,
  width,
  shape,
  onPress,
  onLongPress,
  title,
  subtitle,
  showProgress = true,
  titleOnArt = false,
  preferredFocus,
  artOnly = false,
  onFocusItem,
  index = 0,
}: TileProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { fontScale } = useWindowDimensions();
  const kind = shape ?? shapeFor(item);
  const shapeInfo = SHAPES[kind];
  const circle = kind === 'circle';
  const r = circle ? width / 2 : radiusFor(kind);

  const progress = showProgress ? playedFraction(item) : null;
  const played = !!item.UserData?.Played && item.Type !== 'MusicAlbum' && item.Type !== 'Audio' && item.Type !== 'Series';
  const unplayed = item.Type === 'Series' ? item.UserData?.UnplayedItemCount ?? 0 : 0;
  const titleText = title ?? (item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name) ?? '';
  const sub = subtitle !== undefined ? subtitle : item.Type === 'Episode' ? item.Name : subtitleFor(item);
  const left = remainingLabel(item);
  const lines = fontScale >= 1.5 ? 2 : 1;
  const download = useDownloadStatus(item.Id);

  const label = [titleText, sub, progress !== null ? left : null, played ? 'played' : null, downloadLabel(download)].filter(Boolean).join(', ');

  return (
    <Touchable
      // A round tile (people, artists): press, hover and focus show on the circle only, not around the name.
      kind={circle ? 'plain' : 'tile'}
      ring={!circle}
      radius={r}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      firstFocus={preferredFocus}
      onFocus={onFocusItem ? () => onFocusItem(item, index) : undefined}
      // The focus left before it rested: the work this tile pushed (keyed by its item) must not run.
      onBlur={onFocusItem ? () => tvFocusRest.drop(item) : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ width }}>
      {/*
        Only a round tile reads the press, hover and focus state (its art, ring
        and name change). A plain node lets Touchable skip the re-render on
        focus: its ring and scale run on the UI thread.
      */}
      {circle ? (st: TouchState) => body(st) : body(REST)}
    </Touchable>
  );

  function body({ pressed, hovered, focused }: TouchState) {
    return (
      <>
        <View style={circle ? circleArt(focused, hovered) : undefined}>
          <ItemImage
            item={item}
            variant={shapeInfo.variant}
            width={width}
            aspectRatio={shapeInfo.aspect}
            rounded={r}
            circle={circle}
            hideArtTitle={titleOnArt || progress !== null}
          />
          {titleOnArt ? (
            <View style={[StyleSheet.absoluteFill, s.artText, { borderRadius: r }]} pointerEvents="none">
              <LinearGradient
                colors={[c.artScrimTop, c.artScrimBottom]}
                locations={[0.4, 1]}
                style={StyleSheet.absoluteFill}
              />
              <Text style={[s.onArtTitle, scriptStyle(titleText, s.onArtTitle)]} numberOfLines={1}>
                {titleText}
              </Text>
              {sub || left ? (
                <Text style={s.onArtMeta} numberOfLines={1}>
                  {[sub, left].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {progress !== null ? <Progress fraction={progress} inline /> : null}
            </View>
          ) : progress !== null ? (
            <Progress fraction={progress} />
          ) : null}
          {download.state !== 'none' ? (
            // One badge per tile: the download state comes first.
            <DownloadBadge status={download} id={item.Id} />
          ) : played ? (
            <View style={s.badge}>
              <Icon name="checkmark" size={iconSize.xs} color={mediaColors.white} weight="bold" />
            </View>
          ) : unplayed > 0 ? (
            <View style={[s.badge, s.countBadge]}>
              <Text style={s.count}>{unplayed}</Text>
            </View>
          ) : null}
          {circle ? <CircleFocus radius={r} pressed={pressed} hovered={hovered} focused={focused} /> : null}
        </View>
        {!titleOnArt && !artOnly ? (
          <>
            <Text
              style={[s.title, circle && s.center, circle && isTV && { marginTop: tvFocusBleed(width) },
                circle && isTV && !focused && s.dim, scriptStyle(titleText, circle ? s.center : s.title)]}
              numberOfLines={lines}>
              {titleText}
            </Text>
            {sub ? (
              <Text style={[s.meta, circle && s.center, circle && focused && s.metaFocused, scriptStyle(sub, circle ? s.center : s.meta)]} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </>
        ) : null}
      </>
    );
  }
});

/** The state a tile that does not read it renders with. */
const REST: TouchState = { pressed: false, hovered: false, focused: false };

/** A round tile's art: TV grows it on focus; elsewhere it lifts a little on hover and focus. */
function circleArt(focused: boolean, hovered: boolean) {
  if (focused && isTV) return { transform: [{ scale: tv.focusScale }] };
  if (focused || hovered) return { transform: [{ scale: motion.press.hoverScale }] };
  return undefined;
}

/** The press and hover overlay and the focus ring of a round tile, on the circle only. */
function CircleFocus({ radius: r, pressed, hovered, focused }: { radius: number; pressed: boolean; hovered: boolean; focused: boolean }) {
  const { c } = useTheme();
  const ringW = isTV ? tv.focusRingWidth : 2;
  const gap = isTV ? tv.focusRingGap : 2;
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: r },
          pressed ? { backgroundColor: mediaColors.pressOverlay } : hovered && !isTV ? { backgroundColor: mediaColors.hoverOverlay } : null,
        ]}
      />
      {focused ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -(gap + ringW),
            left: -(gap + ringW),
            right: -(gap + ringW),
            bottom: -(gap + ringW),
            borderRadius: r + gap + ringW,
            borderWidth: ringW,
            borderColor: isTV ? mediaColors.white : c.focusRing,
          }}
        />
      ) : null}
    </>
  );
}

function Progress({ fraction, inline }: { fraction: number; inline?: boolean }) {
  const s = useStyles(makeStyles);
  return (
    <View style={inline ? s.progressInline : s.progress}>
      <View style={[s.progressFill, { width: `${Math.max(2, Math.round(fraction * 100))}%` }]} />
    </View>
  );
}

export function tileAspect(shape: TileShape): number {
  return SHAPES[shape].aspect;
}

/** Height of a tile with its text, for skeletons and fixed row heights. */
export function tileHeight(shape: TileShape, width: number, withText = true): number {
  const art = width / SHAPES[shape].aspect;
  if (!withText) return art;
  return art + sizes.tileTitleGap + scaled(type.tileTitle.lineHeight) + sizes.tileMetaGap + scaled(type.caption1.lineHeight);
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
  center: { textAlign: 'center' as const },
  dim: { color: c.text2 },
  metaFocused: { color: c.text },
  artText: { overflow: 'hidden' as const, justifyContent: 'flex-end' as const, padding: scaled(sizes.progressInset) },
  onArtTitle: { ...font(type.tileTitle), fontSize: scaled(15), color: c.textOnMedia },
  onArtMeta: { ...font(type.caption1), color: c.textOnMediaSecondary, marginTop: sizes.tileMetaGap },
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
  progressInline: {
    marginTop: scaled(8),
    height: scaled(sizes.progress),
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: mediaColors.white, borderRadius: radius.pill },
  badge: {
    position: 'absolute' as const,
    top: sizes.badgeInset,
    right: sizes.badgeInset,
    minWidth: scaled(sizes.badge),
    height: scaled(sizes.badge),
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countBadge: { paddingHorizontal: 6 },
  count: { ...font(type.caption2, { tabular: true }), color: mediaColors.white },
}));
