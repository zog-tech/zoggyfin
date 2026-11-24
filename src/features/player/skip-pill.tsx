import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Touchable } from '@/components/touchable';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';

import { PlayerAction } from './round-button';
import { motion, player, radius, spacing, textStyle, type } from './tokens';

/** TV Modern look: a primary action (an Ember rectangle, radius 8 u), not a pill, and no layout animation. */
const MODERN = isTV && isTvModern;

/**
 * Skip Intro / Skip Credits (design-system §7.8): shows during the segment,
 * even with the controls hidden. TV: it takes the focus while the controls
 * are hidden (`preferredFocus`), so Select skips.
 * TV Modern: the primary action of the player (spec 2.8); the file keeps its name.
 */
export function SkipPill({
  label,
  onPress,
  preferredFocus,
  onFocusChange,
}: {
  label: string;
  onPress: () => void;
  preferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  if (MODERN) return <PlayerAction variant="primary" label={label} onPress={onPress} preferredFocus={preferredFocus} onFocusChange={onFocusChange} />;
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
      <Touchable
        kind="button"
        radius={radius.pill}
        onPress={onPress}
        hasTVPreferredFocus={preferredFocus}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Text style={styles.text}>{label}</Text>
      </Touchable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: player.skipPill,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  text: { ...textStyle(type.headline), fontSize: 15, color: player.skipPillText },
});
