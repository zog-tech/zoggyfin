import * as Haptics from 'expo-haptics';
import { type ReactNode, useContext, useState } from 'react';
import { findNodeHandle, Platform, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { TouchFocusMark, Touchable } from '@/components/touchable';
import { type FocusTarget } from '@/features/tv/focus';
import { TvFocusPlate, TvPlateText } from '@/features/tv/tv-button';
import { focusFromKeyboard } from '@/lib/input-modality';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { tv, tvFont, tvm, u, webPressable } from '@/theme';

import { Glass } from './glass';
import { c, motion } from './tokens';

/** TV Modern look (design system §7.22): flat controls over video, the focus plate, no circle. */
const MODERN = isTV && isTvModern;

interface RoundButtonProps {
  icon?: IconName;
  label: string;
  /** The button's size in points (Modern TV: the square box). */
  size: number;
  /** The glyph's size in points. */
  glyph: number;
  onPress: () => void;
  glass?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** TV: take the focus when it mounts or when this turns true. */
  preferredFocus?: boolean;
  /** The button took (true) or lost (false) the focus. */
  onFocusChange?: (focused: boolean) => void;
  /** Android TV: the view that Down sends the focus to. */
  nextFocusDown?: FocusTarget | null;
  /** TV: the button's view, so the player can move the focus to it. */
  tvRef?: (view: FocusTarget | null) => void;
}

/**
 * A round glass button over video. Press-in scales to 0.92 (snappy spring
 * back); with Reduce Motion only the opacity changes. Keyboard focus draws a
 * ring around the circle only (TV: a white ring, and the button grows).
 * TV Modern: a bare white glyph in a square box; the focus plate fills the
 * box and the glyph turns dark (no circle, no glass).
 */
export const RoundButton: (props: RoundButtonProps) => ReactNode = MODERN ? ModernRoundButton : ClassicRoundButton;

function ClassicRoundButton({
  icon,
  label,
  size,
  glyph,
  onPress,
  glass = true,
  haptic,
  style,
  children,
  preferredFocus,
  onFocusChange,
  nextFocusDown,
  tvRef,
}: RoundButtonProps) {
  const pressed = useSharedValue(0);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const anim = useAnimatedStyle(() => {
    const p = pressed.get();
    return reduced
      ? { opacity: 1 - p * 0.3 }
      : { transform: [{ scale: 1 - p * (1 - motion.press.buttonScale) }] };
  });
  const focusRing = focused;
  const body = (
    <>
      {icon ? <Icon name={icon} size={glyph} color={c.textOnMedia} weight="semibold" /> : null}
      {children}
    </>
  );
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Pressable
      ref={tvRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      hasTVPreferredFocus={preferredFocus}
      nextFocusDown={nextFocusDown && Platform.OS !== 'web' ? (findNodeHandle(nextFocusDown) ?? undefined) : undefined}
      onFocus={() => {
        setFocused(focusFromKeyboard());
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPressIn={() => pressed.set(withTiming(1, { duration: motion.duration.press }))}
      onPressOut={() => pressed.set(withSpring(0, motion.spring.snappy))}
      onPress={() => {
        if (haptic && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[webPressable, style]}>
      <View style={[styles.focusWrap, { borderRadius: size / 2 + (isTV ? tv.focusRingWidth * 2 : 4) }, focusRing && styles.focused]}>
        <Animated.View style={[round, anim]}>
          {glass ? (
            <Glass style={[styles.center, round]}>{body}</Glass>
          ) : (
            <Animated.View style={[styles.center, round]}>{body}</Animated.View>
          )}
        </Animated.View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// TV Modern look. The focus mark is a shared value (UI thread): a focus move
// does no React render. Classic keeps the ring and the circle above.
// ---------------------------------------------------------------------------

const STANDARD = Easing.bezier(...motion.easing.standard);

/** Sets the Modern focus mark: a short fade, at once with Reduce Motion. */
function setMark(mark: { set: (v: number) => void }, on: boolean, reduced: boolean) {
  if (reduced) mark.set(on ? 1 : 0);
  else mark.set(withTiming(on ? 1 : 0, { duration: on ? tvm.motion.focus : tvm.motion.blur, easing: STANDARD }));
}

/** Modern: the box grows to `actionFocusScale` with the mark (none with Reduce Motion). */
function useFocusGrow() {
  const mark = useContext(TouchFocusMark);
  const reduced = useReducedMotion();
  return useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 + (tvm.size.actionFocusScale - 1) * (mark ? mark.get() : 0) }] }));
}

/** A glyph in two colours, cross-faded on the focus mark (an icon's colour is not animatable). */
function PlateGlyph({ name, size, rest, focus = tvm.color.plateText }: { name: IconName; size: number; rest: string; focus?: string }) {
  const mark = useContext(TouchFocusMark);
  const lit = useAnimatedStyle(() => ({ opacity: mark ? mark.get() : 0 }));
  const dim = useAnimatedStyle(() => ({ opacity: mark ? 1 - mark.get() : 1 }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, dim]}>
        <Icon name={name} size={size} color={rest} weight="semibold" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, lit]}>
        <Icon name={name} size={size} color={focus} weight="semibold" />
      </Animated.View>
    </View>
  );
}

/**
 * Modern: the centre transport of the video player (play, skip, channel up
 * and down). A bare white glyph in a square box (`size`); with the focus the
 * plate fills the box, the glyph turns dark and the box grows to 1.04. Same
 * props and focus behaviour as the Classic button: `onFocusChange`,
 * `nextFocusDown`, `tvRef` and `preferredFocus` work the same.
 */
function ModernRoundButton({ icon, label, size, glyph, onPress, haptic, style, children, preferredFocus, onFocusChange, nextFocusDown, tvRef }: RoundButtonProps) {
  const mark = useSharedValue(0);
  const reduced = useReducedMotion();
  return (
    <Pressable
      ref={tvRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferredFocus}
      nextFocusDown={nextFocusDown && Platform.OS !== 'web' ? (findNodeHandle(nextFocusDown) ?? undefined) : undefined}
      onFocus={() => {
        setMark(mark, focusFromKeyboard(), reduced);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setMark(mark, false, reduced);
        onFocusChange?.(false);
      }}
      onPress={() => {
        if (haptic && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[webPressable, style]}>
      <TouchFocusMark value={mark}>
        <GlyphBox size={size}>
          {icon ? <PlateGlyph name={icon} size={glyph} rest={c.textOnMedia} /> : null}
          {children}
        </GlyphBox>
      </TouchFocusMark>
    </Pressable>
  );
}

function GlyphBox({ size, children }: { size: number; children: ReactNode }) {
  const grow = useFocusGrow();
  return (
    <Animated.View style={[modern.square, { width: size, height: size }, grow]}>
      <TvFocusPlate />
      {children}
    </Animated.View>
  );
}

export interface PlayerActionProps {
  label: string;
  icon?: IconName;
  /** 'primary': the Ember rectangle (the main choice of a prompt or card). 'text' (default): glyph and label, no container. */
  variant?: 'primary' | 'text';
  onPress: () => void;
  /** The action took (true) or lost (false) the focus: the player counts focused controls. */
  onFocusChange?: (focused: boolean) => void;
  /** TV: take the focus when it mounts or when this turns true. */
  preferredFocus?: boolean;
  accessibilityLabel?: string;
}

/**
 * TV Modern: an action of the video player (the option row, Skip Intro, the
 * next-up card, the error card). The same shapes as `TvButton` (design
 * system §7.22: a primary Ember rectangle, or a text action with no
 * container; the plate on focus), plus a blur callback, which the player's
 * focus count needs. Only call it in the Modern look on TV.
 */
export function PlayerAction({ label, icon, variant = 'text', onPress, onFocusChange, preferredFocus, accessibilityLabel }: PlayerActionProps) {
  return (
    <Touchable
      kind="plain"
      ring={false}
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}>
      {variant === 'primary' ? <PrimaryBody label={label} icon={icon} /> : <TextBody label={label} icon={icon} />}
    </Touchable>
  );
}

function PrimaryBody({ label, icon }: { label: string; icon?: IconName }) {
  const mark = useContext(TouchFocusMark);
  const grow = useFocusGrow();
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(mark ? mark.get() : 0, [0, 1], [c.accent, tvm.color.plate]) }));
  return (
    <Animated.View style={[modern.box, modern.primary, fill, grow]}>
      {icon ? <PlateGlyph name={icon} size={u(tvm.size.actionIcon)} rest={c.onAccent} /> : null}
      <TvPlateText style={modern.primaryLabel} rest={c.onAccent}>
        {label}
      </TvPlateText>
    </Animated.View>
  );
}

function TextBody({ label, icon }: { label: string; icon?: IconName }) {
  const grow = useFocusGrow();
  return (
    <Animated.View style={[modern.box, modern.text, grow]}>
      <TvFocusPlate />
      {icon ? <PlateGlyph name={icon} size={u(tvm.size.actionIcon)} rest={c.textOnMedia} /> : null}
      <TvPlateText style={modern.textLabel} rest={c.textOnMedia}>
        {label}
      </TvPlateText>
    </Animated.View>
  );
}

const modern = StyleSheet.create({
  square: { alignItems: 'center', justifyContent: 'center' },
  box: { flexDirection: 'row', alignItems: 'center', gap: u(14), height: u(tvm.size.actionHeight), borderRadius: u(tvm.size.plateRadius) },
  primary: { paddingHorizontal: u(tvm.size.primaryPadX) },
  text: { paddingHorizontal: u(tvm.size.actionPadX) },
  primaryLabel: { ...tvFont(tvm.type.action), fontWeight: '700' },
  textLabel: { ...tvFont(tvm.type.action) },
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // A ring with a gap, drawn by the padded wrapper; transparent until focused.
  focusWrap: isTV
    ? { padding: tv.focusRingWidth, borderWidth: tv.focusRingWidth, borderColor: 'transparent', margin: -tv.focusRingWidth * 2 }
    : { padding: 2, borderWidth: 2, borderColor: 'transparent', margin: -4 },
  focused: isTV ? { borderColor: '#FFFFFF', transform: [{ scale: tv.focusScale }] } : { borderColor: '#FFFFFF' },
});
