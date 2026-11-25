import { useEffect } from 'react';
import { type ColorValue, type LayoutChangeEvent, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { features } from '@/platform/tv';
import { audibleLevel, volumeIcon, volumeText } from '@/player/volume';
import { setVolumeLevel, stepAppVolume, toggleAppMute, useVolume } from '@/settings/volume';

import { motion, spacing } from './tokens';

const TRACK = 4;
const TRACK_ACTIVE = 6;
const THUMB = 12;
const HIT = 28;

function clamp01(v: number) {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

export interface VolumeColors {
  /** The played part and the thumb. */
  tint: string;
  /** The rest of the track. */
  track: ColorValue;
}

/**
 * The app's volume slider (the web and the Mac app; `player/volume.ts`):
 * a thin track with a fill and a round thumb, on the scrubber's pattern. The
 * drag runs on the UI thread and sets the level as it moves; `onAdjusting`
 * says when a drag starts and ends, so a player keeps its controls shown.
 */
export function VolumeSlider({
  colors,
  onAdjusting,
  style,
}: {
  colors: VolumeColors;
  onAdjusting?: (on: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const state = useVolume();
  const level = audibleLevel(state);
  const w = useSharedValue(0);
  const progress = useSharedValue(level);
  const active = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastSent = useSharedValue(-1);

  // Follow the store (keys, the speaker button, another slider) while no drag runs.
  useEffect(() => {
    if (!dragging.get()) progress.set(level);
  }, [level, progress, dragging]);

  const onLayout = (e: LayoutChangeEvent) => {
    w.set(e.nativeEvent.layout.width);
  };
  const begin = () => onAdjusting?.(true);
  const end = () => onAdjusting?.(false);

  const pan = Gesture.Pan()
    .minDistance(0)
    .hitSlop({ top: 8, bottom: 8 })
    .onBegin((e) => {
      dragging.set(true);
      active.set(withSpring(1, motion.spring.snappy));
      const p = clamp01(e.x / Math.max(1, w.get()));
      progress.set(p);
      lastSent.set(Math.round(p * 100));
      scheduleOnRN(begin);
      scheduleOnRN(setVolumeLevel, p);
    })
    .onUpdate((e) => {
      const p = clamp01(e.x / Math.max(1, w.get()));
      progress.set(p);
      // React and the players hear about it once per percent, not per frame.
      const pct = Math.round(p * 100);
      if (pct !== lastSent.get()) {
        lastSent.set(pct);
        scheduleOnRN(setVolumeLevel, p);
      }
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      active.set(withSpring(0, motion.spring.snappy));
      scheduleOnRN(end);
    });

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + active.get() * (TRACK_ACTIVE / TRACK - 1) }] }));
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * w.get() }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * w.get() - THUMB / 2 }, { scale: 1 + active.get() * 0.15 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.hit, style]}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Volume"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100), text: volumeText(state) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => stepAppVolume(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
        <Animated.View style={[styles.track, { backgroundColor: colors.track }, trackStyle]}>
          <Animated.View style={[styles.fill, { backgroundColor: colors.tint }, fillStyle]} />
        </Animated.View>
        <Animated.View style={[styles.thumb, { backgroundColor: colors.tint }, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

/** The speaker button: its glyph shows the level; a press mutes or unmutes. */
export function VolumeButton({
  color,
  glyph = 20,
  size = 36,
  icon,
  onPress,
}: {
  color: string;
  glyph?: number;
  size?: number;
  /** A fixed glyph while not muted (Now Playing's low speaker); default: by level. */
  icon?: 'speaker.fill';
  onPress?: () => void;
}) {
  const state = useVolume();
  const auto = volumeIcon(state);
  const name = icon && auto !== 'speaker.slash.fill' ? icon : auto;
  return (
    <Touchable
      kind="icon"
      radius={size / 2}
      hitSlop={4}
      onPress={() => {
        toggleAppMute();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={state.muted ? 'Unmute' : 'Mute'}
      style={[styles.button, { width: size, height: size, borderRadius: size / 2 }]}>
      <Icon name={name} size={glyph} color={color} />
    </Touchable>
  );
}

/**
 * The speaker button with a short slider beside it: the video player's bar
 * and the mini player. Nothing on phones and TVs (they use the hardware volume).
 */
export function VolumeControl({
  colors,
  sliderWidth = 96,
  glyph = 20,
  size = 36,
  onAdjusting,
  onChange,
}: {
  colors: VolumeColors;
  sliderWidth?: number;
  glyph?: number;
  size?: number;
  onAdjusting?: (on: boolean) => void;
  /** Any change from this control (a press, a drag start), so a player can wake its controls. */
  onChange?: () => void;
}) {
  if (!features.inAppVolume) return null;
  return (
    <View style={styles.row}>
      <VolumeButton color={colors.tint} glyph={glyph} size={size} onPress={onChange} />
      <VolumeSlider colors={colors} style={{ width: sliderWidth }} onAdjusting={onAdjusting} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  button: { alignItems: 'center', justifyContent: 'center' },
  hit: { height: HIT, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
