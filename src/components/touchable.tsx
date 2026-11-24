import { type ComponentRef, createContext, type ReactNode, type Ref, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { NavigationContext } from 'expo-router/build/react-navigation/core/index';
import Animated, { Easing, type SharedValue, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { forgetContentFocus, noteControlFocus, noteControlMounted, notePreferredControl, rememberContentFocus, TvPageContext, tvPageFocus } from '@/features/tv/focus';
import { focusFromKeyboard } from '@/lib/input-modality';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { mediaColors, motion, tv, tvm, u, useTheme, webPressable } from '@/theme';

import { type MenuEvent, takesContextMenu } from './context-menu';

export type TouchKind = 'tile' | 'button' | 'icon' | 'row' | 'plain';

export interface TouchState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Feedback style (design system §6.2 and §7.3). */
  kind?: TouchKind;
  /** Corner radius of the element, for the overlay and the focus ring. */
  radius?: number;
  /** Style of the element itself (layout, background). */
  style?: StyleProp<ViewStyle> | ((s: TouchState) => StyleProp<ViewStyle>);
  /** Style of the outer press area (flex, margins). */
  containerStyle?: StyleProp<ViewStyle>;
  children?: ReactNode | ((s: TouchState) => ReactNode);
  /**
   * Draw the focus ring on keyboard focus. Default true. TV rows never get a
   * ring: they get the row fill instead (one focus mark per control).
   */
  ring?: boolean;
  /**
   * TV: this control takes the first focus of its page (the first tile of a
   * grid or row). In an Android TV tab page the page gives it the focus;
   * elsewhere it is `hasTVPreferredFocus`.
   */
  firstFocus?: boolean;
  /**
   * Drop a second press within `REPEAT_PRESS_MS`, so a double tap does not
   * open a page twice. Default true for tiles and rows; buttons keep fast
   * repeats (skip, next).
   */
  single?: boolean;
  /**
   * TV Modern: the scale of this control with the focus (default `tvm.size.focusScale` for a tile).
   * A Modern button or icon control grows only when it passes it. Classic ignores it.
   */
  focusScale?: number;
  ref?: Ref<ComponentRef<typeof View>>;
}

const STANDARD = Easing.bezier(...motion.easing.standard);

/** Web and the Mac app (not the TV preview): a right click runs the long press (context-menu.ts). */
const rightClickIsLongPress = Platform.OS === 'web' && !isTV;

/**
 * TV: the focus mark of the nearest Touchable (1 focused, 0 not), for content
 * that changes its look on focus on the UI thread with no React render (the
 * tile caption). Null off TV and outside a Touchable.
 */
export const TouchFocusMark = createContext<SharedValue<number> | null>(null);

/** TV: the shared value behind the focus mark. Other platforms make none (they keep the state path). */
const useContentMark: (mark: SharedValue<number> | null, disabled: boolean) => SharedValue<number> | null = isTV
  ? (mark, disabled) => useDerivedValue(() => (disabled || !mark ? 0 : mark.get()))
  : () => null;
const useFocusMark: () => SharedValue<number> | null = isTV ? () => useSharedValue(0) : () => null;

/**
 * TV Modern (design system §7.22): the focus mark fades in 180 ms and out in
 * 140 ms, the focus scale is 1.08, and the ring is 4 u wide with a 4 u gap.
 * Classic keeps the mark at once, 1.06 and 3 pt.
 */
const MODERN = isTV && isTvModern;
const TV_RING_WIDTH = MODERN ? u(tvm.size.ringWidth) : tv.focusRingWidth;
const TV_RING_GAP = MODERN ? u(tvm.size.ringGap) : tv.focusRingGap;
const TV_RING_COLOR = MODERN ? tvm.color.ring : mediaColors.white;
const TV_ROW_RADIUS = u(tvm.size.listRowRadius);

/** Sets the focus mark: at once in Classic and with Reduce Motion, a short fade in Modern. */
function setMark(mark: SharedValue<number> | null, on: boolean, reduced: boolean): void {
  if (!mark) return;
  if (!MODERN || reduced) {
    mark.set(on ? 1 : 0);
    return;
  }
  mark.set(withTiming(on ? 1 : 0, { duration: on ? tvm.motion.focus : tvm.motion.blur, easing: STANDARD }));
}

/** A tile or row ignores a second press this soon after the first. */
const REPEAT_PRESS_MS = 600;

function pressScale(kind: TouchKind): number {
  if (kind === 'tile') return motion.press.tileScale;
  if (kind === 'icon') return motion.press.buttonScale;
  if (kind === 'button') return 0.98;
  return 1;
}

/**
 * Press, hover and focus feedback for every control. Feedback starts on
 * press-in; the release settles with the `snappy` spring. Tiles lift on hover
 * and focus (scale + `raised` shadow); the focus ring is 2 pt `focusRing`
 * with a 2 pt gap. TV shows exactly one focus mark per control (design
 * system §7.19): tiles, buttons, chips and icon buttons get a white ring and
 * the focus scale (no shadow); rows get the TV row fill under their content,
 * with no ring and no scale. The last focused control is remembered for the
 * side menu (features/tv/focus).
 * Android TV: a control on a page that is not visible (a page under the
 * open one) gives the focus to the visible page at once, and a control that
 * mounts on the visible page takes a focus that was lost (features/tv/focus).
 * Reduce Motion keeps the overlays and drops the scale.
 * A double tap must not open a page twice. A press on a screen that is no
 * longer the focused one is dropped, and a tile or row drops a second press
 * within `REPEAT_PRESS_MS` (the new page may not be in the navigation state
 * yet when the second tap comes).
 * Web and the Mac app: a right click on a control with `onLongPress` runs it
 * and hides the browser menu (context-menu.ts).
 * TV: a focus move does no React work. The ring (or the row fill) is always
 * mounted and shows by opacity, and the scale runs, both from shared values
 * on the UI thread. Only a control whose `children` or `style` is a function
 * (it reads the state) re-renders on focus.
 */
export function Touchable({
  kind = 'plain',
  radius = 0,
  style,
  containerStyle,
  children,
  ring = true,
  firstFocus = false,
  single,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  onLongPress,
  onPress,
  disabled,
  focusScale,
  ref,
  ...rest
}: TouchableProps) {
  const t = useTheme();
  // The screen this control is on; null outside a navigator (the root hosts).
  const nav = useContext(NavigationContext);
  // When this tile or row last ran its press (a ref: two taps in one frame both see old state).
  const lastPress = useRef(0);
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The real focus, for the scale in the press and hover handlers (the state may not follow it on TV).
  const focusedNow = useRef(false);
  // TV: 1 while the control shows its focus mark (ring or row fill).
  const mark = useFocusMark();
  // TV: what the content (caption strip, dark text) reads. A disabled control stays at rest.
  const contentMark = useContentMark(mark, !!disabled);
  const page = useContext(TvPageContext);
  // A function child or style reads the state, so it needs the re-render on focus.
  const readsState = typeof children === 'function' || typeof style === 'function';
  const state: TouchState = { pressed, hovered, focused };

  // TV: keep a handle on the view, so the side menu can give the focus back to it.
  const own = useRef<ComponentRef<typeof View> | null>(null);
  const setRef = useCallback(
    (v: ComponentRef<typeof View> | null) => {
      own.current = v;
      if (typeof ref === 'function') ref(v);
      else if (ref) (ref as { current: ComponentRef<typeof View> | null }).current = v;
    },
    [ref],
  );
  useEffect(() => {
    const box = own;
    return () => forgetContentFocus(box.current);
  }, []);
  // Android TV: content that loads late takes the focus from a page under this one.
  useEffect(() => {
    if (isTV && !disabled) noteControlMounted(page);
  }, [page, disabled]);
  // Android TV: in a tab page, the page gives the first focus (features/tv/focus).
  const pageFirst = tvPageFocus && !!page && firstFocus && !disabled;
  useEffect(() => {
    if (!pageFirst) return;
    const view = own.current;
    notePreferredControl(page, view, true);
    return () => notePreferredControl(page, view, false);
  }, [page, pageFirst]);

  // Modern: a button or icon control shows the focus plate and does not grow, unless it asks (`focusScale`).
  const lifts = kind === 'tile' || (isTV && kind !== 'row' && kind !== 'plain' && (!MODERN || focusScale !== undefined));
  const restScale = (h: boolean, f: boolean) => {
    if (reduced || !lifts) return 1;
    if (f && isTV) return MODERN ? (focusScale ?? tvm.size.focusScale) : tv.focusScale;
    return h || f ? motion.press.hoverScale : 1;
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const ringWidth = isTV ? TV_RING_WIDTH : 2;
  const ringGap = isTV ? TV_RING_GAP : 2;
  // TV rows: the fill is the only focus mark (a ring on top of a fill read as two).
  const tvRow = isTV && kind === 'row';
  const showRing = ring && !tvRow && focused && !disabled;
  const lifted = lifts && (hovered || focused) && !disabled;

  const inner = typeof style === 'function' ? style(state) : style;

  // react-native-web passes `onContextMenu` to the element; the prop is not in the native types.
  const contextMenu =
    rightClickIsLongPress && onLongPress
      ? {
          onContextMenu: (e: MenuEvent & { preventDefault: () => void }) => {
            if (!takesContextMenu(e, { longPress: true, disabled: !!disabled })) return;
            e.preventDefault();
            onLongPress(e as unknown as GestureResponderEvent);
          },
        }
      : null;

  return (
    <Pressable
      ref={setRef}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={
        onPress
          ? (e) => {
              // A second fast tap on a tile that opened a page lands on the page under it: drop it.
              if (nav && !nav.isFocused()) return;
              // The new page may not be in the navigation state yet, so a tile or row also drops a quick repeat.
              if (single ?? (kind === 'tile' || kind === 'row')) {
                const now = Date.now();
                if (now - lastPress.current < REPEAT_PRESS_MS) return;
                lastPress.current = now;
              }
              onPress(e);
            }
          : undefined
      }
      {...contextMenu}
      onPressIn={(e) => {
        setPressed(true);
        if (!reduced) scale.set(withTiming(pressScale(kind), { duration: motion.duration.press, easing: STANDARD }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        scale.set(withSpring(restScale(hovered, focusedNow.current), motion.spring.snappy));
        onPressOut?.(e);
      }}
      onHoverIn={(e) => {
        setHovered(true);
        scale.set(withTiming(restScale(true, focusedNow.current), { duration: motion.duration.fast, easing: STANDARD }));
        onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setHovered(false);
        scale.set(withTiming(restScale(false, focusedNow.current), { duration: motion.duration.fast, easing: STANDARD }));
        onHoverOut?.(e);
      }}
      onFocus={(e) => {
        if (isTV && noteControlFocus(page, true)) return;
        const visible = focusFromKeyboard();
        focusedNow.current = visible;
        if (!isTV || readsState) setFocused(visible);
        if (isTV) {
          setMark(mark, visible, reduced);
          rememberContentFocus(own.current);
        }
        if (visible) scale.set(withTiming(restScale(hovered, true), { duration: MODERN ? tvm.motion.focus : motion.duration.fast, easing: STANDARD }));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (isTV) {
          noteControlFocus(page, false);
          setMark(mark, false, reduced);
        }
        focusedNow.current = false;
        if (!isTV || readsState) setFocused(false);
        scale.set(withTiming(restScale(hovered, false), { duration: MODERN ? tvm.motion.blur : motion.duration.fast, easing: STANDARD }));
        onBlur?.(e);
      }}
      accessibilityState={{ disabled: !!disabled, ...rest.accessibilityState }}
      style={[webPressable, disabled && styles.disabled, containerStyle]}
      {...rest}
      hasTVPreferredFocus={(firstFocus && isTV && !pageFirst) || rest.hasTVPreferredFocus}>
      {/* TV: no shadow; an elevation shadow under a scaling tile is slow on a TV stick. */}
      <Animated.View style={[inner, animated, lifted && !isTV && t.shadow('raised')]}>
        {/* Under the content, over the row's own background. */}
        {mark && tvRow ? <TvMark mark={mark} disabled={!!disabled} style={[StyleSheet.absoluteFill, styles.tvRowFill, { borderRadius: MODERN ? TV_ROW_RADIUS : radius }]} /> : null}
        {mark ? (
          <TouchFocusMark value={contentMark}>{typeof children === 'function' ? children(state) : children}</TouchFocusMark>
        ) : typeof children === 'function' ? (
          children(state)
        ) : (
          children
        )}
        {kind === 'tile' || kind === 'button' || kind === 'icon' ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: radius },
              pressed ? styles.pressOverlay : hovered && !isTV ? styles.hoverOverlay : null,
            ]}
          />
        ) : null}
        {mark ? (
          ring && !tvRow ? <TvMark mark={mark} disabled={!!disabled} style={[styles.ring, ringBox(radius, ringGap, ringWidth), { borderColor: TV_RING_COLOR }]} /> : null
        ) : showRing ? (
          <View pointerEvents="none" style={[styles.ring, ringBox(radius, ringGap, ringWidth), { borderColor: t.c.focusRing }]} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/** The ring's box: a gap outside the control, then the ring. */
function ringBox(radius: number, gap: number, width: number): ViewStyle {
  const out = -(gap + width);
  return { top: out, left: out, right: out, bottom: out, borderRadius: radius + gap + width, borderWidth: width };
}

/**
 * TV: a focus mark (ring or row fill) that is always mounted and shows by
 * opacity from the shared value, so a focus move needs no React render.
 */
function TvMark({ mark, disabled, style }: { mark: SharedValue<number>; disabled: boolean; style: StyleProp<ViewStyle> }) {
  const shown = useAnimatedStyle(() => ({ opacity: disabled ? 0 : mark.get() }));
  return <Animated.View pointerEvents="none" style={[style, shown]} />;
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  pressOverlay: { backgroundColor: mediaColors.pressOverlay },
  hoverOverlay: { backgroundColor: mediaColors.hoverOverlay },
  ring: { position: 'absolute' },
  tvRowFill: { backgroundColor: MODERN ? tvm.color.rowFocus : mediaColors.tvRowFocus },
});
