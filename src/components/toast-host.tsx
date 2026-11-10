import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Glass } from '@/features/player/glass';
import { focusActivePage, focusView } from '@/features/tv/focus';
import { useTvBack } from '@/features/tv/use-tv-back';
import { isNativeTV, isTV } from '@/platform/tv';
import { toastDuration, toastLook, toastTakesFocus, useToastStore } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { Icon } from './icon';
import { Touchable } from './touchable';

/**
 * Toasts (design system §7.14): a glass capsule at the top, under the status
 * bar (top trailing on wide windows), so it never covers the tab bar or the
 * mini player. It slides 12 pt and fades in with the `smooth` spring, fades
 * out in 160 ms, and a swipe up dismisses it.
 *
 * The root layout has one host. A full-screen player is a native modal over
 * the root view, so it mounts its own host with `overlay`; while an overlay
 * host is mounted, the root host shows nothing. `offset` moves the toast
 * down, under the player's top controls.
 *
 * TV (root host): an action toast takes the focus when it shows (not from a
 * text field), stays while its action has the focus, and Back closes it.
 * The focus then goes back to the page. Overlay hosts (the players) only
 * keep it up longer: their remote keys must stay with the player.
 */
export function ToastHost({ overlay = false, offset = 0 }: { overlay?: boolean; offset?: number }) {
  const overlays = useToastStore((st) => st.overlays);
  const addOverlay = useToastStore((st) => st.addOverlay);
  const removeOverlay = useToastStore((st) => st.removeOverlay);
  const shown = useToastStore((st) => st.current);
  const current = overlay || overlays === 0 ? shown : null;
  const hide = useToastStore((st) => st.hide);
  const insets = useSafeAreaInsets();
  const l = useLayout();
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  // In a player the toast is over video: dark glass and light text in any app theme.
  const look = toastLook(overlay, c);
  const actionRef = useRef<ComponentRef<typeof View> | null>(null);
  // The toast whose action has the focus (a toast that replaces it starts unfocused).
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const tvFocus = isTV && !overlay;
  const actionFocused = !!current && focusedId === current.id;
  const y = useSharedValue(-12);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!overlay) return;
    addOverlay();
    return removeOverlay;
  }, [overlay, addOverlay, removeOverlay]);

  useEffect(() => {
    if (!current) return;
    y.set(-12);
    opacity.set(0);
    y.set(withSpring(0, motion.spring.smooth));
    opacity.set(withTiming(1, { duration: motion.duration.fast }));
    AccessibilityInfo.announceForAccessibility(current.text);
  }, [current, y, opacity]);

  // TV: the action takes the focus when the toast shows.
  useEffect(() => {
    if (!current || !tvFocus || !toastTakesFocus(current, isNativeTV, !!TextInput.State.currentlyFocusedInput())) return;
    const t = setTimeout(() => focusView(actionRef.current), 50);
    return () => clearTimeout(t);
  }, [current, tvFocus]);

  // The toast closes after its time, but never while its action has the focus.
  useEffect(() => {
    if (!current || actionFocused) return;
    const id = current.id;
    const t = setTimeout(() => hide(id), toastDuration(current, isTV));
    return () => clearTimeout(t);
  }, [current, hide, actionFocused]);

  /** Closes the toast; a focus it had goes back to the page. */
  const close = (id: number | undefined) => {
    const hadFocus = actionFocused;
    setFocusedId(null);
    hide(id);
    if (hadFocus && tvFocus) setTimeout(() => focusActivePage(), 50);
  };
  useTvBack(tvFocus && actionFocused, () => close(current?.id));

  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));

  const swipe = Gesture.Pan()
    .activeOffsetY(-6)
    .onUpdate((e) => {
      y.set(Math.min(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY < -16 || e.velocityY < -400) {
        const id = current?.id;
        scheduleOnRN(hide, id);
      } else {
        y.set(withSpring(0, { ...motion.spring.smooth, velocity: e.velocityY }));
      }
    });

  if (!current) return null;
  const wide = l.bp !== 'compact';
  return (
    <View
      pointerEvents="box-none"
      style={[s.host, { top: insets.top + spacing.sm + offset }, wide ? { right: l.gutter, alignItems: 'flex-end' } : s.centered]}>
      <GestureDetector gesture={swipe}>
        {/* The fade-out sits on a wrapper, so it does not fight the swipe style's opacity. */}
        <Animated.View key={current.id} exiting={FadeOut.duration(motion.duration.fast)}>
          <Animated.View style={[s.shadow, style]}>
          <Glass variant="regular" scheme={look.glass} style={s.capsule}>
            <View style={s.row} accessibilityLiveRegion="polite" accessibilityRole={Platform.OS === 'web' ? 'alert' : undefined}>
              {current.icon ? <Icon name={current.icon} size={scaled(iconSize.sm)} color={look.text} /> : null}
              <Text style={[s.text, { color: look.text }]} numberOfLines={2}>
                {current.text}
              </Text>
              {current.action ? (
                <Touchable
                  ref={actionRef}
                  onFocus={() => setFocusedId(current.id)}
                  onBlur={() => setFocusedId(null)}
                  onPress={() => {
                    current.action?.onPress();
                    close(current.id);
                  }}
                  hitSlop={8}
                  radius={8}
                  accessibilityRole="button"
                  accessibilityLabel={current.action.label}>
                  <Text style={s.action}>{current.action.label}</Text>
                </Touchable>
              ) : null}
            </View>
          </Glass>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  host: { position: 'absolute' as const, left: 0, right: 0, zIndex: 1000 },
  centered: { alignItems: 'center' as const, paddingHorizontal: spacing.lg },
  shadow: { borderRadius: radius.pill, maxWidth: scaled(sizes.toastMaxWidth), ...shadow('floating') },
  capsule: { borderRadius: radius.pill, overflow: 'hidden' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    minHeight: scaled(sizes.toastMinHeight),
    paddingHorizontal: scaled(spacing.lg),
    paddingVertical: spacing.sm,
  },
  text: { ...font(type.subheadline), fontWeight: '500' as const, color: c.text, flexShrink: 1 },
  action: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent },
}));
