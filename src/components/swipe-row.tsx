/**
 * Swipe actions on a row (design system §7.10, §7.11).
 *
 * - `onSwipe`: swipe left to delete. The red area with the label follows the
 *   finger; past the threshold the row slides away and `onSwipe` runs. The
 *   caller confirms and removes; a cancelled confirm brings the row back.
 * - `leading` / `trailing`: an action at the left edge (swipe right) or the
 *   right edge (swipe left), as in Music. A partial swipe shows it and springs
 *   back; a full swipe runs it with a light haptic and springs back.
 *
 * The rules (threshold, fling, direction) are in `swipe-logic.ts`. The pan
 * starts only on a mostly horizontal move toward a side with an action, so
 * the list scrolls first. Touches at the left edge are left to the back
 * swipe. Inside a pager the row stops the paging while a finger is on it
 * (`pager-lock.ts`). Screen readers and keyboards use the row's own
 * accessibility actions; TV has no swipe.
 */
import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { features } from '@/platform/tv';
import { font, motion, spacing, type, useTheme } from '@/theme';

import { Icon } from './icon';
import type { IconName } from './icon-names';
import { usePagerLock } from './pager-lock';
import { activeOffsetX, armed, EDGE_X, FAIL_Y, swipeEnd, swipeOffset, type SwipeSide } from './swipe-logic';

/** How far the red delete area slides in behind the row. */
const REVEAL = 600;

export interface SwipeAction {
  label: string;
  icon: IconName;
  /** Fill behind the row, and the colour of the icon and label on it. */
  color: string;
  textColor: string;
  run: () => void;
}

export function SwipeRow({
  children,
  onSwipe,
  label = 'Delete',
  leading,
  trailing,
  enabled = true,
}: {
  children: ReactNode;
  /** Swipe left to delete. It takes the right edge: `trailing` is ignored when this is set. */
  onSwipe?: () => void | Promise<boolean | void>;
  label?: string;
  leading?: SwipeAction;
  trailing?: SwipeAction;
  enabled?: boolean;
}) {
  const { c } = useTheme();
  const lock = usePagerLock();
  // True while this row holds the pager lock. Set on the UI thread, so a fast tap cannot release before the hold.
  const held = useSharedValue(false);
  const x = useSharedValue(0);
  const remove = !!onSwipe;
  const sides = { leading: !!leading, trailing: remove || !!trailing };
  const on = enabled && features.touchGestures && (sides.leading || sides.trailing);

  // A row that goes away under the finger (a list refresh) gives the pager back.
  useEffect(
    () => () => {
      if (held.get()) lock?.release();
      held.set(false);
    },
    [lock, held],
  );

  const hold = () => lock?.hold();
  const release = () => lock?.release();
  const locks = !!lock;
  const reset = () => {
    x.set(withSpring(0, motion.spring.snappy));
  };
  const fireRemove = async () => {
    const result = await onSwipe?.();
    if (result === false) reset();
  };
  const fire = (side: SwipeSide) => {
    const action = side === 'leading' ? leading : trailing;
    if (!action) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    action.run();
  };

  const pan = Gesture.Pan()
    .enabled(on)
    .activeOffsetX(activeOffsetX(sides))
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .hitSlop({ left: -EDGE_X })
    .onBegin(() => {
      if (!locks || held.get()) return;
      held.set(true);
      scheduleOnRN(hold);
    })
    .onUpdate((e) => {
      x.set(swipeOffset(e.translationX, sides));
    })
    .onEnd((e) => {
      const side = swipeEnd(e.translationX, e.velocityX, sides);
      if (side === 'trailing' && remove) {
        x.set(withTiming(-REVEAL, { duration: motion.duration.fast }));
        scheduleOnRN(fireRemove);
        return;
      }
      x.set(withSpring(0, { ...motion.spring.snappy, velocity: e.velocityX }));
      if (side) scheduleOnRN(fire, side);
    })
    .onFinalize(() => {
      if (!held.get()) return;
      held.set(false);
      scheduleOnRN(release);
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const removeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: REVEAL + Math.min(0, x.get()) }] }));
  const leadingStyle = useAnimatedStyle(() => ({ opacity: x.get() > 0 ? 1 : 0 }));
  const trailingStyle = useAnimatedStyle(() => ({ opacity: x.get() < 0 ? 1 : 0 }));
  // The label grows a little once a release would run the action.
  const leadingMark = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(armed(x.get()) ? 1.12 : 1, { duration: motion.duration.fast }) }] }));
  const trailingMark = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(armed(x.get()) ? 1.12 : 1, { duration: motion.duration.fast }) }] }));

  if (!on) return <>{children}</>;
  return (
    <View style={styles.wrap}>
      {leading ? (
        <Animated.View style={[styles.side, styles.leading, { backgroundColor: leading.color }, leadingStyle]} pointerEvents="none">
          <Animated.View style={[styles.mark, leadingMark]}>
            <Icon name={leading.icon} size={18} color={leading.textColor} />
            <Text style={[styles.label, { color: leading.textColor }]}>{leading.label}</Text>
          </Animated.View>
        </Animated.View>
      ) : null}
      {remove ? (
        <Animated.View style={[styles.behind, { backgroundColor: c.danger }, removeStyle]} pointerEvents="none">
          <Icon name="trash" size={18} color="#FFFFFF" />
          <Text style={[styles.label, { color: '#FFFFFF' }]}>{label}</Text>
        </Animated.View>
      ) : trailing ? (
        <Animated.View style={[styles.side, styles.trailing, { backgroundColor: trailing.color }, trailingStyle]} pointerEvents="none">
          <Animated.View style={[styles.mark, trailingMark]}>
            <Text style={[styles.label, { color: trailing.textColor }]}>{trailing.label}</Text>
            <Icon name={trailing.icon} size={18} color={trailing.textColor} />
          </Animated.View>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  behind: {
    ...StyleSheet.absoluteFill,
    left: undefined,
    width: REVEAL,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.xl,
  },
  side: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  leading: { justifyContent: 'flex-start' },
  trailing: { justifyContent: 'flex-end' },
  mark: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...font(type.subheadline), fontWeight: '600' },
});
