import * as Haptics from 'expo-haptics';
import { type Href, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { Icon, type IconName } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { ToastHost } from '@/components/toast-host';
import { Touchable } from '@/components/touchable';
import { useSessionStore } from '@/auth/session-store';
import { canDownload, downloads, findDownload } from '@/downloads';
import { TogetherPill } from '@/features/together/together-pill';
import { TogetherSheetHost } from '@/features/together/together-sheet';
import { useTvRemote } from '@/features/tv/use-tv-remote';
import { openAddToPlaylist } from '@/features/playlists/add-to-playlist';
import { useHideDevToolsButton } from '@/lib/dev-tools';
import { itemHref } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { useWindowFrame } from '@/lib/use-window-frame';
import { KeyInput } from '@/native/key-input';
import type { KeyPress } from '@/native/key-input-types';
import { artistLine } from '@/player/audio/item';
import { currentEntry, queueSections } from '@/player/audio/queue';
import { audioSession } from '@/player/audio/session';
import { formatRemaining, SLEEP_MINUTES, sleepAtEnd, sleepFor, sleepOff, sleepRemaining } from '@/player/audio/sleep-timer';
import { useAudioStore } from '@/player/audio/store';
import { useShowsPause } from '@/player/control-gate';
import { playerState, setPlayerState, usePlayerStore } from '@/player/store';
import { chapterAt, formatTime } from '@/player/timeline';
import { features } from '@/platform/tv';
import { tvKeyFromEvent } from '@/player/tv-keys';
import { font, scriptStyle, type } from '@/theme';
import { nearbySupported } from '@/together/nearby';
import { openTogetherSheet } from '@/together/store';
import { syncPlaySupported } from '@/together/syncplay';
import { tabGroupNow } from '@/features/extensions/tab-nav';

import { AirPlayButton } from '../player/airplay-button';
import { Glass } from '../player/glass';
import { PlayerSheet, type SheetSection } from '../player/player-sheet';
import { RoundButton } from '../player/round-button';
import { Scrubber } from '../player/scrubber';
import { useTvScrub } from '../player/use-tv-scrub';
import { c, ease, iconSize, motion, radius, spacing } from '../player/tokens';
import { ArtBackground } from './art-background';
import { bottomPad, nowPlayingSizes } from './layout';
import { LyricsPanel } from './lyrics-panel';
import { QueuePanel } from './queue-panel';
import { VolumeSlider } from './volume-slider';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

type Panel = 'none' | 'queue' | 'lyrics';
type SheetKind = 'speed' | 'sleep' | 'chapters' | 'more' | null;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function minimize() {
  if (playerState().now) setPlayerState({ presentation: 'mini' });
  audioSession().refreshLists();
  leave();
}

function haptic() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** A clock that ticks once a second while `on`, for the sleep timer countdown. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [on]);
  return now;
}

/**
 * The full music player (design system §7.9), always dark: blurred-art
 * background, artwork that shrinks while paused, scrubber, transport,
 * volume, AirPlay, queue and lyrics. Long-form audio (recitations,
 * audiobooks, lectures) gets ±15/30 s skips, speed, a sleep timer and
 * chapters. Wide windows show the queue or lyrics beside the player; a
 * phone on its side shows the art beside the controls (`layout.ts`).
 */
export function NowPlayingScreen() {
  const now = usePlayerStore((s) => s.now);
  const playing = usePlayerStore((s) => s.playing);
  const showsPause = useShowsPause();
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const status = usePlayerStore((s) => s.status);
  const error = usePlayerStore((s) => s.error);
  const rate = usePlayerStore((s) => s.rate);
  const longForm = useAudioStore((s) => s.longForm);
  const sleep = useAudioStore((s) => s.sleep);
  const resumedAt = useAudioStore((s) => s.resumedAt);
  const lyricsState = useAudioStore((s) => s.lyrics);
  const format = useAudioStore((s) => s.format);
  const queue = useAudioStore((s) => s.queue);
  const insets = useSafeAreaInsets();
  // The size comes with the insets, so a rotation renders the new layout once (use-window-frame.ts).
  const { width, height } = useWindowFrame();
  const reduced = useReducedMotion();
  const { api, userId } = useApi();
  const signedIn = useSessionStore((st) => !!st.session);
  const s = audioSession();

  useHideDevToolsButton();
  const { mode, wide, columnWidth, contentWidth, artSize, pad, gap } = nowPlayingSizes({
    width,
    height,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    insetLeft: insets.left,
    insetRight: insets.right,
    longForm,
  });
  const landscape = mode === 'landscape';
  const [panel, setPanel] = useState<Panel>(wide ? 'queue' : 'none');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [favourite, setFavourite] = useState<{ id: string; on: boolean } | null>(null);
  const clock = useNow(sleep.kind === 'minutes');
  const [captionClock, setCaptionClock] = useState(() => Date.now());

  useEffect(() => {
    setPlayerState({ presentation: 'full' });
    return () => {
      if (playerState().presentation === 'full') setPlayerState({ presentation: playerState().now ? 'mini' : 'hidden' });
    };
  }, []);

  // "Resumes where you left off" shows for 4 s after a resume.
  useEffect(() => {
    if (!resumedAt) return;
    const first = setTimeout(() => setCaptionClock(Date.now()), 0);
    const t = setTimeout(() => setCaptionClock(Date.now()), 4100);
    return () => {
      clearTimeout(first);
      clearTimeout(t);
    };
  }, [resumedAt]);

  // Playback stopped (Close in the mini player, or the queue was cleared away): leave.
  useEffect(() => {
    if (!now && status === 'idle') leave();
  }, [now, status]);

  const lyrics = lyricsState?.status === 'ready' && lyricsState.itemId === now?.item.Id ? lyricsState.lyrics : null;
  const effectivePanel: Panel = panel === 'lyrics' && !lyrics ? (wide ? 'queue' : 'none') : panel;

  // Artwork: full width on a phone, smaller when the window is short; 0.88 while paused.
  const artScale = useSharedValue(1);
  useEffect(() => {
    const to = playing || status === 'loading' ? 1 : 0.88;
    artScale.set(reduced ? to : withSpring(to, motion.spring.smooth));
  }, [playing, status, reduced, artScale]);
  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: artScale.get() }] }));

  // Swipe down on the artwork area to minimize; the screen follows the finger.
  const dragY = useSharedValue(0);
  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }],
    opacity: reduced ? 1 - Math.min(0.6, dragY.get() / Math.max(1, height)) : 1,
  }));
  const dismiss = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(20)
        .failOffsetY(-20)
        .failOffsetX([-24, 24])
        .onUpdate((e) => dragY.set(Math.max(0, e.translationY)))
        .onEnd((e) => {
          if (e.translationY > 140 || e.velocityY > 900) {
            dragY.set(withTiming(height, { duration: motion.duration.base, easing: ease.exit }));
            scheduleOnRN(minimize);
          } else {
            dragY.set(withSpring(0, { ...motion.spring.sheet, velocity: e.velocityY }));
          }
        }),
    [dragY, height],
  );

  // TV: Left and Right on the focused seek bar seek (a held key repeats); Select seeks at once.
  const [barFocused, setBarFocused] = useState(false);
  const scrub = useTvScrub(
    () => ({ position: playerState().position, duration: playerState().duration }),
    (t) => audioSession().seekTo(t),
  );
  useTvRemote(!sheet, (e) => {
    const ev = tvKeyFromEvent(e);
    if (!ev || !barFocused || (ev.key !== 'left' && ev.key !== 'right')) return;
    const dir = ev.key === 'left' ? -1 : 1;
    if (ev.phase === 'press') scrub.press(dir);
    else scrub.hold(dir, ev.phase === 'holdStart');
  });

  const item = now?.item;
  const isFav = item ? (favourite && favourite.id === item.Id ? favourite.on : !!item.UserData?.IsFavorite) : false;
  // The React Compiler memoizes this; no useCallback.
  const toggleFavourite = async () => {
    if (!item?.Id) return;
    const on = !isFav;
    setFavourite({ id: item.Id, on });
    haptic();
    try {
      await jf.setFavorite(api, userId, item.Id, on);
    } catch (e) {
      setFavourite({ id: item.Id, on: !on });
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  };

  if (!now || !item) return <View style={styles.root} />;

  const artist = artistLine(item);
  // Tracks without tags still say where they come from (the album or the mix).
  const from = item.Album ?? queue.source?.name ?? null;
  const chapter = chapterAt(now.chapters, position);
  const back = longForm ? 15 : 10;
  const fwd = longForm ? 30 : 10;
  const sections = queueSections(queue);
  const upcoming = sections.upNext.length + sections.rest.length;
  const resumedCaption = resumedAt && captionClock - resumedAt < 4000 ? 'Resumes where you left off' : null;
  const caption = resumedCaption ?? (longForm && chapter?.name ? chapter.name : format);
  const sleepLeft = sleepRemaining(sleep, clock);

  const go = (target: BaseItemDto) => {
    // The Music stack, or Library when an extension tab takes the place of Music on this phone.
    const href = itemHref(tabGroupNow('(music)'), target);
    minimize();
    if (href) setTimeout(() => router.push(href as Href), 50);
  };

  const onKey = (k: KeyPress) => {
    const inQueue = effectivePanel === 'queue';
    const rows = [...sections.upNext, ...sections.rest];
    const sel = rows.findIndex((r) => r.entry.key === selected);
    switch (k.key) {
      case ' ':
      case 'k':
        s.togglePlay();
        break;
      case 'ArrowLeft':
        if (k.shift) s.previous();
        else s.skip(-back);
        break;
      case 'ArrowRight':
        if (k.shift) s.next();
        else s.skip(fwd);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!inQueue || !rows.length) break;
        const dir = k.key === 'ArrowUp' ? -1 : 1;
        if (k.alt && sel >= 0) {
          const target = rows[sel + dir];
          const row = rows[sel];
          if (target && row) s.move(row.index, target.index);
        } else {
          const next = rows[Math.min(rows.length - 1, Math.max(0, sel + dir))];
          setSelected(next?.entry.key ?? null);
        }
        break;
      }
      case 'Enter':
        if (inQueue && selected) s.jump(selected);
        break;
      case 'Backspace':
      case 'Delete':
        if (inQueue && selected) {
          const next = rows[sel + 1] ?? rows[sel - 1];
          s.remove(selected);
          setSelected(next?.entry.key ?? null);
        }
        break;
      case 'q':
        setPanel((p) => (p === 'queue' ? (wide ? 'queue' : 'none') : 'queue'));
        break;
      case 'l':
        if (lyrics) setPanel((p) => (p === 'lyrics' ? (wide ? 'queue' : 'none') : 'lyrics'));
        break;
      case 'Escape':
        if (sheet) setSheet(null);
        else if (!wide && panel !== 'none') setPanel('none');
        else minimize();
        break;
    }
  };

  const togglePanel = (p: Panel) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setPanel((cur) => (cur === p ? (wide ? (p === 'queue' ? 'queue' : 'queue') : 'none') : p));
  };

  const title = (
    <View style={[styles.titleRow, landscape && styles.titleRowLandscape]}>
      <View style={styles.flex}>
        <Text style={[styles.title, scriptStyle(item.Name, styles.title, true)]} numberOfLines={landscape ? 1 : 2} accessibilityRole="header">
          {item.Name}
        </Text>
        {artist ? (
          <Touchable
            radius={radius.sm}
            disabled={!item.ArtistItems?.[0]?.Id && !item.AlbumArtists?.[0]?.Id}
            onPress={() => {
              const a = item.ArtistItems?.[0] ?? item.AlbumArtists?.[0];
              if (a?.Id) go({ Id: a.Id, Name: a.Name, Type: 'MusicArtist' });
            }}
            accessibilityRole="link"
            accessibilityLabel={`Artist: ${artist}`}>
            <Text style={[styles.artist, scriptStyle(artist, styles.artist, true)]} numberOfLines={1}>
              {artist}
            </Text>
          </Touchable>
        ) : from ? (
          <Text style={[styles.artist, scriptStyle(from, styles.artist, true)]} numberOfLines={1}>
            {from}
          </Text>
        ) : null}
      </View>
      <RoundButton icon={isFav ? 'heart.fill' : 'heart'} label={isFav ? 'Remove from favourites' : 'Add to favourites'} size={36} glyph={18} onPress={() => void toggleFavourite()} />
      <RoundButton icon="ellipsis" label="More" size={36} glyph={18} onPress={() => setSheet('more')} />
    </View>
  );

  const compactTitle = (
    <View style={styles.compactRow}>
      <ItemImage item={item} variant="square" width={56} aspectRatio={1} rounded={radius.sm} hideArtTitle />
      <View style={styles.flex}>
        <Text style={[styles.compactTitle, scriptStyle(item.Name, styles.compactTitle)]} numberOfLines={1}>
          {item.Name}
        </Text>
        {artist ?? from ? (
          <Text style={[styles.compactSub, scriptStyle(artist ?? from, styles.compactSub)]} numberOfLines={1}>
            {artist ?? from}
          </Text>
        ) : null}
      </View>
      <RoundButton icon={isFav ? 'heart.fill' : 'heart'} label={isFav ? 'Remove from favourites' : 'Add to favourites'} size={36} glyph={18} onPress={() => void toggleFavourite()} />
    </View>
  );

  const scrubber = (
    <View>
      <Scrubber
        position={position}
        duration={duration}
        buffered={duration}
        playing={playing}
        chapters={now.chapters}
        trickplay={null}
        server={null}
        itemId={item.Id ?? ''}
        mediaSourceId={now.plan.mediaSourceId}
        gutter={spacing.xl}
        onSeek={(t) => s.seekTo(t)}
        onScrubbing={() => undefined}
        tvTarget={scrub.target}
        onTvFocus={setBarFocused}
        onTvSelect={scrub.commit}
      />
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(position)}</Text>
        <Text style={styles.caption} numberOfLines={1}>
          {status === 'error' ? (error ?? 'Playback failed') : caption}
        </Text>
        <Text style={[styles.time, styles.timeRight]}>−{formatTime(Math.max(0, duration - position))}</Text>
      </View>
    </View>
  );

  const playButton = (
    <RoundButton
      icon={showsPause ? 'pause.fill' : 'play.fill'}
      label={showsPause ? 'Pause' : 'Play'}
      size={landscape ? 64 : 80}
      glyph={landscape ? 42 : 52}
      glass={false}
      haptic
      onPress={() => s.togglePlay()}
    />
  );

  const transport = longForm ? (
    <View style={[styles.transport, landscape && styles.transportLandscape]}>
      <RoundButton icon="backward.end.fill" label={now.chapters.length ? 'Previous chapter' : 'Previous'} size={48} glyph={iconSize.lg - 4} glass={false} onPress={() => s.chapterStep(-1)} />
      <RoundButton icon="gobackward.15" label="Back 15 seconds" size={56} glyph={iconSize.xl} glass={false} onPress={() => s.skip(-15)} />
      {playButton}
      <RoundButton icon="goforward.30" label="Forward 30 seconds" size={56} glyph={iconSize.xl} glass={false} onPress={() => s.skip(30)} />
      <RoundButton icon="forward.end.fill" label={now.chapters.length ? 'Next chapter' : 'Next'} size={48} glyph={iconSize.lg - 4} glass={false} onPress={() => s.chapterStep(1)} />
    </View>
  ) : (
    <View style={[styles.transport, styles.transportMusic, landscape && styles.transportLandscape]}>
      <RoundButton icon="backward.fill" label="Previous" size={landscape ? 56 : 64} glyph={iconSize.xl + (landscape ? -4 : 2)} glass={false} onPress={() => s.previous()} />
      {playButton}
      <RoundButton icon="forward.fill" label="Next" size={landscape ? 56 : 64} glyph={iconSize.xl + (landscape ? -4 : 2)} glass={false} onPress={() => s.next()} />
    </View>
  );

  const bottom = longForm ? (
    <View style={styles.pills}>
      <Pill flex={1} label={`Speed ${rate}×`} onPress={() => setSheet('speed')}>
        <Text style={styles.pillText}>{`${Number(rate.toFixed(2))}×`}</Text>
      </Pill>
      <Pill flex={1.4} label={sleep.kind === 'off' ? 'Sleep timer' : 'Sleep timer, on'} active={sleep.kind !== 'off'} onPress={() => setSheet('sleep')}>
        <Icon name="moon.zzz" size={iconSize.sm} color={c.textOnMedia} />
        <Text style={styles.pillText}>{sleepLeft !== null ? formatRemaining(sleepLeft) : sleep.kind === 'end' ? 'End' : 'Sleep'}</Text>
      </Pill>
      {/* Web has no AirPlay picker for audio, so no empty pill. */}
      {Platform.OS === 'ios' ? (
        <View style={styles.flex}>
          <Glass style={styles.pill}>
            <AirPlayButton audio />
          </Glass>
        </View>
      ) : null}
      {now.chapters.length ? (
        <Pill flex={1} label="Chapters" onPress={() => setSheet('chapters')}>
          <Icon name="list.bullet" size={iconSize.sm} color={c.textOnMedia} />
        </Pill>
      ) : (
        <Pill flex={1} label="Queue" active={effectivePanel === 'queue' && !wide} onPress={() => togglePanel('queue')}>
          <Icon name="list.bullet" size={iconSize.sm} color={c.textOnMedia} />
        </Pill>
      )}
    </View>
  ) : (
    <>
      {/* Landscape has no height for it; the volume buttons still work. */}
      {landscape ? null : <VolumeSlider />}
      <View style={[styles.bottomRow, landscape && styles.bottomRowLandscape]}>
        {/* Hidden when the track has no lyrics; the empty slot keeps AirPlay centred. */}
        {lyrics ? (
          <BottomButton icon="quote.bubble" label="Lyrics" active={effectivePanel === 'lyrics'} onPress={() => togglePanel('lyrics')} />
        ) : (
          <View style={styles.bottomButton} />
        )}
        <AirPlayButton audio />
        <BottomButton icon="list.bullet" label={upcoming ? `Queue, ${upcoming} up next` : 'Queue'} active={effectivePanel === 'queue' && !wide} onPress={() => togglePanel('queue')} />
      </View>
    </>
  );

  const panelView =
    effectivePanel === 'lyrics' && lyrics ? (
      <LyricsPanel lyrics={lyrics} />
    ) : effectivePanel === 'queue' ? (
      <QueuePanel selectedKey={selected} onSelect={setSelected} />
    ) : null;

  const artwork = (
    <Animated.View style={[styles.art, { width: artSize, height: artSize }, artStyle]}>
      <ItemImage item={item} variant="square" width={artSize} aspectRatio={1} rounded={20} hideArtTitle={false} />
    </Animated.View>
  );

  const controls = (
    <View style={[styles.controls, landscape && styles.controlsLandscape, { width: contentWidth }]}>
      {scrubber}
      {transport}
      {bottom}
    </View>
  );

  const closeButton = (
    <Touchable
      kind="icon"
      radius={22}
      onPress={minimize}
      containerStyle={landscape ? styles.closeLandscape : styles.closeButton}
      style={styles.closeInner}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Close the player. Music keeps playing">
      <Icon name="chevron.down" size={iconSize.md} color={c.textOnMediaSecondary} weight="semibold" />
    </Touchable>
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.grabber} />
      {closeButton}
      <TogetherPill top={insets.top + spacing.xs} right={spacing.lg} onPress={() => openTogetherSheet('music', null)} />
    </View>
  );

  let body;
  if (landscape) {
    // A phone on its side: the art (or the open queue or lyrics) on the left at the full
    // usable height, the title and the controls on the right. The safe area pads both edges.
    body = (
      <View style={[styles.landRow, { paddingTop: pad.top, paddingLeft: pad.left, paddingRight: pad.right, gap }]}>
        {panelView ? (
          <View style={{ width: columnWidth, height: artSize }}>{panelView}</View>
        ) : (
          <GestureDetector gesture={dismiss}>
            <View style={[styles.landArt, { width: columnWidth, height: artSize }]}>{artwork}</View>
          </GestureDetector>
        )}
        <View style={[styles.landSide, { width: contentWidth, height: artSize }]}>
          {/* No second GestureDetector here: one gesture object can drive only one detector. */}
          <View style={styles.landTop}>
            {closeButton}
            <TogetherPill top={spacing.xs + 2} right={0} onPress={() => openTogetherSheet('music', null)} />
          </View>
          {title}
          {controls}
        </View>
      </View>
    );
  } else if (wide) {
    body = (
      <View style={styles.wideRow}>
        <View style={[styles.wideLeft, { width: columnWidth }]}>
          <GestureDetector gesture={dismiss}>
            <View style={styles.center}>
              {header}
              {/* The art area takes the art's own height. With `flex: 1`, Yoga uses a flex basis of 0 over
                  `height`, so the box shrank to its minimum and the art covered the header and the title. */}
              <View style={[styles.artArea, { width: contentWidth, height: artSize + spacing.md * 2 }]}>{artwork}</View>
              <View style={{ width: contentWidth }}>{title}</View>
            </View>
          </GestureDetector>
          {controls}
        </View>
        <View style={[styles.wideRight, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.panelTabs}>
            <PanelTab label="Up next" active={effectivePanel === 'queue'} onPress={() => setPanel('queue')} />
            {lyrics ? <PanelTab label="Lyrics" active={effectivePanel === 'lyrics'} onPress={() => setPanel('lyrics')} /> : null}
          </View>
          {panelView}
        </View>
      </View>
    );
  } else {
    body = (
      <View style={[styles.center, styles.flex]}>
        <GestureDetector gesture={dismiss}>
          <View style={[styles.center, panelView ? null : styles.flex]}>
            {header}
            {panelView ? (
              <View style={{ width: contentWidth }}>{compactTitle}</View>
            ) : (
              <>
                <View style={[styles.artArea, styles.flex, { width: contentWidth }]}>{artwork}</View>
                <View style={{ width: contentWidth }}>{title}</View>
              </>
            )}
          </View>
        </GestureDetector>
        {panelView ? <View style={[styles.panel, { width: contentWidth }]}>{panelView}</View> : null}
        {controls}
      </View>
    );
  }

  const sheetSections: SheetSection[] =
    sheet === 'speed'
      ? [
          {
            title: 'Playback speed',
            rows: SPEEDS.map((sp) => ({
              key: `r${sp}`,
              label: sp === 1 ? 'Normal (1×)' : `${sp}×`,
              selected: Math.abs(rate - sp) < 0.01,
              onPress: () => s.setRate(sp),
            })),
          },
        ]
      : sheet === 'sleep'
        ? [
            {
              title: 'Pause playback',
              rows: [
                { key: 'off', label: 'Off', selected: sleep.kind === 'off', onPress: () => s.setSleep(sleepOff) },
                ...SLEEP_MINUTES.map((m) => ({
                  key: `m${m}`,
                  label: `In ${m} minutes`,
                  selected: sleep.kind === 'minutes' && sleep.minutes === m,
                  onPress: () => s.setSleep(sleepFor(m, Date.now())),
                })),
                {
                  key: 'end',
                  label: chapter ? 'At the end of this chapter' : 'At the end of this track',
                  selected: sleep.kind === 'end',
                  onPress: () => {
                    const entry = currentEntry(queue);
                    if (!entry) return;
                    const i = chapter ? now.chapters.indexOf(chapter) : -1;
                    const end = i >= 0 ? (now.chapters[i + 1]?.start ?? null) : null;
                    s.setSleep(sleepAtEnd(entry.key, end));
                  },
                },
              ],
            },
          ]
        : sheet === 'chapters'
          ? [
              {
                title: 'Chapters',
                empty: 'No chapters',
                rows: now.chapters.map((ch, i) => ({
                  key: `c${i}`,
                  label: ch.name || `Chapter ${i + 1}`,
                  detail: formatTime(ch.start),
                  selected: chapter === ch,
                  onPress: () => s.seekTo(ch.start),
                })),
              },
            ]
          : sheet === 'more'
            ? [
                {
                  title: item.Name ?? 'Now playing',
                  rows: [
                    ...(item.AlbumId
                      ? [{ key: 'album', label: 'Go to album', selected: false, onPress: () => go({ Id: item.AlbumId ?? '', Name: item.Album, Type: 'MusicAlbum' }) }]
                      : []),
                    ...((item.ArtistItems?.[0] ?? item.AlbumArtists?.[0])?.Id
                      ? [
                          {
                            key: 'artist',
                            label: 'Go to artist',
                            selected: false,
                            onPress: () => {
                              const a = item.ArtistItems?.[0] ?? item.AlbumArtists?.[0];
                              if (a?.Id) go({ Id: a.Id, Name: a.Name, Type: 'MusicArtist' });
                            },
                          },
                        ]
                      : []),
                    { key: 'playlist', label: 'Add to playlist…', selected: false, onPress: () => openAddToPlaylist(item) },
                    ...(canDownload(item) && findDownload(item.Id)?.state !== 'completed'
                      ? [{ key: 'download', label: 'Download this song', selected: false, onPress: () => void downloads.download(item) }]
                      : []),
                    ...(features.watchTogether && (nearbySupported || (syncPlaySupported && signedIn))
                      ? [
                          {
                            key: 'together',
                            label: 'Listen together',
                            selected: false,
                            // The menu closes first: one sheet at a time.
                            onPress: () => setTimeout(() => openTogetherSheet('music', item), 300),
                          },
                        ]
                      : []),
                    { key: 'mix', label: 'Instant mix from this song', selected: false, onPress: () => void s.instantMix(item) },
                    { key: 'queue', label: 'Add to queue again', selected: false, onPress: () => void s.addToQueue(item) },
                    { key: 'stop', label: 'Stop playback', selected: false, onPress: () => void s.stop() },
                  ],
                },
              ]
            : [];

  const sheetTitle = sheet === 'speed' ? 'Speed' : sheet === 'sleep' ? 'Sleep timer' : sheet === 'chapters' ? 'Chapters' : 'More';

  return (
    <KeyInput enabled={!sheet} onKey={onKey} style={styles.root}>
      <StatusBar style="light" animated />
      <ArtBackground item={item} />
      <Animated.View style={[styles.root, frameStyle, { paddingBottom: bottomPad(insets.bottom) }]}>{body}</Animated.View>
      <PlayerSheet visible={sheet !== null} title={sheetTitle} sections={sheetSections} onClose={() => setSheet(null)} />
      <TogetherSheetHost where="music" />
      <ToastHost overlay />
    </KeyInput>
  );
}

function Pill({
  children,
  label,
  flex,
  active,
  onPress,
}: {
  children: React.ReactNode;
  label: string;
  flex: number;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      kind="button"
      radius={22}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ flex }}
      style={({ pressed }) => pressed && styles.pressed}>
      <Glass style={[styles.pill, active && styles.pillActive]}>{children}</Glass>
    </Touchable>
  );
}

function BottomButton({ icon, label, active, disabled, onPress }: { icon: IconName; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Touchable
      kind="icon"
      radius={22}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label}: none for this track` : label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [styles.bottomButton, active && styles.bottomButtonOn, pressed && styles.pressed, disabled && styles.disabled]}>
      <Icon name={icon} size={iconSize.md} color={active ? c.onAccent : c.textOnMedia} />
    </Touchable>
  );
}

function PanelTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Touchable
      kind="button"
      radius={16}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.panelTab, active && styles.panelTabOn]}>
      <Text style={[styles.panelTabText, active && styles.panelTabTextOn]}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  center: { alignItems: 'center', width: '100%' },
  header: { width: '100%', alignItems: 'center', paddingBottom: spacing.sm },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  closeButton: { position: 'absolute', left: spacing.lg, bottom: -6 },
  closeInner: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  artArea: { alignItems: 'center', justifyContent: 'center', minHeight: 140, paddingVertical: spacing.md },
  art: {
    borderRadius: 20,
    // A solid fill lets iOS draw the shadow from the layer shape.
    backgroundColor: '#111114',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  title: { ...font(type.title2), color: c.textOnMedia },
  artist: { ...font(type.title3), fontWeight: '400', color: 'rgba(255,255,255,0.7)' },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  compactTitle: { ...font(type.headline), color: c.textOnMedia },
  compactSub: { ...font(type.subheadline), color: c.textOnMediaSecondary },
  panel: { flex: 1, marginTop: spacing.sm },
  controls: { gap: spacing.md, paddingTop: spacing.sm },
  times: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  time: { ...font(type.caption1, { tabular: true }), fontWeight: '500', color: 'rgba(255,255,255,0.66)', minWidth: 56 },
  timeRight: { textAlign: 'right' },
  caption: { ...font(type.caption2), flex: 1, textAlign: 'center', color: 'rgba(255,255,255,0.75)' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  transportMusic: { paddingHorizontal: spacing.xl },
  pills: { flexDirection: 'row', gap: spacing.sm + 2, alignItems: 'center' },
  pill: { height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, overflow: 'hidden' },
  pillActive: { borderWidth: 1, borderColor: c.accent },
  pillText: { ...font(type.subheadline, { tabular: true }), fontWeight: '600', color: c.textOnMedia },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: spacing.sm },
  bottomButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bottomButtonOn: { backgroundColor: c.accent },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
  wideRow: { flex: 1, flexDirection: 'row' },
  landRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  landArt: { alignItems: 'center', justifyContent: 'center' },
  landSide: { justifyContent: 'center' },
  landTop: { height: 44, justifyContent: 'center' },
  closeLandscape: { marginLeft: -spacing.sm, alignSelf: 'flex-start' },
  titleRowLandscape: { marginTop: spacing.xs, marginBottom: spacing.xs },
  controlsLandscape: { gap: spacing.sm, paddingTop: 0 },
  transportLandscape: { marginVertical: 0 },
  bottomRowLandscape: { marginTop: 0 },
  wideLeft: { alignItems: 'center', justifyContent: 'center' },
  wideRight: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  panelTabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  panelTab: { paddingHorizontal: spacing.md, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)' },
  panelTabOn: { backgroundColor: c.textOnMedia },
  panelTabText: { ...font(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  panelTabTextOn: { color: '#111114' },
});
