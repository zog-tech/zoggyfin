import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { DownloadBadge, downloadLabel } from '@/components/download-indicator';
import { Icon } from '@/components/icon';
import { useDownloadStatus } from '@/downloads';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { playedFraction, remainingLabel, subtitleFor } from '@/lib/format';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { savedName } from '@/player/audio/catalog';
import { useSavedId } from '@/player/audio/catalog-links';
import { useSongMark } from '@/player/use-song-mark';
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
  tvFont,
  tvm,
  u,
  useTheme,
  withAlpha,
} from '@/theme';

import { ItemImage } from './item-image';
import { TileCaption, TileFocusFill, TV_CAPTION_PAD, TvArtRing, tvModernCaptionHeight } from './tile-caption';
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
  /** Only the artwork, no title under it (TV Modern: the library root, where the server art carries the name). */
  artOnly?: boolean;
  /**
   * The tile took the focus (TV). Pass a stable function: the tile is a memo.
   * Work for `tvFocusRest` must use the item Id (or the item when it has none) as its key: the tile drops it on blur.
   */
  onFocusItem?: (item: BaseItemDto, index: number) => void;
  /** The tile's place in its row or grid, passed back to `onFocusItem`. */
  index?: number;
}

/** TV Modern (design system §7.22): one tile radius, a ring of 4 u with a 4 u gap, scale 1.08. */
const MODERN = isTV && isTvModern;

function radiusFor(shape: TileShape): number {
  if (MODERN) return u(tvm.size.tileRadius);
  return shape === 'square' ? radius.sm : radius.md;
}

/**
 * The media tile (design system §7.3): one picture, a title and one line of
 * metadata, a white progress bar on the art, at most one badge. Flat at rest;
 * it lifts with the `raised` shadow only on hover and focus. On TV a focused
 * tile with a caption lights its caption strip instead of the ring
 * (`tile-caption.tsx`); in the TV Modern look it gets the ring on its art
 * (`TvArtRing`) and its caption turns white.
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
  // A song tile shows when it plays; a catalog song (☁) the server saved shows the saved name.
  const song = item.Type === 'Audio' ? item.Id : null;
  const mark = useSongMark(song);
  const saved = useSavedId(song);
  const name = song && saved !== song ? savedName(item.Name) : item.Name;
  const titleText = title ?? (item.Type === 'Episode' ? item.SeriesName ?? item.Name : name) ?? '';
  const sub = subtitle !== undefined ? subtitle : item.Type === 'Episode' ? item.Name : subtitleFor(item);
  const left = remainingLabel(item);
  const lines = fontScale >= 1.5 ? 2 : 1;
  const download = useDownloadStatus(item.Id);

  // TV: a tile with a caption shows the focus as the lit caption strip, not a ring (design system §7.19).
  const captioned = !titleOnArt && !artOnly;
  const label = [titleText, sub, mark === 'loading' ? 'loading' : mark === 'playing' ? 'playing' : null, progress !== null ? left : null, played ? 'played' : null, downloadLabel(download)].filter(Boolean).join(', ');

  return (
    <Touchable
      // A round tile (people, artists): press, hover and focus show on the circle only, not around the name.
      kind={circle ? 'plain' : 'tile'}
      single
      ring={!circle && !(isTV && captioned)}
      radius={r}
      // TV: the song that plays opens the full player; it does not start again.
      onPress={() => (isTV && mark !== 'none' ? router.navigate('/now-playing') : onPress(item))}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      firstFocus={preferredFocus}
      onFocus={onFocusItem ? () => onFocusItem(item, index) : undefined}
      // The focus left before it rested: the work this tile pushed (keyed by its item) must not run.
      onBlur={onFocusItem ? () => tvFocusRest.drop(item.Id ?? item) : undefined}
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
        {!circle && captioned ? <TileFocusFill artHeight={width / shapeInfo.aspect} radius={r} /> : null}
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
          {MODERN && (mark !== 'none' || (download.state === 'none' && (played || unplayed > 0))) ? (
            <BareMark glyph={mark === 'none' ? (played ? 'checkmark' : null) : mark === 'loading' ? null : 'waveform'} count={mark === 'none' && !played ? unplayed : 0} busy={mark === 'loading'} radius={r} />
          ) : mark !== 'none' ? (
            // One badge per tile: the playing song first, then the download state.
            <View style={s.badge}>
              {mark === 'loading' ? (
                <ActivityIndicator size="small" color={mediaColors.white} style={s.badgeSpinner} />
              ) : (
                <Icon name="waveform" size={iconSize.xs} color={mediaColors.white} weight="bold" />
              )}
            </View>
          ) : download.state !== 'none' ? (
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
          {circle ? <CircleFocus radius={r} pressed={pressed} hovered={hovered} focused={focused} /> : captioned ? <TvArtRing radius={r} /> : null}
        </View>
        {captioned && !circle ? (
          <TileCaption title={titleText} sub={sub} lines={lines} />
        ) : captioned ? (
          <>
            <Text
              style={[
                MODERN ? [s.modernTitle, focused && s.modernLit] : s.title,
                s.center,
                isTV && { marginTop: tvFocusBleed(width) },
                isTV && !focused && !MODERN && s.dim,
                scriptStyle(titleText, s.center),
              ]}
              numberOfLines={lines}>
              {titleText}
            </Text>
            {sub ? (
              <Text style={[MODERN ? [s.modernMeta, focused && s.modernMetaLit] : [s.meta, focused && s.metaFocused], s.center, scriptStyle(sub, s.center)]} numberOfLines={1}>
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
  if (focused && isTV) return { transform: [{ scale: MODERN ? tvm.size.focusScale : tv.focusScale }] };
  if (focused || hovered) return { transform: [{ scale: motion.press.hoverScale }] };
  return undefined;
}

/** The press and hover overlay and the focus ring of a round tile, on the circle only. */
function CircleFocus({ radius: r, pressed, hovered, focused }: { radius: number; pressed: boolean; hovered: boolean; focused: boolean }) {
  const { c } = useTheme();
  const ringW = MODERN ? u(tvm.size.ringWidth) : isTV ? tv.focusRingWidth : 2;
  const gap = MODERN ? u(tvm.size.ringGap) : isTV ? tv.focusRingGap : 2;
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

/**
 * TV Modern: the one mark of a tile (playing, played, unplayed count) with
 * no box (the owner's rule: no boxed badges): a white glyph or number on a
 * soft dark fade from the top-right corner of the art, so it reads on bright
 * art too. The fade reaches zero before the box's left and bottom edges, so
 * it has no hard edge; the corner follows the tile's radius.
 */
function BareMark({ glyph, count, busy, radius: r }: { glyph: 'checkmark' | 'waveform' | null; count: number; busy: boolean; radius: number }) {
  return (
    <View pointerEvents="none" style={[bare.corner, { borderTopRightRadius: r }]}>
      <LinearGradient colors={BARE_FADE} locations={[0, 0.55, 1]} start={{ x: 1, y: 0 }} end={{ x: 0.5, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <View style={bare.slot}>
        {busy ? (
          <ActivityIndicator size="small" color={mediaColors.white} />
        ) : glyph ? (
          <Icon name={glyph} size={BARE_GLYPH} color={mediaColors.white} weight="bold" />
        ) : count > 0 ? (
          <Text style={bare.count}>{count}</Text>
        ) : null}
      </View>
    </View>
  );
}

const BARE_GLYPH = u(30);
const BARE_FADE = [withAlpha(mediaColors.black, 0.6), withAlpha(mediaColors.black, 0.28), withAlpha(mediaColors.black, 0)] as const;
const bare = StyleSheet.create({
  corner: { position: 'absolute', top: 0, right: 0, width: u(132), height: u(132), overflow: 'hidden' },
  slot: { position: 'absolute', top: u(16), right: u(16), minWidth: BARE_GLYPH, height: BARE_GLYPH, alignItems: 'center', justifyContent: 'center' },
  count: { ...tvFont(tvm.type.toolbar, { tabular: true }), fontWeight: '700', color: mediaColors.white },
});

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
  if (MODERN) return art + tvModernCaptionHeight();
  return art + sizes.tileTitleGap + scaled(type.tileTitle.lineHeight) + sizes.tileMetaGap + scaled(type.caption1.lineHeight) + TV_CAPTION_PAD;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
  center: { textAlign: 'center' as const },
  dim: { color: c.text2 },
  metaFocused: { color: c.text },
  modernTitle: { ...tvFont(tvm.type.tileTitle), color: tvm.color.captionRest },
  modernLit: { color: c.text },
  modernMeta: { ...tvFont(tvm.type.tileMeta), color: c.text3, marginTop: u(2) },
  modernMetaLit: { color: c.text2 },
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
  badgeSpinner: { transform: [{ scale: 0.75 }] },
  countBadge: { paddingHorizontal: 6 },
  count: { ...font(type.caption2, { tabular: true }), color: mediaColors.white },
}));
