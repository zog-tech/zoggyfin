import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { type FocusTarget, TvFocusGuide } from '@/features/tv/focus';
import { isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player/store';
import { type Chapter, chapterAt, chapterMarks, formatTime, spokenTime, type Trickplay, trickplaySheetUrl, trickplayTile } from '@/player/timeline';

import { c, motion, player, spacing, textStyle, type } from './tokens';

interface Props {
  position: number;
  duration: number;
  buffered: number;
  playing: boolean;
  chapters: readonly Chapter[];
  trickplay: Trickplay | null;
  server: { baseUrl: string; token: string | null } | null;
  itemId: string;
  mediaSourceId: string;
  /** The window width, to clamp the preview inside the gutters. */
  gutter: number;
  onSeek: (seconds: number) => void;
  onScrubbing: (scrubbing: boolean) => void;
  /** TV: the time the remote is scrubbing to (Left and Right on the focused bar), or null. */
  tvTarget?: number | null;
  /** TV: the bar took or lost the focus. */
  onTvFocus?: (focused: boolean) => void;
  /** TV: Select on the focused bar. */
  onTvSelect?: () => void;
  /** TV: the bar's view, so other controls can send the focus to it. */
  tvRef?: (view: FocusTarget | null) => void;
  /** TV: take the focus when the bar mounts (Down showed the controls). */
  tvPreferredFocus?: boolean;
}

/**
 * The video player's scrubber: reads the position, duration and buffered time
 * from the player store itself, so a position tick re-renders only the bar,
 * not the whole player screen.
 */
export function PlayerScrubber(props: Omit<Props, 'position' | 'duration' | 'buffered'>) {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  return <Scrubber {...props} position={position} duration={duration} buffered={buffered} />;
}

function clamp01(v: number) {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

/**
 * The scrubber (design-system §7.8): 6 pt track, 10 pt while dragged, a
 * white thumb, buffered and played fills, chapter gaps, and a trickplay
 * preview that follows the thumb. The drag runs on the UI thread.
 * TV: the bar is a focus stop; it grows and its thumb gets a ring while
 * focused, and the remote's scrub target moves the thumb and the preview.
 */
export function Scrubber({
  position,
  duration,
  buffered,
  playing,
  chapters,
  trickplay,
  server,
  itemId,
  mediaSourceId,
  gutter,
  onSeek,
  onScrubbing,
  tvTarget = null,
  onTvFocus,
  onTvSelect,
  tvRef,
  tvPreferredFocus,
}: Props) {
  const [tvFocused, setTvFocused] = useState(false);
  const [width, setWidth] = useState(0);
  const w = useSharedValue(0);
  const progress = useSharedValue(duration > 0 ? position / duration : 0);
  const bufferedP = useSharedValue(0);
  const dragging = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const lastSent = useSharedValue(-1);
  const [preview, setPreview] = useState<number | null>(null);
  const marks = useMemo(() => chapterMarks(chapters, duration), [chapters, duration]);

  // Follow playback between the 0.5 s time events with a linear glide.
  useEffect(() => {
    if (scrubbing.get() || tvTarget !== null || !(duration > 0)) return;
    const target = clamp01(position / duration);
    const jump = Math.abs(target - progress.get()) * duration > 2 || !playing;
    progress.set(jump ? target : withTiming(target, { duration: 500, easing: Easing.linear }));
  }, [position, duration, playing, progress, scrubbing, tvTarget]);

  // TV: the thumb follows the remote's scrub target.
  useEffect(() => {
    if (tvTarget === null || !(duration > 0)) return;
    progress.set(withTiming(clamp01(tvTarget / duration), { duration: motion.duration.fast }));
  }, [tvTarget, duration, progress]);

  useEffect(() => {
    bufferedP.set(withTiming(duration > 0 ? clamp01(buffered / duration) : 0, { duration: motion.duration.fast }));
  }, [buffered, duration, bufferedP]);

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    w.set(e.nativeEvent.layout.width);
  };

  const startScrub = () => {
    onScrubbing(true);
  };
  const endScrub = (fraction: number) => {
    setPreview(null);
    onScrubbing(false);
    onSeek(fraction * duration);
  };
  const tickHaptic = () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .hitSlop({ top: 16, bottom: 16 })
    .onBegin((e) => {
      scrubbing.set(true);
      dragging.set(withSpring(1, motion.spring.snappy));
      progress.set(clamp01(e.x / Math.max(1, w.get())));
      scheduleOnRN(startScrub);
    })
    .onUpdate((e) => {
      const p = clamp01(e.x / Math.max(1, w.get()));
      progress.set(p);
      // React hears about the drag once per second of media time, not per frame.
      const second = Math.round(p * duration);
      if (second !== lastSent.get()) {
        lastSent.set(second);
        scheduleOnRN(setPreview, second);
      }
    })
    .onFinalize(() => {
      if (!scrubbing.get()) return;
      scrubbing.set(false);
      dragging.set(withSpring(0, motion.spring.snappy));
      scheduleOnRN(endScrub, progress.get());
    });

  // A selection haptic when the thumb crosses a chapter mark while dragging.
  useAnimatedReaction(
    () => {
      if (!scrubbing.get()) return -1;
      const p = progress.get();
      let idx = 0;
      for (let i = 0; i < marks.length; i++) if (p >= (marks[i] ?? 2)) idx = i + 1;
      return idx;
    },
    (idx, prev) => {
      if (idx >= 0 && prev !== null && prev >= 0 && idx !== prev) scheduleOnRN(tickHaptic);
    },
  );

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + dragging.get() * (player.trackActive / player.track - 1) }],
  }));
  const playedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * w.get() }] }));
  const bufferedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (bufferedP.get() - 1) * w.get() }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * w.get() - player.thumb / 2 }, { scale: 1 + dragging.get() * 0.15 }],
  }));

  const value = `${spokenTime(position)} of ${spokenTime(duration)}`;
  const shownPreview = preview ?? tvTarget;

  const bar = (
    <>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.fill, styles.buffered, bufferedStyle]} />
        <Animated.View style={[styles.fill, styles.played, playedStyle]} />
        {marks.map((m) => (
          <View key={m} style={[styles.mark, { left: m * width - player.chapterGap / 2 }]} />
        ))}
      </Animated.View>
      <Animated.View style={[styles.thumb, tvFocused && styles.thumbFocused, thumbStyle]} />
    </>
  );

  return (
    <View style={styles.wrap}>
      {shownPreview !== null && width > 0 ? (
        <Preview
          seconds={shownPreview}
          fraction={duration > 0 ? shownPreview / duration : 0}
          trackWidth={width}
          gutter={gutter}
          chapter={chapterAt(chapters, shownPreview)?.name ?? null}
          trickplay={trickplay}
          server={server}
          itemId={itemId}
          mediaSourceId={mediaSourceId}
        />
      ) : null}
      {isTV ? (
        // TV: a focus stop. Left and Right scrub (player-screen) and never move the focus off it.
        <TvFocusGuide trapHorizontal>
        <Pressable
          ref={tvRef}
          focusable
          hasTVPreferredFocus={tvPreferredFocus}
          style={styles.hit}
          onLayout={onLayout}
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ text: value }}
          onFocus={() => {
            setTvFocused(true);
            dragging.set(withSpring(1, motion.spring.snappy));
            onTvFocus?.(true);
          }}
          onBlur={() => {
            setTvFocused(false);
            dragging.set(withSpring(0, motion.spring.snappy));
            onTvFocus?.(false);
          }}
          onPress={onTvSelect}>
          {bar}
        </Pressable>
        </TvFocusGuide>
      ) : (
      <GestureDetector gesture={pan}>
        <View
          style={styles.hit}
          onLayout={onLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ text: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onSeek(position + (e.nativeEvent.actionName === 'increment' ? 15 : -15))}>
          {bar}
        </View>
      </GestureDetector>
      )}
    </View>
  );
}

function Preview({
  seconds,
  fraction,
  trackWidth,
  gutter,
  chapter,
  trickplay,
  server,
  itemId,
  mediaSourceId,
}: {
  seconds: number;
  fraction: number;
  trackWidth: number;
  gutter: number;
  chapter: string | null;
  trickplay: Trickplay | null;
  server: { baseUrl: string; token: string | null } | null;
  itemId: string;
  mediaSourceId: string;
}) {
  const pw = player.preview.width;
  const ph = trickplay ? Math.round((pw * trickplay.height) / trickplay.width) : 0;
  const boxWidth = trickplay ? pw : 96;
  // The track is inset by the gutter already; keep the box inside the window gutters.
  const left = Math.min(Math.max(fraction * trackWidth - boxWidth / 2, -gutter + spacing.sm), trackWidth - boxWidth + gutter - spacing.sm);
  const tile = trickplay ? trickplayTile(trickplay, seconds) : null;
  const scale = trickplay ? pw / trickplay.width : 1;
  return (
    <View pointerEvents="none" style={[styles.preview, { left, width: boxWidth }]}>
      {trickplay && tile && server ? (
        <View style={[styles.thumbBox, { width: pw, height: ph }]}>
          <Image
            source={{ uri: trickplaySheetUrl(server, itemId, mediaSourceId, trickplay, tile.sheet) }}
            style={{
              position: 'absolute',
              width: trickplay.width * trickplay.tileWidth * scale,
              height: trickplay.height * trickplay.tileHeight * scale,
              transform: [{ translateX: -tile.x * scale }, { translateY: -tile.y * scale }],
            }}
            contentFit="fill"
            cachePolicy="memory-disk"
            recyclingKey={`${itemId}-${tile.sheet}`}
          />
        </View>
      ) : null}
      {chapter ? (
        <Text style={styles.previewChapter} numberOfLines={1}>
          {chapter}
        </Text>
      ) : null}
      <View style={styles.timeBubble}>
        <Text style={styles.previewTime}>{formatTime(seconds)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  hit: { height: player.scrubberHitHeight, justifyContent: 'center' },
  track: {
    height: player.track,
    borderRadius: player.track / 2,
    backgroundColor: player.trackColor,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill },
  buffered: { backgroundColor: player.bufferedColor },
  played: { backgroundColor: player.playedColor },
  mark: { position: 'absolute', top: 0, bottom: 0, width: player.chapterGap, backgroundColor: player.chapterMarkColor },
  thumb: {
    position: 'absolute',
    left: 0,
    width: player.thumb,
    height: player.thumb,
    borderRadius: player.thumb / 2,
    backgroundColor: player.playedColor,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  // TV: the focused bar's thumb has a ring, readable from across the room.
  thumbFocused: { borderWidth: 3, borderColor: c.accent },
  preview: { position: 'absolute', bottom: player.scrubberHitHeight + spacing.xs, alignItems: 'center', gap: spacing.xs },
  thumbBox: {
    borderRadius: player.preview.radius,
    borderWidth: player.preview.border,
    borderColor: c.textOnMedia,
    overflow: 'hidden',
    backgroundColor: c.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  previewChapter: { ...textStyle(type.footnote), color: c.textOnMediaSecondary, maxWidth: player.preview.width },
  timeBubble: { backgroundColor: c.glassFallback, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  previewTime: { ...textStyle(type.mono), color: c.textOnMedia, fontVariant: ['tabular-nums'] },
});
