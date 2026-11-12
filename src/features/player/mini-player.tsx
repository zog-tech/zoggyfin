import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/icon';
import { ChannelLogo } from '@/features/iptv/channel-logo';
import { TogetherChip } from '@/features/together/together-pill';
import { ItemImage } from '@/components/item-image';
import { Touchable } from '@/components/touchable';
import { episodeLabel } from '@/lib/format';
import { activePlayback, openFullPlayer } from '@/player';
import { artistLine } from '@/player/audio/item';
import { useAudioStore } from '@/player/audio/store';
import { useShowsPause } from '@/player/control-gate';
import { isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player/store';

import { createStyles, type AppTheme, font, tv, useStyles, useTheme } from '@/theme';

import { Glass } from './glass';
import { canSwipeDismiss, shouldDismiss, showsCloseButton } from './mini-player-rules';
import { iconSize, motion, radius, spacing, type } from './tokens';

/** True when the mini player should show: something plays and the full player is closed. */
export function useMiniPlayerVisible(): boolean {
  return usePlayerStore((s) => !!s.now && s.presentation === 'mini');
}

/**
 * The mini player (design-system §7.2): art, title, play/pause, next (audio) and
 * close (video, web and TV; phone audio stops with a swipe down), with a 2 pt progress line. Tap or swipe up opens the full player.
 * `inline` is the compact iOS 26 accessory placement.
 */
export function MiniPlayer({ inline = false, floating = false }: { inline?: boolean; floating?: boolean }) {
  const now = usePlayerStore((s) => s.now);
  const showsPause = useShowsPause();
  const fraction = usePlayerStore((s) => (s.duration > 0 ? Math.min(1, s.position / s.duration) : 0));
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const lift = useSharedValue(0);
  const liftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lift.get(), [0, 80], [1, 0.4], 'clamp'),
    transform: [{ translateY: lift.get() }],
  }));

  const isAudio = usePlayerStore((s) => s.now?.kind === 'audio');
  const rules = { isAudio, web: Platform.OS === 'web', tv: isTV };
  const dismissable = canSwipeDismiss(rules);
  const dismiss = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    activePlayback.stop();
    lift.set(0);
  };
  const sourceName = useAudioStore((s) => s.queue.source?.name);
  const shift = useSharedValue(0);
  const shiftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() }] }));
  const swipe = Gesture.Pan()
    .activeOffsetY(dismissable ? [-12, 12] : -12)
    .failOffsetX([-20, 20])
    // Up is a rubber band; down follows the finger more closely, as it can dismiss.
    .onUpdate((e) => lift.set(e.translationY < 0 ? e.translationY * 0.4 : dismissable ? e.translationY * 0.7 : 0))
    .onEnd((e) => {
      if (dismissable && shouldDismiss(e.translationY, e.velocityY)) {
        lift.set(
          withTiming(120, { duration: motion.duration.fast, easing: Easing.bezier(...motion.easing.exit) }, (done) => {
            if (done) scheduleOnRN(dismiss);
          }),
        );
        return;
      }
      lift.set(withSpring(0, { ...motion.spring.smooth, velocity: e.velocityY }));
      if (e.translationY < -30 || e.velocityY < -500) scheduleOnRN(openFullPlayer);
    });
  // Audio: swipe left for the next track, right for the previous one.
  const skipTrack = (dir: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (dir < 0) activePlayback.next();
    else activePlayback.previous();
  };
  const sideSwipe = Gesture.Pan()
    .enabled(isAudio)
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((e) => shift.set(e.translationX * 0.35))
    .onEnd((e) => {
      shift.set(withSpring(0, { ...motion.spring.snappy, velocity: e.velocityX }));
      if (Math.abs(e.translationX) > 60 || Math.abs(e.velocityX) > 700) scheduleOnRN(skipTrack, e.translationX < 0 ? -1 : 1);
    });
  const gestures = Gesture.Race(swipe, sideSwipe);

  if (!now) return null;
  const item = now.item;
  const liveChannel = now.live ? now.live.channels[now.live.index] : null;
  const sub = liveChannel
    ? (liveChannel.group || 'Live TV')
    : isAudio
    ? (artistLine(item) ?? item.Album ?? sourceName ?? 'Audio')
    : item.Type === 'Episode'
      ? [item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ')
      : item.ProductionYear
        ? String(item.ProductionYear)
        : 'Video';
  const toggle = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    activePlayback.togglePlay();
  };
  const art = liveChannel ? (
    <ChannelLogo uri={liveChannel.logo} name={liveChannel.name} size={30} />
  ) : isAudio ? (
    <ItemImage item={item} variant="square" width={38} aspectRatio={1} rounded={radius.sm} hideArtTitle />
  ) : (
    <ItemImage item={item} variant="landscape" width={38 * (16 / 9)} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
  );

  const content = (
    // The buttons are siblings of the "open" area, not inside it: no nested buttons on web.
    <View style={[styles.row, isTV && styles.rowTV]}>
      {inline && isAudio ? (
        <Touchable radius={16} onPress={() => activePlayback.previous()} hitSlop={4} style={styles.buttonSmall} accessibilityRole="button" accessibilityLabel="Previous track">
          <Icon name="backward.fill" size={iconSize.sm} color={c.text} />
        </Touchable>
      ) : null}
      <Touchable radius={radius.pill} onPress={openFullPlayer} containerStyle={[styles.openArea, isTV && styles.openAreaTV]} accessibilityRole="button" accessibilityLabel={`Now playing: ${item.Name ?? ''}. Opens the player`}
        accessibilityActions={dismissable ? [{ name: 'stop', label: 'Stop' }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'stop') activePlayback.stop();
        }}
        style={styles.open}>
        {!inline ? art : null}
        <Animated.View style={[styles.text, shiftStyle]}>
          <Text style={styles.title} numberOfLines={1}>
            {item.Name}
          </Text>
          {!inline ? (
            <Text style={styles.sub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </Animated.View>
      </Touchable>
      <TogetherChip iconOnly={inline} />
      <Touchable radius={22} onPress={toggle} hitSlop={6} style={styles.button} accessibilityRole="button" accessibilityLabel={showsPause ? 'Pause' : 'Play'}>
        <Icon name={showsPause ? 'pause.fill' : 'play.fill'} size={iconSize.md} color={c.text} weight="semibold" />
      </Touchable>
      {isAudio ? (
        <Touchable radius={inline ? 16 : 22} onPress={() => activePlayback.next()} hitSlop={inline ? 4 : 6} style={inline ? styles.buttonSmall : styles.button} accessibilityRole="button" accessibilityLabel="Next track">
          <Icon name="forward.fill" size={inline ? iconSize.sm : iconSize.md - 2} color={c.text} />
        </Touchable>
      ) : null}
      {showsCloseButton({ inline, ...rules }) ? (
        <Touchable radius={22} onPress={() => activePlayback.stop()} hitSlop={6} style={styles.button} accessibilityRole="button" accessibilityLabel="Stop playback">
          <Icon name="xmark" size={iconSize.sm} color={c.text2} weight="semibold" />
        </Touchable>
      ) : null}
    </View>
  );

  return (
    <GestureDetector gesture={gestures}>
      <Animated.View style={[styles.wrap, floating && styles.floating, liftStyle]}>
        {floating ? (
          <Glass variant="regular" scheme="auto" style={styles.capsule}>
            {content}
            <Progress fraction={fraction} />
          </Glass>
        ) : (
          <View style={styles.fillWrap}>
            {content}
            <Progress fraction={fraction} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function Progress({ fraction }: { fraction: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View style={[styles.progressFill, { transform: [{ translateX: `${(fraction - 1) * 100}%` }] }]} />
    </View>
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  wrap: { flex: 1, width: '100%', justifyContent: 'center' },
  floating: { flex: 0, maxWidth: 400, alignSelf: 'center' },
  capsule: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadow('floating'),
  },
  fillWrap: { flex: 1, justifyContent: 'center', overflow: 'hidden', borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.sm, paddingRight: spacing.xs, minHeight: 52 },
  openArea: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  // TV: room inside the capsule (it clips) for the focus ring.
  rowTV: { paddingVertical: tv.focusRingWidth + tv.focusRingGap, paddingLeft: spacing.md },
  openAreaTV: { alignSelf: 'center' },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  // Both lines start at the art. Without a fixed side, an Arabic or Hebrew title aligns to the right
  // (the web sets dir="auto", Android uses the first strong letter) while the artist stays on the left.
  title: { ...font(type.tileTitle), color: c.text, textAlign: 'left' },
  sub: { ...font(type.caption1), color: c.text2, textAlign: 'left' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 0, height: 2, overflow: 'hidden', borderRadius: 1 },
  progressFill: { ...StyleSheet.absoluteFill, backgroundColor: c.accent },
}));
