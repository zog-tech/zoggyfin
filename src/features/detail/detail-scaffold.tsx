import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { PixelRatio, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useReducedMotion,
  useScrollOffset,
} from 'react-native-reanimated';

import type { BaseItemDto } from '@/api/types';
import { useImageServer } from '@/api/use-api';
import { ItemActionSheet } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { useDownloadArrival } from '@/components/download-indicator';
import { ProgressRing } from '@/components/progress-ring';
import { type DownloadStatus, useDownloadStatus } from '@/downloads';
import { Touchable } from '@/components/touchable';
import { useItemActions } from '@/features/actions/use-item-actions';
import { TogetherSheetHost, usePlayForEveryone, useTogetherEntry } from '@/features/together/together-sheet';
import { buildImageUrl, imageSource } from '@/images/image-url';
import { useTvPageScroll } from '@/features/tv/page-scroll';
import { TvRowScroll } from '@/features/tv/shelf';
import { formatClock, playedFraction } from '@/lib/format';
import { turnedOn } from '@/lib/pop-in';
import { type PopInOptions, usePopIn } from '@/lib/use-pop-in';
import { isTV } from '@/platform/tv';
import type { ItemAction } from '@/registry/item-actions';
import { usePlayer } from '@/player';
import { audioResumeTicks } from '@/player/audio/resume';
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
  tv,
  type,
  useLayout,
  useStyles,
  useTheme,
  withAlpha,
} from '@/theme';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePullRefresh } from '@/lib/use-pull-refresh';

import { fitRoundActions, heroHeight, heroLayout } from './hero-layout';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

export type ArtShape = 'poster' | 'square' | 'circle' | 'thumb';

interface DetailScaffoldProps<Row> {
  item: BaseItemDto;
  /** Facts in the metadata line: year, genre, runtime, rating. */
  meta: (string | null | undefined)[];
  /** A line above the title (series name of an episode), or the album artist. */
  eyebrow?: string | null;
  /** Tap on the eyebrow (album artist opens the artist). */
  onEyebrowPress?: () => void;
  playable?: boolean;
  /** Label for the primary button. Defaults to Play, or "Resume 1:02:14". */
  playLabel?: string;
  /** Album pages: Play and Shuffle as two tonal buttons. */
  onShuffle?: () => void;
  /** Replaces what Play does (a playlist plays its entries). */
  onPlay?: () => void;
  /** More round buttons after Played and Favourite (Instant mix). */
  extraActions?: { icon: IconName; label: string; onPress: () => void }[];
  rows?: Row[];
  renderRow?: (row: Row, index: number) => ReactElement;
  rowKey?: (row: Row, index: number) => string;
  /** Shown between the header and the rows. */
  beforeRows?: ReactNode;
  /** Shown after the rows: cast, similar items. */
  footer?: ReactNode;
  /** May return a promise; the spinner shows until it settles. */
  onRefresh?: () => unknown;
}

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

/**
 * The shared item page (design system §7.6). The hero depends on the item:
 * a tall backdrop, a wide 16:9 image, square album art or a circle. Then the
 * title (the server logo when there is one), the metadata line, the primary
 * action with its resume bar, round secondary actions and the overview. Wide
 * windows put the artwork in a left column (40 %) and the text, Play and the
 * actions in the right column (60 %). TV keeps Play and the actions under the art.
 */
export function DetailScaffold<Row>({
  item,
  meta,
  eyebrow,
  onEyebrowPress,
  playable,
  playLabel,
  onShuffle,
  onPlay,
  extraActions,
  rows,
  renderRow,
  rowKey,
  beforeRows,
  footer,
  onRefresh,
}: DetailScaffoldProps<Row>) {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const { c } = useTheme();
  const l = useLayout();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const player = usePlayer();
  const { actions, run } = useItemActions(item);
  const together = useTogetherEntry(item);
  // In a together session the Play button plays for everyone (or, for a guest, only the host picks).
  const room = usePlayForEveryone();
  const download = useDownloadStatus(item.Id);
  const [sheet, setSheet] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const pull = usePullRefresh(onRefresh);
  const scrollRef = useAnimatedRef<Animated.FlatList<Row>>();
  const offset = useScrollOffset(scrollRef);
  // TV: the page glides to the focused control or row and stops at its end.
  const tvScroll = useTvPageScroll(useCallback(() => scrollRef.current?.getNativeScrollRef(), [scrollRef]));

  const layout = heroLayout(item);
  const media = layout === 'backdrop' || layout === 'wide';
  const twoColumn = l.contentWidth >= 900;
  // The width beside an iPad sidebar or the TV side menu rail.
  const screenW = l.contentWidth;
  const heroH = heroHeight(layout, screenW, l.height, twoColumn);
  const pageWidth = Math.min(screenW, 1280);

  // Favourite and Played show the new state at once. When the request ends, the
  // server's state takes over again: it confirms the change, or reverts it on a failure.
  const [pending, setPending] = useState<{ favorite?: boolean; played?: boolean }>({});
  const serverFavorite = !!item.UserData?.IsFavorite;
  const serverPlayed = !!item.UserData?.Played;
  const favorite = pending.favorite ?? serverFavorite;
  const played = pending.played ?? serverPlayed;
  const favAction = actions.find((a) => a.id === (serverFavorite ? 'builtin.unfavorite' : 'builtin.favorite'));
  const playedAction = actions.find((a) => a.id === (serverPlayed ? 'builtin.unplayed' : 'builtin.played'));
  const toggle = (key: 'favorite' | 'played', next: boolean, action: ItemAction) => {
    // One request at a time: a second press would send the same action again.
    if (pending[key] !== undefined) return;
    setPending((p) => ({ ...p, [key]: next }));
    void Promise.resolve(run(action)).finally(() =>
      setPending((p) => {
        const rest = { ...p };
        delete rest[key];
        return rest;
      }),
    );
  };
  const audioResume = audioResumeTicks(item);
  const position = audioResume ?? item.UserData?.PlaybackPositionTicks ?? 0;
  const resumable = position > 0 && (VIDEO_TYPES.has(item.Type ?? '') || audioResume !== null);
  const progress = resumable ? (audioResume !== null && item.RunTimeTicks ? audioResume / item.RunTimeTicks : playedFraction(item)) : null;
  const primaryLabel = room?.label ?? playLabel ?? (resumable ? `Resume ${formatClock(position) ?? ''}`.trim() : 'Play');

  const facts = meta.filter((m): m is string => !!m);

  // Parallax (§7.6): stretch on pull-down, 0.5× speed on scroll up. Off with Reduce Motion.
  const heroStyle = useAnimatedStyle(() => {
    if (reduced || !media) return {};
    const y = offset.get();
    if (y < 0) {
      return { transform: [{ translateY: y / 2 }, { scale: 1 + -y / Math.max(1, heroH) }] };
    }
    return { transform: [{ translateY: interpolate(y, [0, heroH], [0, heroH / 2], 'clamp') }] };
  });

  // `key`: a stable React key when the label changes (the download shows its percent), so the button stays mounted.
  const secondary: {
    key?: string;
    icon: IconName;
    label: string;
    active?: boolean;
    onPress: () => void;
    ring?: number;
    download?: DownloadStatus['state'];
    tint?: string;
    a11y?: string;
    spare?: boolean;
  }[] = [];
  if (playable && resumable) {
    secondary.push({ icon: 'arrow.counterclockwise', label: 'Start over', onPress: () => player.play({ item, startPositionTicks: 0 }) });
  }
  const dlAction = actions.find((a) => a.id === 'builtin.download' || a.id === 'builtin.downloading' || a.id === 'builtin.removeDownload');
  if (dlAction) {
    if (download.state === 'completed') {
      secondary.push({ key: 'download', download: download.state, icon: 'arrow.down.circle.fill', label: 'Downloaded', tint: c.success, a11y: 'Downloaded. Remove the download', onPress: () => run(dlAction) });
    } else if (download.state === 'none') {
      secondary.push({ key: 'download', download: download.state, icon: 'arrow.down.circle', label: 'Download', onPress: () => run(dlAction) });
    } else if (download.state === 'failed' && download.missing) {
      secondary.push({ key: 'download', download: download.state, icon: 'arrow.down.circle', label: 'Download again', tint: c.danger, a11y: 'The downloaded file is missing. Download it again', onPress: () => run(dlAction) });
    } else if (download.state === 'failed') {
      secondary.push({ key: 'download', download: download.state, icon: 'exclamationmark.triangle', label: 'Failed', tint: c.danger, a11y: 'Download failed. Open Downloads', onPress: () => run(dlAction) });
    } else {
      const pct = Math.round(download.progress * 100);
      secondary.push({
        key: 'download', download: download.state,
        icon: 'arrow.down.circle',
        label: download.state === 'paused' ? 'Paused' : `${pct}%`,
        ring: download.progress,
        a11y: `Downloading ${pct} percent. Open Downloads`,
        onPress: () => run(dlAction),
      });
    }
  }
  // Together sits with the main actions, before the ones that move to More on a narrow window.
  if (together) secondary.push({ icon: 'person.2', label: 'Together', a11y: together.label, onPress: together.open });
  const playlistAction = actions.find((a) => a.id === 'builtin.addToPlaylist');
  if (playlistAction && item.Type !== 'Playlist') secondary.push({ icon: 'text.badge.plus', label: 'Playlist', a11y: 'Add to playlist', spare: true, onPress: () => run(playlistAction) });
  if (playedAction) secondary.push({ icon: 'checkmark', label: 'Played', active: played, spare: true, onPress: () => toggle('played', !played, playedAction) });
  if (favAction) secondary.push({ icon: favorite ? 'heart.fill' : 'heart', label: 'Favourite', active: favorite, spare: true, onPress: () => toggle('favorite', !favorite, favAction) });
  for (const a of extraActions ?? []) secondary.push(a);
  secondary.push({ icon: 'ellipsis', label: 'More', onPress: () => setSheet(true) });

  const centered = !twoColumn;
  // Two columns: Play and the round actions go under the facts in the text column. Under the poster
  // they had only the poster's width, so Played and Favourite left the row on an iPad.
  // TV keeps them under the poster, where the focus starts on Play.
  const actionsUnderPoster = twoColumn && isTV;

  const title = <Title item={item} centered={centered} big={media} />;

  const factsLine = facts.length ? (
    <Text style={[s.meta, centered && s.textCenter]} numberOfLines={2}>
      {facts.join(' · ')}
    </Text>
  ) : null;

  const eyebrowLine = eyebrow ? (
    onEyebrowPress ? (
      <Touchable onPress={onEyebrowPress} radius={6} accessibilityRole="link" accessibilityLabel={eyebrow} containerStyle={centered ? s.selfCenter : undefined}>
        <Text style={[s.eyebrowLink, scriptStyle(eyebrow, s.eyebrowLink, true), centered && s.textCenter]}>{eyebrow}</Text>
      </Touchable>
    ) : (
      <Text style={[s.eyebrow, scriptStyle(eyebrow, s.eyebrow, true), centered && s.textCenter]}>{eyebrow}</Text>
    )
  ) : null;

  const primary = playable ? (
    onShuffle ? (
      <View style={[s.pairRow, l.fontScale >= 1.5 && s.stack]}>
        <Button
          title={room?.label ?? 'Play'}
          icon={room?.locked ? 'lock.fill' : 'play.fill'}
          variant="tonalAccent"
          disabled={room?.locked}
          onPress={onPlay ?? (() => player.play({ item }))}
          containerStyle={s.flex}
          preferredFocus={isTV}
        />
        <Button title="Shuffle" icon="shuffle" variant="tonalAccent" disabled={room?.locked} onPress={onShuffle} containerStyle={s.flex} />
      </View>
    ) : (
      <View>
        <Button
          title={primaryLabel}
          icon={room?.locked ? 'lock.fill' : 'play.fill'}
          disabled={room?.locked}
          onPress={onPlay ?? (() => player.play({ item }))}
          preferredFocus={isTV}
        />
        {progress !== null ? (
          <View style={s.resumeTrack} accessibilityLabel={`${Math.round(progress * 100)} percent played`}>
            <View style={[s.resumeFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
    )
  ) : null;

  // One row: on a narrow window the gap gets smaller, then actions that are also in More leave the row.
  const fitted = fitRoundActions(secondary, rowWidth, scaled(58), [spacing.xl, spacing.sm]);
  const actionsRow = (
    <View style={[s.actions, { gap: fitted.gap }, centered ? s.actionsCenter : null]} onLayout={(e) => setRowWidth(Math.floor(e.nativeEvent.layout.width))}>
      {fitted.items.map(({ spare: _spare, key, ...a }) => (
        <RoundAction key={key ?? a.label} {...a} />
      ))}
    </View>
  );

  // Two-column sizes.
  const leftWidth = Math.round((pageWidth - l.gutter * 2) * 0.4);
  const posterAspect = layout === 'wide' ? 16 / 9 : layout === 'backdrop' ? 2 / 3 : 1;
  // TV: the poster is at most 40% of the screen height, so the focused Play or Resume button shows whole when the page opens.
  const tvPosterMax = isTV ? Math.round(l.height * 0.4 * posterAspect) : Infinity;
  const posterWidth = Math.min(leftWidth, layout === 'square' ? 320 : 260, tvPosterMax);
  const buttonsWidth = isTV ? Math.min(leftWidth, 260) : posterWidth;

  const overview = item.Overview ? <Overview text={item.Overview} centered={false} /> : null;

  const textBlock = (
    <View style={s.textBlock}>
      {layout === 'square' || layout === 'circle' ? null : eyebrowLine}
      {title}
      {layout === 'square' || layout === 'circle' ? eyebrowLine : null}
      {factsLine}
      {actionsUnderPoster ? null : twoColumn && primary ? <View style={[s.primaryColumn, { width: buttonsWidth }]}>{primary}</View> : primary}
      {actionsUnderPoster ? null : actionsRow}
      {overview}
    </View>
  );

  const artWidth = layout === 'square' ? scaled(sizes.albumArt) : scaled(sizes.personArt);
  const art =
    layout === 'square' || layout === 'circle' ? (
      <View style={[s.artWrap, s.raised]}>
        <ItemImage item={item} variant="square" width={artWidth} aspectRatio={1} rounded={radius.lg} circle={layout === 'circle'} />
      </View>
    ) : null;

  let header: ReactElement;
  if (twoColumn) {
    header = (
      <View>
        {media ? <Hero item={item} height={heroH} style={heroStyle} /> : null}
        <View style={[s.columns, { width: pageWidth, paddingHorizontal: l.gutter, marginTop: media ? -heroH * 0.45 : spacing.huge * 2 }]}>
          <View style={[s.left, { width: leftWidth }]}>
            <View style={s.raised}>
              <ItemImage
                item={item}
                variant={layout === 'wide' ? 'landscape' : layout === 'backdrop' ? 'poster' : 'square'}
                width={posterWidth}
                aspectRatio={posterAspect}
                rounded={layout === 'square' ? radius.lg : radius.md}
                circle={layout === 'circle'}
              />
            </View>
            {actionsUnderPoster ? (
              <View style={{ width: buttonsWidth, gap: spacing.lg }}>
                {primary}
                {actionsRow}
              </View>
            ) : null}
          </View>
          <View style={[s.right, { maxWidth: sizes.readableWidth }]}>{textBlock}</View>
        </View>
        {beforeRows ? <View style={[s.page, { width: pageWidth }]}>{beforeRows}</View> : null}
      </View>
    );
  } else if (media) {
    header = (
      <View>
        <Hero item={item} height={heroH} style={heroStyle} />
        <View style={[s.body, { paddingHorizontal: l.gutter, marginTop: layout === 'backdrop' ? -scaled(120) : -scaled(36) }]}>{textBlock}</View>
        {beforeRows}
      </View>
    );
  } else {
    header = (
      <View>
        <View style={[s.body, s.artBody, { paddingHorizontal: l.gutter, paddingTop: l.tv ? spacing.huge : Math.max(100, insets.top + sizes.iconButton + spacing.lg) }]}>
          {art}
          {textBlock}
        </View>
        {beforeRows}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTintColor: media && !twoColumn ? mediaColors.white : c.accent,
          headerRight: () => (
            <Touchable onPress={() => setSheet(true)} radius={20} hitSlop={8} accessibilityRole="button" accessibilityLabel="More actions" style={s.headerButton}>
              <Icon name="ellipsis" size={iconSize.md} color={media && !twoColumn ? mediaColors.white : c.accent} weight="semibold" />
            </Touchable>
          ),
        }}
      />
      <TvRowScroll.Provider value={tvScroll.page}>
      <Animated.FlatList
        ref={scrollRef}
        {...tvScroll.props}
        data={rows ?? []}
        keyExtractor={rowKey ?? ((_, i) => String(i))}
        renderItem={({ item: row, index }) => (
          <View style={[s.page, { width: pageWidth }]}>{renderRow ? renderRow(row, index) : null}</View>
        )}
        ListHeaderComponent={header}
        ListFooterComponent={<View style={[s.page, s.footer, { width: pageWidth, paddingBottom: bottomPad }]}>{footer}</View>}
        contentInsetAdjustmentBehavior="never"
        // On a TV, react-native-tvos wraps a FlatList in a focus guide with no size, so a flex list collapses to 1 dp.
        style={isTV ? [s.tvList, { height: l.height }] : s.list}
        scrollEventThrottle={16}
        refreshControl={
          pull.onRefresh && !isTV ? (
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.text2} />
          ) : undefined
        }
      />
      </TvRowScroll.Provider>
      <ItemActionSheet item={item} visible={sheet} onClose={() => setSheet(false)} />
      <TogetherSheetHost where="item" />
    </>
  );
}

/** The backdrop or wide image, full bleed, fading into the page, with a top scrim for the status bar. */
function Hero({ item, height, style }: { item: BaseItemDto; height: number; style: ReturnType<typeof useAnimatedStyle> }) {
  const { c } = useTheme();
  const l = useLayout();
  const w = l.contentWidth;
  return (
    <View style={[styles.heroClip, { height }]}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <ItemImage item={item} variant="backdrop" width={w} aspectRatio={w / height} rounded={0} hideArtTitle hairline={false} />
      </Animated.View>
      <LinearGradient colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0), c.bg]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[mediaColors.heroTopScrim, 'rgba(0,0,0,0)']} locations={[0, 1]} style={[styles.topScrim, { height: height * 0.22 }]} />
    </View>
  );
}

/**
 * The server logo (max 280 × 100) when there is one, else the title in
 * `display`. The text title shows until the logo has loaded, so a slow or
 * failed logo never leaves an empty space.
 */
function Title({ item, centered, big }: { item: BaseItemDto; centered: boolean; big: boolean }) {
  const s = useStyles(makeStyles);
  const server = useImageServer();
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const logo = item.ImageTags?.Logo
    ? { id: item.Id ?? '', tag: item.ImageTags.Logo }
    : item.ParentLogoItemId && item.ParentLogoImageTag && item.Type !== 'Episode'
      ? { id: item.ParentLogoItemId, tag: item.ParentLogoImageTag }
      : null;
  const name = item.Name ?? '';
  const uri =
    logo && server && big && state !== 'failed'
      ? buildImageUrl(server, { itemId: logo.id, type: 'Logo', tag: logo.tag, width: scaled(sizes.logoMaxWidth) * PixelRatio.get() })
      : null;
  const image = uri ? (
    <Image
      source={imageSource(uri, server)}
      style={s.logo}
      contentFit="contain"
      contentPosition={centered ? 'center' : 'left'}
      onLoad={() => setState('loaded')}
      onError={() => setState('failed')}
    />
  ) : null;
  if (image && state === 'loaded') {
    return (
      <View style={[s.logoBox, centered ? s.selfCenter : null]} accessible accessibilityRole="header" accessibilityLabel={name}>
        {image}
      </View>
    );
  }
  const base = big ? s.display : s.title2;
  return (
    <View>
      <Text style={[base, scriptStyle(name, base, !centered), centered && s.textCenter]} numberOfLines={3} accessibilityRole="header">
        {name}
      </Text>
      {image ? (
        <View style={[s.logoBox, s.logoProbe]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {image}
        </View>
      ) : null}
    </View>
  );
}

/** A toggle that turns on: the icon grows from 0.8 with no overshoot. Feedback, so it is quick and plain. */
const TOGGLE_POP: PopInOptions = { from: 0.8, spring: { duration: 300, dampingRatio: 1 } };

export function RoundAction({
  icon,
  label,
  active,
  onPress,
  ring,
  download,
  tint,
  a11y,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
  /** A progress ring around the button (a running download), 0..1. */
  ring?: number;
  /** The download button's state: its icon arrives when the download completes on this page. */
  download?: DownloadStatus['state'];
  tint?: string;
  a11y?: string;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const size = scaled(sizes.iconButton);
  // Every platform: press, hover and focus show on the circle only, never around circle and label.
  // TV adds the focus scale and a white ring.
  const ringW = isTV ? tv.focusRingWidth : 2;
  const ringGap = isTV ? tv.focusRingGap : 2;
  // The Touchable owns the circle's press scale; the pop moves only the icon.
  const pop = usePopIn(active, turnedOn, TOGGLE_POP);
  // The page shows one item, so the button needs no scope for the arrival.
  const arrival = useDownloadArrival(undefined, download ?? 'none');
  return (
    <Touchable
      kind="plain"
      ring={false}
      onPress={() => {
        // The toggle shows at once (see `toggle`), so the haptic lands with the pop.
        // haptics.light (theme): a small confirmation of the user's own action.
        if (active === false && Platform.OS !== 'web' && !isTV) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      style={[s.roundWrap, isTV && s.roundWrapTV]}>
      {({ pressed, hovered, focused }) => (
        <>
          <View
            style={[
              s.round,
              { backgroundColor: pressed || hovered ? c.surface3 : c.surface2 },
              focused && isTV && s.roundFocusTV,
            ]}>
            {/* Two views: each animation owns its own scale. */}
            <Animated.View style={arrival}>
              <Animated.View style={pop}>
                <Icon name={icon} size={scaled(iconSize.sm)} color={tint ?? (active ? c.accent : c.text)} weight="semibold" />
              </Animated.View>
            </Animated.View>
            {ring !== undefined ? (
              <View style={StyleSheet.absoluteFill}>
                <ProgressRing size={size} width={3} progress={ring} color={c.accent} track="transparent" />
              </View>
            ) : null}
            {focused ? (
              <View
                pointerEvents="none"
                style={[
                  s.roundRing,
                  {
                    top: -(ringGap + ringW),
                    left: -(ringGap + ringW),
                    right: -(ringGap + ringW),
                    bottom: -(ringGap + ringW),
                    borderWidth: ringW,
                    borderColor: isTV ? mediaColors.white : c.focusRing,
                  },
                ]}
              />
            ) : null}
          </View>
          <Text style={[s.roundLabel, focused && s.roundLabelFocused]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Touchable>
  );
}

/** Overview: 3 lines and a "More" link in `accent` that expands in place. */
export function Overview({ text, centered }: { text: string; centered: boolean }) {
  const s = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  return (
    <Touchable
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={open ? 'Shows less' : 'Shows the full text'}
      radius={6}>
      <Text
        style={[s.overview, scriptStyle(text, s.overview, true), centered && s.textCenter]}
        numberOfLines={open ? undefined : 3}
        onTextLayout={(e) => {
          if (!open && e.nativeEvent.lines.length >= 3) setLong(true);
        }}>
        {text}
      </Text>
      {long ? <Text style={s.more}>{open ? 'Less' : 'More'}</Text> : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  heroClip: { overflow: 'hidden' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  flex: { flex: 1 },
  list: { flex: 1, backgroundColor: c.bg },
  tvList: { backgroundColor: c.bg },
  page: { alignSelf: 'center' as const },
  body: { gap: spacing.lg },
  artBody: { alignItems: 'center' as const },
  columns: { alignSelf: 'center' as const, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.xxxl },
  left: { alignItems: 'center' as const, gap: spacing.xl },
  right: { flex: 1, paddingTop: spacing.huge * 2 },
  raised: { ...shadow('raised'), borderRadius: radius.lg },
  artWrap: { marginBottom: spacing.sm },
  textBlock: { gap: spacing.md, width: '100%' as const },
  // The Play button in the text column keeps the poster's width, not the column's.
  primaryColumn: { maxWidth: '100%' as const },
  textCenter: { textAlign: 'center' as const },
  selfCenter: { alignSelf: 'center' as const },
  eyebrow: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text2 },
  eyebrowLink: { ...font(type.title3), fontWeight: '400' as const, color: c.accent },
  display: { ...font(type.display), color: c.text },
  title2: { ...font(type.title2), color: c.text },
  logoBox: { width: scaled(sizes.logoMaxWidth), height: scaled(sizes.logoMaxHeight) },
  logo: { width: '100%' as const, height: '100%' as const },
  logoProbe: { position: 'absolute' as const, top: 0, left: 0, opacity: 0 },
  meta: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  pairRow: { flexDirection: 'row' as const, gap: spacing.md, marginTop: spacing.sm },
  stack: { flexDirection: 'column' as const },
  resumeTrack: { height: sizes.resumeBar, borderRadius: 2, backgroundColor: c.surface3, marginTop: spacing.md, marginHorizontal: spacing.xxxl, overflow: 'hidden' as const },
  resumeFill: { height: '100%' as const, backgroundColor: c.accent },
  actions: { flexDirection: 'row' as const, alignSelf: 'stretch' as const, gap: spacing.xl, marginTop: spacing.xs },
  actionsCenter: { justifyContent: 'center' as const },
  roundWrap: { alignItems: 'center' as const, gap: 6, minWidth: scaled(56) },
  round: {
    width: scaled(sizes.iconButton),
    height: scaled(sizes.iconButton),
    borderRadius: radius.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  roundLabel: { ...font(type.caption2), color: c.text2 },
  roundLabelFocused: { color: c.text },
  // TV: room under the circle for the focus scale and ring, so the label stays clear.
  roundWrapTV: { gap: 14 },
  roundRing: { position: 'absolute' as const, borderRadius: radius.pill },
  roundFocusTV: { transform: [{ scale: tv.focusScale }] },
  overview: { ...font(type.subheadline), color: c.text2 },
  more: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent, marginTop: 2 },
  footer: { paddingBottom: spacing.huge * 2 },
  headerButton: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
}));
