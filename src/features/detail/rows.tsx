import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import type { BaseItemDto, BaseItemPerson } from '@/api/types';
import { DownloadGlyph, downloadLabel } from '@/components/download-indicator';
import { Icon } from '@/components/icon';
import { SwipeRow } from '@/components/swipe-row';
import { ItemImage } from '@/components/item-image';
import { Touchable } from '@/components/touchable';
import { canDownload, downloads, useDownloadStatus } from '@/downloads';
import { canQueue, queueAccessibilityActions, type QueueSwipe, useQueueSwipe } from '@/features/actions/queue-swipe';
import { episodeLabel, formatClock, formatDuration, playedFraction } from '@/lib/format';
import { TvIconButton } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { savedName } from '@/player/audio/catalog';
import { useSavedId } from '@/player/audio/catalog-links';
import { openFullPlayer } from '@/player';
import { useSongMark } from '@/player/use-song-mark';
import { createStyles,
  type AppTheme,
  font,
  iconSize,
  mediaColors,
  radius,
  scaled,
  scriptStyle,
  sizes,
  spacing,
  tvRowInset,
  tvm,
  type,
  u,
  useLayout,
  useStyles,
  useTheme,
} from '@/theme';

/** TV Modern look (design system §7.22): song rows are `listRowHeight` tall and their More is a bare glyph with the plate, not a circle. */
const MODERN = isTV && isTvModern;

/**
 * A song row (design system §7.10 rows): number or art, title, artist,
 * length. The playing song is in `accent` with a glyph. Select plays; the
 * action sheet opens with a long press. TV has no long press: a More button
 * sits at the end of the row (Right from the row).
 *
 * `queue`: "both" gives the row its own swipe (right: Play next, left: Add to
 * queue); "add" is for a row whose parent swipe deletes on the left and
 * queues on the right. Either way the actions are accessibility actions too.
 */
export const TrackRow = memo(function TrackRow({
  item,
  index,
  showArt,
  onPress,
  onLongPress,
  last,
  trailing,
  note,
  queue,
}: {
  item: BaseItemDto;
  index: number;
  showArt?: boolean;
  /** Added to the artist line, for example the server of a download. */
  note?: string;
  onPress: (item: BaseItemDto) => void;
  /** Opens the item's action sheet (Play next, Add to queue, Instant mix). */
  onLongPress?: (item: BaseItemDto) => void;
  last?: boolean;
  /** A trailing control (a drag handle in an editable playlist). */
  trailing?: ReactNode;
  /** Queue actions of the row (see above). Off on TV. */
  queue?: QueueSwipe;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  // A catalog song and the song the server saved for it count as one (`catalog-links.ts`).
  const mark = useSongMark(item.Id);
  const playing = mark !== 'none';
  const saved = useSavedId(item.Id);
  const name = saved !== item.Id ? savedName(item.Name) : item.Name;
  const artist = [item.Artists?.join(', ') ?? item.AlbumArtist, note].filter(Boolean).join(' · ') || undefined;
  const time = formatClock(item.RunTimeTicks);
  const download = useDownloadStatus(item.Id);
  // TV: the More button is a sibling of the row, so the focus can move to it.
  const tvMore = isTV && !!onLongPress;
  const inset = isTV ? tvRowInset(l.gutter) : null;
  const queueSwipe = useQueueSwipe();
  const queueMode = queue && !isTV && canQueue(item) ? queue : null;
  const a11yActions = [...(onLongPress ? [{ name: 'longpress', label: 'More actions' }] : []), ...(queueMode ? queueAccessibilityActions(queueMode) : [])];
  const row = (
    <Touchable
      kind="row"
      radius={inset ? radius.md : 0}
      containerStyle={[tvMore ? s.flex : null, inset && { marginLeft: inset.marginLeft, marginRight: tvMore ? 0 : inset.marginRight }]}
      // TV: the song that plays opens the full player; it does not start again.
      onPress={() => (isTV && playing ? openFullPlayer() : onPress(item))}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityRole="button"
      accessibilityLabel={[name, artist, time, mark === 'loading' ? 'loading' : playing ? 'playing' : null, downloadLabel(download)].filter(Boolean).join(', ')}
      accessibilityActions={a11yActions.length ? a11yActions : undefined}
      onAccessibilityAction={(e) => {
        if (queueSwipe.runAccessibility(e.nativeEvent.actionName, item)) return;
        if (e.nativeEvent.actionName === 'longpress') onLongPress?.(item);
      }}
      style={({ pressed, hovered, focused }) => [s.track, MODERN && s.trackModern, { paddingLeft: inset ? inset.padX : l.gutter }, (pressed || hovered || (focused && !isTV)) && s.active]}>
      {showArt ? (
        <View>
          <ItemImage item={item} variant="square" width={scaled(sizes.trackArt)} aspectRatio={1} rounded={6} hideArtTitle />
          {playing ? (
            <View style={s.artMark} pointerEvents="none">
              {mark === 'loading' ? (
                <ActivityIndicator size="small" color={mediaColors.white} />
              ) : (
                <Icon name="waveform" size={scaled(iconSize.sm - 2)} color={mediaColors.white} weight="semibold" />
              )}
            </View>
          ) : null}
        </View>
      ) : playing ? (
        <View style={s.trackNoBox}>
          {mark === 'loading' ? (
            <ActivityIndicator size="small" color={c.accent} />
          ) : (
            <Icon name="waveform" size={scaled(iconSize.sm - 2)} color={c.accent} weight="semibold" />
          )}
        </View>
      ) : (
        <Text style={s.trackNo}>{item.IndexNumber ?? index + 1}</Text>
      )}
      <View style={[s.trackBody, { paddingRight: tvMore ? spacing.md : inset ? inset.padX : l.gutter }, !last && s.line]}>
        <View style={s.flex}>
          <Text style={[s.trackTitle, playing && { color: c.accent }, scriptStyle(name, s.trackTitle)]} numberOfLines={1}>
            {name}
          </Text>
          {artist && showArt ? (
            // The download mark sits before the artist, so a downloaded song shows at a glance.
            <View style={s.subRow}>
              <DownloadGlyph id={item.Id} size={12} status={download} />
              <Text style={[s.trackSub, s.flex, scriptStyle(artist, s.trackSub)]} numberOfLines={1}>
                {artist}
              </Text>
            </View>
          ) : null}
        </View>
        {download.state === 'none' && !isTV && canDownload(item) ? (
          <RowDownloadButton item={item} name={name} />
        ) : artist && showArt ? null : (
          <DownloadGlyph id={item.Id} status={download} />
        )}
        {time ? <Text style={s.trackTime}>{time}</Text> : null}
        {trailing}
      </View>
    </Touchable>
  );
  if (queueMode === 'both') {
    return (
      <SwipeRow leading={queueSwipe.playNext(item)} trailing={queueSwipe.addToQueue(item)}>
        {row}
      </SwipeRow>
    );
  }
  if (!tvMore) return row;
  return (
    <View style={[s.tvTrack, { paddingRight: l.gutter }]}>
      {row}
      {MODERN ? (
        <TvIconButton icon="ellipsis" label={`More for ${item.Name ?? 'this song'}`} size={tvm.size.railItem} glyph={tvm.size.actionIcon} onPress={() => onLongPress?.(item)} />
      ) : (
        <Touchable
          kind="icon"
          radius={radius.pill}
          onPress={() => onLongPress?.(item)}
          style={s.more}
          accessibilityRole="button"
          accessibilityLabel={`More for ${item.Name ?? 'this song'}`}>
          <Icon name="ellipsis" size={scaled(iconSize.sm)} color={c.text2} />
        </Touchable>
      )}
    </View>
  );
});

/**
 * Downloads the song without playing it. Shows only while the song is not on the
 * device; once it starts, the download mark (a ring, then the orange arrow) takes over.
 */
function RowDownloadButton({ item, name }: { item: BaseItemDto; name: string | null | undefined }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="icon"
      radius={radius.pill}
      onPress={() => void downloads.download(item)}
      hitSlop={spacing.sm}
      style={s.rowDownload}
      accessibilityRole="button"
      accessibilityLabel={`Download ${name ?? 'this song'}`}>
      <Icon name="arrow.down.circle" size={scaled(iconSize.sm)} color={c.text3} />
    </Touchable>
  );
}

/** An artist row for the Music pager: a circle, the name and the counts. */
export const ArtistRow = memo(function ArtistRow({
  item,
  onPress,
  onLongPress,
  last,
}: {
  item: BaseItemDto;
  onPress: (item: BaseItemDto) => void;
  /** Long press, and right click on the web and the Mac app: the item actions. */
  onLongPress?: (item: BaseItemDto) => void;
  last?: boolean;
}) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const albums = item.AlbumCount ? `${item.AlbumCount} ${item.AlbumCount === 1 ? 'album' : 'albums'}` : null;
  const songs = item.SongCount ? `${item.SongCount} ${item.SongCount === 1 ? 'song' : 'songs'}` : null;
  const meta = [albums, songs].filter(Boolean).join(' · ');
  const inset = isTV ? tvRowInset(l.gutter) : null;
  return (
    <Touchable
      kind="row"
      radius={inset ? radius.md : 0}
      containerStyle={inset ? { marginLeft: inset.marginLeft, marginRight: inset.marginRight } : undefined}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'More actions' }] : undefined}
      onAccessibilityAction={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityRole="button"
      accessibilityLabel={[item.Name, meta].filter(Boolean).join(', ')}
      style={({ pressed, hovered, focused }) => [s.track, { paddingLeft: inset ? inset.padX : l.gutter }, (pressed || hovered || (focused && !isTV)) && s.active]}>
      <ItemImage item={item} variant="square" width={scaled(56)} aspectRatio={1} circle />
      <View style={[s.trackBody, s.artistBody, { paddingRight: inset ? inset.padX : l.gutter }, !last && s.line]}>
        <View style={s.flex}>
          <Text style={[s.trackTitle, scriptStyle(item.Name, s.trackTitle)]} numberOfLines={1}>
            {item.Name}
          </Text>
          {meta ? <Text style={s.trackSub}>{meta}</Text> : null}
        </View>
      </View>
    </Touchable>
  );
});

/** An episode row: still with progress, "S1 · E5 · 42 min", title and two lines of overview. */
export const EpisodeRow = memo(function EpisodeRow({
  item,
  onPress,
  onLongPress,
}: {
  item: BaseItemDto;
  onPress: (item: BaseItemDto) => void;
  /** Long press, and right click on the web and the Mac app: the item actions. */
  onLongPress?: (item: BaseItemDto) => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const progress = playedFraction(item);
  const label = [episodeLabel(item), formatDuration(item.RunTimeTicks)].filter(Boolean).join(' · ');
  const download = useDownloadStatus(item.Id);
  const inset = isTV ? tvRowInset(l.gutter) : null;
  return (
    <Touchable
      kind="row"
      radius={inset ? radius.md : 0}
      containerStyle={inset ? { marginLeft: inset.marginLeft, marginRight: inset.marginRight } : undefined}
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'More actions' }] : undefined}
      onAccessibilityAction={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityRole="button"
      accessibilityLabel={[item.Name, label, item.UserData?.Played ? 'played' : null, downloadLabel(download)].filter(Boolean).join(', ')}
      style={({ pressed, hovered, focused }) => [s.episode, { paddingHorizontal: inset ? inset.padX : l.gutter }, (pressed || hovered || (focused && !isTV)) && s.active]}>
      <View>
        <ItemImage item={item} variant="landscape" width={scaled(sizes.episodeThumb)} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
        {progress !== null ? (
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        {item.UserData?.Played ? (
          <View style={s.badge}>
            <Icon name="checkmark" size={iconSize.xs - 2} color={mediaColors.white} weight="bold" />
          </View>
        ) : null}
      </View>
      <View style={s.flex}>
        <View style={s.epTop}>
          <Text style={[s.epLabel, s.flex]}>{label}</Text>
          <DownloadGlyph id={item.Id} size={14} status={download} />
        </View>
        <Text style={[s.epTitle, scriptStyle(item.Name, s.epTitle)]} numberOfLines={2}>
          {item.Name}
        </Text>
        {item.Overview ? (
          <Text style={[s.epOverview, { color: c.text2 }, scriptStyle(item.Overview, s.epOverview, true)]} numberOfLines={2}>
            {item.Overview}
          </Text>
        ) : null}
      </View>
    </Touchable>
  );
});

/** Cast and crew entries as items, so they use the same tiles and image rules. */
export function personToItem(p: BaseItemPerson): BaseItemDto {
  return {
    Id: p.Id,
    Name: p.Name,
    Type: 'Person',
    ImageTags: p.PrimaryImageTag ? { Primary: p.PrimaryImageTag } : {},
    ImageBlurHashes: p.ImageBlurHashes,
    Overview: p.Role ?? p.Type ?? undefined,
  };
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, minWidth: 0 },
  active: { backgroundColor: c.surface3 },
  tvTrack: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  more: { width: scaled(44), height: scaled(44), borderRadius: radius.pill, alignItems: 'center' as const, justifyContent: 'center' as const },
  track: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, minHeight: scaled(sizes.rowMedia) - 12 },
  trackModern: { minHeight: u(tvm.size.listRowHeight) },
  trackBody: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    alignSelf: 'stretch' as const,
    paddingVertical: spacing.sm + 2,
  },
  artistBody: { minHeight: scaled(sizes.rowMedia) },
  line: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  trackNo: {
    ...font(type.callout, { tabular: true }),
    color: c.text3,
    width: scaled(sizes.trackNumber) - 8,
    textAlign: 'center' as const,
  },
  trackNoBox: { width: scaled(sizes.trackNumber) - 8, alignItems: 'center' as const },
  artMark: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 6,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowDownload: { width: scaled(32), height: scaled(32), alignItems: 'center' as const, justifyContent: 'center' as const },
  subRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, marginTop: 1 },
  trackTitle: { ...font(type.callout), color: c.text },
  trackSub: { ...font(type.footnote), color: c.text2, marginTop: 1 },
  trackTime: { ...font(type.footnote, { tabular: true }), color: c.text3, minWidth: scaled(38), textAlign: 'right' as const },
  episode: { flexDirection: 'row' as const, gap: spacing.md, paddingVertical: spacing.md },
  epTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  epLabel: { ...font(type.caption1, { tabular: true }), color: c.text2 },
  epTitle: { ...font(type.headline), color: c.text, marginTop: sizes.tileMetaGap },
  epOverview: { ...font(type.footnote), marginTop: spacing.xs },
  progressTrack: {
    position: 'absolute' as const,
    left: sizes.badgeInset,
    right: sizes.badgeInset,
    bottom: sizes.badgeInset,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  progressFill: { height: 3, backgroundColor: mediaColors.white },
  badge: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
}));
