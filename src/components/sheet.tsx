import { type ReactNode, useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useWindowFrame } from '@/lib/use-window-frame';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, motion, radius, scaled, sizes, spacing, tvFont, tvm, type, u, useStyles } from '@/theme';

import { Button } from './button';
import { shouldDismiss } from './sheet-dismiss';
import { MODAL_ORIENTATIONS, sheetHeight } from './sheet-layout';
import { Touchable } from './touchable';

const ENTER = Easing.bezier(...motion.easing.enter);

/**
 * TV Modern (design system §7.22): the same centred panel with radius 28 u,
 * a 36 u title, list rows (the soft focus fill, no card, no lines) and
 * "Done" as a text action. No layout animation (`entering`, `exiting`): it
 * costs frames on TV hardware.
 */
const MODERN = isTV && isTvModern;

/**
 * A bottom sheet (web and phone; a centred panel on TV). The scrim fades,
 * the panel moves up from the bottom edge and leaves the same way, faster.
 * A drag down on the grabber or the header closes it through `onClose`,
 * the same path as Done, the scrim and the back button, so the caller's
 * open state always follows.
 */
export function Sheet({
  visible,
  title,
  onClose,
  doneLabel,
  fixedHeight = false,
  children,
}: {
  visible: boolean;
  title?: string | null;
  onClose: () => void;
  /** A trailing text button in the header (for example "Done"). */
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
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent supportedOrientations={MODAL_ORIENTATIONS}>
      {/*
        Its own safe area: the modal covers the whole window, but the screen
        under it (a tab page) reports the tab bar in its bottom inset. That
        inset left a blank band under the content and cut the list short.
      */}
      <SafeAreaProvider>
        <SheetPanel visible={visible} title={title} onClose={onClose} doneLabel={doneLabel} fixedHeight={fixedHeight}>
          {children}
        </SheetPanel>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetPanel({
  visible,
  title,
  onClose,
  doneLabel,
  fixedHeight,
  children,
}: {
  visible: boolean;
  title?: string | null;
  onClose: () => void;
  doneLabel?: string;
  fixedHeight: boolean;
  children: ReactNode;
}) {
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // The modal's own frame: it follows a rotation in the same render as the insets.
  const frame = useWindowFrame();
  const maxHeight = sheetHeight(frame.height, insets.top);
  const drag = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.get() }],
  }));
  // A sheet that stays mounted starts at rest each time it shows.
  useEffect(() => {
    if (visible) drag.set(0);
  }, [visible, drag]);
  const swipe = Gesture.Pan()
    .enabled(!isTV)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onUpdate((e) => drag.set(Math.max(0, e.translationY)))
    .onEnd((e) => {
      if (shouldDismiss(e.translationY, e.velocityY)) scheduleOnRN(onClose);
      else drag.set(withSpring(0, { damping: 24, stiffness: 260 }));
    });
  // Android: a Modal is its own window and needs its own gesture root.
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <Animated.View entering={MODERN ? undefined : FadeIn.duration(motion.duration.base)} exiting={MODERN ? undefined : FadeOut.duration(motion.duration.fast)} style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" focusable={false} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.host, isTV && s.hostTV]} pointerEvents="box-none">
        <Animated.View
          entering={MODERN ? undefined : SlideInDown.duration(motion.duration.base).easing(ENTER)}
          exiting={MODERN ? undefined : SlideOutDown.duration(motion.duration.fast)}
          style={[s.panel, isTV ? [s.panelTV, MODERN && s.panelModern] : { paddingBottom: insets.bottom + spacing.md, maxHeight }, fixedHeight && !isTV && { height: maxHeight }, dragStyle]}
          accessibilityViewIsModal>
          <GestureDetector gesture={swipe}>
            <View>
              {isTV ? null : <View style={s.grabber} />}
              {title || doneLabel ? (
                <View style={[s.header, MODERN && s.headerModern]}>
                  <Text style={[s.title, MODERN && s.titleModern]} numberOfLines={1} accessibilityRole="header">
                    {title}
                  </Text>
                  {doneLabel && MODERN ? (
                    <Button title={doneLabel} variant="text" onPress={onClose} />
                  ) : doneLabel ? (
                    <Touchable onPress={onClose} hitSlop={10} radius={8} accessibilityRole="button" accessibilityLabel={doneLabel}>
                      <Text style={s.done}>{doneLabel}</Text>
                    </Touchable>
                  ) : null}
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

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  host: { flex: 1, justifyContent: 'flex-end' as const },
  hostTV: { justifyContent: 'center' as const, alignItems: 'center' as const },
  panel: {
    alignSelf: 'center' as const,
    width: '100%' as const,
    maxWidth: sizes.sheetMaxWidth,
    backgroundColor: c.bgGrouped,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    borderCurve: 'continuous' as const,
    ...shadow('overlay'),
  },
  panelTV: { maxWidth: scaled(sizes.sheetMaxWidth), borderRadius: radius.xxl, padding: scaled(spacing.xxl) },
  grabber: { alignSelf: 'center' as const, width: 36, height: 5, borderRadius: 3, backgroundColor: c.surface3, marginTop: spacing.sm, marginBottom: spacing.sm },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  title: { ...font(type.headline), color: c.text, flex: 1 },
  done: { ...font(type.headline), color: c.accent },
  row: { backgroundColor: c.surface, paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface3 },
  rowInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 6),
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
