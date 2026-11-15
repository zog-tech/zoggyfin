/**
 * TV Home billboard: the focused item, large, at the top of the screen (like
 * the streaming apps on TV). Tiles in the Home rows report their focus here
 * only once the focus has rested on them (`FOCUS_REST_MS`, focus-settle), so
 * a fast move along a row writes nothing, re-renders nothing and loads no
 * item or backdrop. The art keeps its 16:9 shape from the top: its
 * lower part runs on under the first row and fades into the page, so the
 * billboard's short box never crops the top of a backdrop.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { type ComponentRef, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { create } from 'zustand';

import { useItem, useNextUp, useResume } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { useImageServer } from '@/api/use-api';
import { useSessionStore } from '@/auth/session-store';
import { ItemImage } from '@/components/item-image';
import { buildImageUrl, imageSource } from '@/images/image-url';
import { resolveImage } from '@/images/resolve-image';
import { episodeLabel, formatDuration, playedFraction } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { usePlayerStore } from '@/player/store';
import { usePlaybackSettings } from '@/settings/playback';
import {
  type AppTheme,
  createStyles,
  font,
  motion,
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

import { noteHomeMove, setPreviewPause, useTvChrome } from './chrome-store';
import { tvFocusRest } from './focus-settle';
import { PREVIEW_DELAY_MS, PREVIEW_LENGTH_MS, previewStart, previewUrl } from './preview';
import { TvRowScroll, useRowFade } from './shelf';
import { TvButton } from './tv-button';

interface BillboardState {
  item: BaseItemDto | null;
}

const useBillboardStore = create<BillboardState>(() => ({ item: null }));

// Another account (or none): a focus task still waiting belongs to the old account's
// screens and API, and the billboard item to its library. Drop both.
useSessionStore.subscribe((now, before) => {
  if (now.session === before.session) return;
  tvFocusRest.cancel();
  useBillboardStore.setState({ item: null });
});

/**
 * The focus rests on a Home tile: show its item on the billboard. Call it
 * from the focus settle (features/tv/focus-settle), never on each focus.
 */
export function showOnBillboard(item: BaseItemDto): void {
  if (useBillboardStore.getState().item?.Id !== item.Id) useBillboardStore.setState({ item });
}

/** The billboard height for a window height. */
export function billboardHeight(windowHeight: number): number {
  return Math.round(windowHeight * tv.billboardFactor);
}

/** The metadata line: year, rating, length, genres (an episode: its number and name). */
function metaLine(item: BaseItemDto): string {
  if (item.Type === 'Episode') return [episodeLabel(item), item.Name].filter(Boolean).join(' · ');
  const parts = [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.Type === 'Series' ? null : formatDuration(item.RunTimeTicks),
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null,
    item.Genres?.slice(0, 3).join(', ') || null,
  ];
  // Each fact in its own text direction: an Arabic genre must not reorder the others.
  return parts
    .filter(Boolean)
    .map((p) => `\u2068${p}\u2069`)
    .join('  ·  ');
}

export function Billboard() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const focused = useBillboardStore((st) => st.item);
  // Before any tile has the focus: the first item to continue.
  const first = useHeroItem();
  // The store changes only after the focus rests (the tiles settle), so no pause here.
  const shown = focused ?? first;
  // The tiles carry no overview: the full item fills it in.
  const full = useItem(shown?.Id ?? undefined);
  const item = full.data?.Id === shown?.Id ? (full.data ?? shown) : shown;
  const height = billboardHeight(l.height);
  const width = l.contentWidth;
  const artW = Math.round(width * 0.72);
  const artH = Math.round((artW * 9) / 16);
  const server = useImageServer();
  // One backdrop at the size it shows (capped), so a focus move loads a small image.
  const scale = Math.min(PixelRatio.get(), 1.5);
  const art = item ? resolveImage(item, 'backdrop', { width: Math.round(artW * scale), height: Math.round(artH * scale) }, server) : null;
  // A movie or show with no wide art falls back to its tall poster: show all of it at the edge, not a slice.
  const tall = art?.kind === 'remote' && item?.Type !== 'Episode' && (art.source === 'Primary' || art.source === 'SeriesPrimary');

  // A new item: its text fades in (from the first render with it; the effect runs before the paint settles).
  const shownId = item?.Id ?? null;
  useLayoutEffect(() => {
    if (reduced || !shownId) return;
    opacity.set(0);
    opacity.set(withTiming(1, { duration: motion.duration.base }));
  }, [shownId, reduced, opacity]);

  if (!item) return <View style={{ height }} />;
  const title = (item.Type === 'Episode' ? item.SeriesName : null) ?? item.Name ?? '';
  const meta = metaLine(item);
  const rated = item.Type === 'Episode' ? null : (item.OfficialRating ?? null);
  return (
    <View style={[s.root, { height }]} accessibilityLiveRegion="polite">
      {/* No key: the old backdrop stays until the new one has loaded, then cross-fades. */}
      <View style={[s.art, { width: artW, height: artH }]}>
        {art?.kind === 'remote' ? (
          <Image
            source={imageSource(art.uri, server)}
            style={StyleSheet.absoluteFill}
            contentFit={tall ? 'contain' : 'cover'}
            contentPosition={tall ? 'right top' : 'top'}
            transition={motion.duration.base}
            cachePolicy="memory-disk"
            priority="high"
          />
        ) : (
          <ItemImage item={item} variant="backdrop" width={artW} aspectRatio={16 / 9} rounded={0} hideArtTitle hairline={false} />
        )}
        {/* After a rest, a clip of the title fades in over the art (under the fades, like the art). */}
        <BillboardPreview item={item} />
      </View>
      {/*
        The art fades into the page on the left and at the bottom. Each fade covers only the strip of
        the art it fades: a TV GPU fills few pixels a second, and full-screen fades cost frames.
      */}
      <LinearGradient
        colors={[c.bg, withAlpha(c.bg, 0.85), withAlpha(c.bg, 0)]}
        locations={[0, 0.36, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[s.fade, { left: width - artW, width: Math.round(artW * 0.65), height: artH }]}
        pointerEvents="none"
      />
      {/* The billboard ends at about 60% of the art: the rest fades out under the first row. */}
      <LinearGradient
        colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0.6), c.bg]}
        locations={[0, 0.35, 0.86]}
        style={[s.fade, { top: Math.round(artH * 0.42), right: 0, width: artW, height: artH - Math.round(artH * 0.42) }]}
        pointerEvents="none"
      />
      {/*
        The new text fades in on a view that stays mounted (an opacity on the UI thread). Reanimated
        layout animations (entering and exiting) cost about 8 ms of UI-thread work on every frame of
        the fade on a TV stick. The overview keeps its two lines while the full item loads, so the
        title and the facts never jump up.
      */}
      <Animated.View style={[s.text, { left: l.gutter, width: width * 0.46, bottom: spacing.xl }, fade]}>
        <Title item={item} title={title} />
        {meta || rated ? (
          <View style={s.facts}>
            {rated ? (
              <View style={s.rated}>
                <Text style={s.ratedText}>{rated}</Text>
              </View>
            ) : null}
            {meta ? (
              <Text style={s.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={[s.overview, item.Overview ? scriptStyle(item.Overview, s.overview, true) : null, { minHeight: (s.overview.lineHeight ?? 0) * 2 }]} numberOfLines={2}>
          {item.Overview ?? ''}
        </Text>
      </Animated.View>
    </View>
  );
}

/** The server logo when there is one, else the title as text. */
function Title({ item, title }: { item: BaseItemDto; title: string }) {
  const s = useStyles(makeStyles);
  const server = useImageServer();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = item.ImageTags?.Logo
    ? { id: item.Id ?? '', tag: item.ImageTags.Logo }
    : item.ParentLogoItemId && item.ParentLogoImageTag
      ? { id: item.ParentLogoItemId, tag: item.ParentLogoImageTag }
      : null;
  const uri =
    logo && server
      ? buildImageUrl(server, { itemId: logo.id, type: 'Logo', tag: logo.tag, width: scaled(sizes.logoMaxWidth) * PixelRatio.get() })
      : null;
  if (uri && failed !== uri) {
    return (
      <View style={s.logoBox} accessible accessibilityRole="header" accessibilityLabel={title}>
        <Image source={imageSource(uri, server)} style={s.logo} contentFit="contain" contentPosition="left" onError={() => setFailed(uri)} />
      </View>
    );
  }
  return (
    <Text style={[s.title, scriptStyle(title, s.title, true)]} numberOfLines={2} accessibilityRole="header">
      {title}
    </Text>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  // Visible: the art runs on below the billboard, under the rows (the Home ScrollView draws over it).
  root: { overflow: 'visible' as const },
  art: { position: 'absolute' as const, top: 0, right: 0 },
  fade: { position: 'absolute' as const, top: 0 },
  text: { position: 'absolute' as const, gap: spacing.xs },
  title: { ...font(type.title1), color: c.text },
  logoBox: { width: scaled(sizes.logoMaxWidth), height: scaled(sizes.logoMaxHeight * 0.8) },
  logo: { width: '100%' as const, height: '100%' as const },
  facts: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  meta: { ...font(type.headline, { tabular: true }), color: c.text, flexShrink: 1 },
  rated: { borderWidth: 1, borderColor: c.text2, borderRadius: radius.xs, paddingHorizontal: spacing.xs },
  ratedText: { ...font(type.caption1), color: c.text },
  overview: { ...font(type.callout), color: c.text2 },
}));

/** The title Home features before a row has the focus: the first to continue, else the next episode. */
export function useHeroItem(): BaseItemDto | null {
  const resume = useResume('Video').data?.[0];
  const next = useNextUp().data?.[0];
  return resume ?? next ?? null;
}

/**
 * Home's first row on TV, like the streaming apps: Play (or Resume) and More info for the
 * featured title, right under the billboard. Play has the first focus, so Select plays at once;
 * Down goes into the rows and Up comes back here, and the billboard shows the featured title
 * again. The row fades out as it scrolls up, like the rows of tiles (useRowFade).
 */
export function HomeHero() {
  const l = useLayout();
  const item = useHeroItem();
  const player = usePlayer();
  const open = useOpenItem();
  const page = useContext(TvRowScroll);
  const row = useRef<ComponentRef<typeof View> | null>(null);
  const fade = useRowFade(Math.round(l.height * 0.14));
  useEffect(() => page?.track(row, fade.top), [page, fade.top]);
  if (!item) return null;
  const resumed = (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
  const ep = item.Type === 'Episode' ? episodeLabel(item) : null;
  const label = [resumed ? 'Resume' : 'Play', ep].filter(Boolean).join(' ');
  const onFocus = () => {
    noteHomeMove();
    // The featured title at once (no rest): a tile's pending billboard change must not follow.
    tvFocusRest.cancel();
    useBillboardStore.setState({ item });
    page?.scrollTo(row.current);
  };
  return (
    <Animated.View ref={row} style={[{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: l.gutter, paddingTop: spacing.sm }, fade.style]}>
      <TvButton label={label} icon="play.fill" progress={resumed ? playedFraction(item) : null} firstFocus onFocus={onFocus} onPress={() => void player.play({ item })} />
      <TvButton label="More info" icon="info.circle" onFocus={onFocus} onPress={() => open(item)} />
    </Animated.View>
  );
}

/**
 * The preview on the billboard: when the billboard has shown a title for PREVIEW_DELAY_MS (the
 * focus rested), a clip of it plays over the art (preview.ts). Only on the visible Home, with the
 * app in front, nothing else playing and the setting on. A focus move ends it at once.
 */
function BillboardPreview({ item }: { item: BaseItemDto }) {
  const enabled = usePlaybackSettings((st) => st.previews);
  // Not while music or a video plays (a paused queue restored at start does not count).
  const busy = usePlayerStore((st) => !!st.now && st.playing);
  // The side menu is open: the user is on the way somewhere else.
  const menuOpen = useTvChrome((st) => st.menuOpen);
  const [visible, setVisible] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setVisible(true);
      return () => setVisible(false);
    }, []),
  );
  const [front, setFront] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setFront(st === 'active'));
    return () => sub.remove();
  }, []);
  const start = previewStart(item);
  const id = item.Id ?? null;
  const allowed = enabled && !busy && !menuOpen && visible && front && start !== null && !!id;
  // The preview of `id`, armed after a rest. A move pauses it at once (noteHomeMove) and starts
  // the rest again; the moves are followed outside React, so a move renders nothing here.
  const [armed, setArmed] = useState<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!allowed || !id) return;
    const arm = () => setTimeout(() => setArmed({ id, at: Date.now() }), PREVIEW_DELAY_MS);
    let t = arm();
    const off = useTvChrome.subscribe((st, prev) => {
      if (st.moves === prev.moves) return;
      clearTimeout(t);
      t = arm();
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [allowed, id]);
  if (!allowed || !armed || armed.id !== id || start === null || !id) return null;
  return <PreviewVideo key={`${id}:${armed.at}`} itemId={id} start={start} />;
}

function PreviewVideo({ itemId, start }: { itemId: string; start: number }) {
  const server = useImageServer();
  const uri = server?.token ? previewUrl({ baseUrl: server.baseUrl, itemId, token: server.token }) : null;
  const player = useVideoPlayer(uri ? { uri } : null, (p) => {
    // A preview is no "now playing" for the system (lock screen, media buttons stay with the app's player).
    p.showNowPlayingNotification = false;
    p.volume = 0.8;
    p.currentTime = start;
    p.play();
  });
  const opacity = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  // The clip fades in when it plays (the first-frame event alone did not come on Android TV).
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying && !paused.current) opacity.set(withTiming(1, { duration: 500 }));
  });
  // A focus move pauses and hides it at once (noteHomeMove); it stays mounted until the next rest.
  const paused = useRef(false);
  useEffect(() => {
    setPreviewPause(() => {
      paused.current = true;
      player.pause();
      opacity.set(withTiming(0, { duration: 150 }));
    });
    return () => setPreviewPause(null);
  }, [player, opacity]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      opacity.set(withTiming(0, { duration: 600 }));
      setTimeout(() => setDone(true), 650);
    }, PREVIEW_LENGTH_MS);
    return () => clearTimeout(t);
  }, [opacity]);
  if (done || !uri) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        // A TextureView, so the clip can fade in over the art (a SurfaceView ignores the opacity).
        surfaceType="textureView"
        onFirstFrameRender={() => {
          if (!paused.current) opacity.set(withTiming(1, { duration: 500 }));
        }}
      />
    </Animated.View>
  );
}

/** True inside the TV Home rows: their tiles show only art and report focus to the billboard. */
export const BillboardRows = createContext(false);
