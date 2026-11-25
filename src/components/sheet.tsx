import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, type LayoutChangeEvent, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useWindowFrame } from '@/lib/use-window-frame';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, sizes, spacing, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

import { Button } from './button';
import { Icon } from './icon';
import { shouldDismiss } from './sheet-dismiss';
import { MODAL_ORIENTATIONS, sheetHeight } from './sheet-layout';
import { modalUp, nextPhase, nextSheetId, type SheetEvent, type SheetPhase, sheetTurns } from './sheet-turns';
import { Touchable } from './touchable';

const EXIT = Easing.bezier(...motion.easing.exit);
/** The exit: short, so the app under the sheet answers again soon. */
const EXIT_MS = 200;
/** If the exit animation never reports its end, the sheet still goes after this. */
const EXIT_LIMIT_MS = 500;
/** After the modal is told to go, the next sheet waits this long for the native side. */
const GONE_MS = 80;

/**
 * TV Modern (design system §7.22): the same centred panel with radius 28 u,
 * a 36 u title, list rows (the soft focus fill, no card, no lines) and
 * "Done" as a text action. It shows and goes at once, with no fade: motion
 * costs frames on TV hardware.
 */
const MODERN = isTV && isTvModern;

/**
 * The value while `live`, then the last live value. A caller often clears
 * its content in the same render that closes the sheet (the menu's rows, the
 * item). The sheet leaves with an animation, and it must not leave empty.
 */
function useHeld<T>(value: T, live: boolean): T {
  const [held, setHeld] = useState(value);
  if (live && !Object.is(held, value)) setHeld(value);
  return live ? value : held;
}

/**
 * A sheet: a rounded panel that floats above the bottom edge (web and phone;
 * a centred panel on TV). The scrim fades and the panel rises with a spring;
 * both leave the same way, faster. The panel has no shadow: the scrim sets it
 * apart, and a shadow that rose ahead of the panel looked like a dark band.
 *
 * A drag down on the grabber or the header closes it through `onClose`, the
 * same path as the close button, the scrim and the back button, so the
 * caller's open state always follows.
 *
 * The phases and the rule that one sheet waits for another to leave are in
 * `sheet-turns.ts`.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  art,
  onClose,
  doneLabel,
  fixedHeight = false,
  children,
}: {
  visible: boolean;
  title?: string | null;
  /** A second line under the title (the artist of a song). */
  subtitle?: string | null;
  /** A small picture before the title (the item's art). */
  art?: ReactNode;
  onClose: () => void;
  /** A text button in the header (for example "Done") in place of the close button. */
  doneLabel?: string;
  /**
   * Keep the panel at its full height. The panel grows up from the bottom
   * edge, so a sheet whose content changes while it is open (a list that
   * fills in, a help card that shows later) would move every button under
   * the finger. A fixed height keeps the top of the content still.
   */
  fixedHeight?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<SheetPhase>('hidden');
  const [id] = useState(nextSheetId);
  const [seen, setSeen] = useState(false);
  if (seen !== visible) {
    setSeen(visible);
    setPhase(nextPhase(phase, visible ? 'open' : 'close'));
  }
  const send = useCallback((e: SheetEvent) => setPhase((p) => nextPhase(p, e)), []);
  const onLeft = useCallback(() => send('left'), [send]);

  useEffect(() => {
    if (phase === 'waiting') return sheetTurns.whenClear(() => send('clear'));
    if (phase === 'shown') {
      sheetTurns.gone(id);
      return;
    }
    if (phase === 'leaving') {
      sheetTurns.leaving(id);
      const limit = setTimeout(onLeft, EXIT_LIMIT_MS);
      return () => clearTimeout(limit);
    }
    // Hidden: the native modal goes a moment after this render. The timer is
    // not cleared: `gone` is safe to call twice, and a sheet that opens again
    // at once must not wait for itself for ever.
    setTimeout(() => sheetTurns.gone(id), GONE_MS);
  }, [phase, id, send, onLeft]);
  useEffect(() => () => sheetTurns.gone(id), [id]);

  const live = visible;
  const held = {
    title: useHeld(title, live),
    subtitle: useHeld(subtitle, live),
    art: useHeld(art, live),
    doneLabel: useHeld(doneLabel, live),
    children: useHeld(children, live),
  };
  return (
    <Modal visible={modalUp(phase)} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={MODAL_ORIENTATIONS}>
      {/*
        Its own safe area: the modal covers the whole window, but the screen
        under it (a tab page) reports the tab bar in its bottom inset. That
        inset left a blank band under the content and cut the list short.
      */}
      <SafeAreaProvider>
        <SheetPanel leaving={phase === 'leaving'} onLeft={onLeft} onClose={onClose} fixedHeight={fixedHeight} {...held} />
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetPanel({
  leaving,
  onLeft,
  title,
  subtitle,
  art,
  onClose,
  doneLabel,
  fixedHeight,
  children,
}: {
  leaving: boolean;
  onLeft: () => void;
  title?: string | null;
  subtitle?: string | null;
  art?: ReactNode;
  onClose: () => void;
  doneLabel?: string;
  fixedHeight: boolean;
  children: ReactNode;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // The modal's own frame: it follows a rotation in the same render as the insets.
  const frame = useWindowFrame();
  const maxHeight = sheetHeight(frame.height, insets.top);
  // 0 away, 1 at rest. One value moves the panel and fades the scrim.
  const open = useSharedValue(0);
  const drag = useSharedValue(0);
  // The way to travel: the panel's height, known after the first layout.
  const travel = useSharedValue(frame.height);
  useEffect(() => {
    if (MODERN) {
      // TV Modern: no motion. The panel shows and goes at once.
      open.set(leaving ? 0 : 1);
      if (leaving) onLeft();
      return;
    }
    if (leaving) {
      open.set(
        withTiming(0, { duration: EXIT_MS, easing: EXIT }, (done) => {
          if (done) scheduleOnRN(onLeft);
        }),
      );
    } else {
      // Also a sheet that comes back while it leaves.
      drag.set(withSpring(0, motion.spring.sheet));
      open.set(withSpring(1, motion.spring.sheet));
    }
  }, [leaving, open, drag, onLeft]);
  const panelStyle = useAnimatedStyle(() =>
    isTV
      ? // TV shows a panel at once, like its pages: a short fade, no move.
        { opacity: open.get() }
      : { transform: [{ translateY: (1 - open.get()) * (travel.get() + spacing.xxxl) + drag.get() }] },
  );
  // The scrim clears as the panel is dragged away.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, open.get())) * (1 - 0.6 * Math.min(1, drag.get() / Math.max(1, travel.get()))),
  }));
  const onPanelLayout = (e: LayoutChangeEvent) => travel.set(e.nativeEvent.layout.height);
  const swipe = Gesture.Pan()
    .enabled(!isTV)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onUpdate((e) => drag.set(Math.max(0, e.translationY)))
    .onEnd((e) => {
      if (shouldDismiss(e.translationY, e.velocityY)) scheduleOnRN(onClose);
      else drag.set(withSpring(0, motion.spring.sheet));
    });
  const floating = { marginBottom: Math.max(insets.bottom, spacing.sm), maxHeight };
  // Android: a Modal is its own window and needs its own gesture root.
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <Animated.View style={[s.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" focusable={false} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.host, isTV && s.hostTV]} pointerEvents="box-none">
        <Animated.View
          onLayout={onPanelLayout}
          style={[s.panel, isTV ? [s.panelTV, MODERN && s.panelModern] : floating, fixedHeight && !isTV && { height: maxHeight }, panelStyle]}
          accessibilityViewIsModal>
          <GestureDetector gesture={swipe}>
            <View>
              {isTV ? null : <View style={s.grabber} />}
              {title || doneLabel ? (
                <View style={[s.header, MODERN && s.headerModern]}>
                  {art ? <View style={s.art}>{art}</View> : null}
                  <View style={s.titles}>
                    <Text style={[s.title, MODERN && s.titleModern]} numberOfLines={1} accessibilityRole="header">
                      {title}
                    </Text>
                    {subtitle ? (
                      <Text style={s.subtitle} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {doneLabel && MODERN ? (
                    <Button title={doneLabel} variant="text" onPress={onClose} />
                  ) : doneLabel ? (
                    <Touchable onPress={onClose} hitSlop={10} radius={radius.pill} style={s.done} accessibilityRole="button" accessibilityLabel={doneLabel}>
                      <Text style={s.doneText}>{doneLabel}</Text>
                    </Touchable>
                  ) : isTV ? null : (
                    // TV: Back closes the sheet; a close stop would only be in the way.
                    <Touchable kind="icon" onPress={onClose} hitSlop={10} radius={radius.pill} style={s.close} accessibilityRole="button" accessibilityLabel="Close">
                      <Icon name="xmark" size={iconSize.xs} color={c.text2} weight="bold" />
                    </Touchable>
                  )}
                </View>
              ) : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );
}

/** A row in a sheet group. The last row in a group has no separator. */
export function SheetRow({
  children,
  onPress,
  last,
  accessibilityLabel,
  accessibilityRole = 'button',
  checked,
  preferredFocus,
}: {
  children: ReactNode;
  onPress: () => void;
  last?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio' | 'checkbox';
  checked?: boolean;
  preferredFocus?: boolean;
}) {
  const s = useStyles(makeStyles);
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={
        MODERN ? s.rowModern : ({ pressed, hovered, focused }) => [s.row, (pressed || hovered || (focused && !isTV)) && s.rowActive]
      }>
      <View style={MODERN ? s.rowInnerModern : [s.rowInner, !last && s.rowLine]}>{children}</View>
    </Touchable>
  );
}

export const makeSheetStyles = createStyles(({ c }: AppTheme) => ({
  // TV Modern: rows sit on the panel, with no card; the focus is the row fill.
  group: MODERN ? {} : { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  rowText: MODERN
    ? { ...tvFont(tvm.type.body), fontSize: u(30), lineHeight: u(36), fontWeight: '500' as const, color: c.text, flex: 1 }
    : { ...font(type.body), color: c.text, flex: 1 },
}));

const makeStyles = createStyles(({ c }: AppTheme) => ({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  host: { flex: 1, justifyContent: 'flex-end' as const, paddingHorizontal: isTV ? 0 : spacing.sm },
  hostTV: { justifyContent: 'center' as const, alignItems: 'center' as const },
  // A floating card: round on every corner, a hairline edge, no shadow.
  panel: {
    alignSelf: 'center' as const,
    width: '100%' as const,
    maxWidth: sizes.sheetMaxWidth,
    backgroundColor: c.bgGrouped,
    borderRadius: radius.xxl,
    borderCurve: 'continuous' as const,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.separator,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    overflow: 'hidden' as const,
  },
  panelTV: { maxWidth: scaled(sizes.sheetMaxWidth), maxHeight: '85%' as const, padding: scaled(spacing.xxl) },
  grabber: { alignSelf: 'center' as const, width: 36, height: 5, borderRadius: 3, backgroundColor: c.surface3, marginTop: spacing.sm, marginBottom: spacing.xs },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  art: { borderRadius: radius.sm, overflow: 'hidden' as const },
  titles: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { ...font(type.headline), color: c.text },
  subtitle: { ...font(type.subheadline), color: c.text2 },
  close: {
    width: scaled(30),
    height: scaled(30),
    borderRadius: radius.pill,
    backgroundColor: c.surface3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  done: {
    minHeight: scaled(30),
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: c.surface3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  doneText: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text },
  row: { backgroundColor: c.surface, paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface3 },
  rowInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 8),
    // Room above and below a row with a picture.
    paddingVertical: spacing.sm,
    paddingRight: spacing.lg,
  },
  rowLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  panelModern: { width: u(880), maxWidth: u(880), borderRadius: u(28), padding: u(40) },
  headerModern: { paddingHorizontal: 0, paddingVertical: 0, marginBottom: u(16), minHeight: u(tvm.size.actionHeight) },
  titleModern: { ...tvFont(tvm.type.body), fontSize: u(36), lineHeight: u(44), fontWeight: '700' as const, color: c.text },
  rowModern: { borderRadius: u(tvm.size.listRowRadius) },
  rowInnerModern: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: u(20),
    minHeight: u(tvm.size.listRowHeight),
    paddingHorizontal: u(24),
  },
}));
