/**
 * The "An update is ready" card for over-the-air updates (iPhone, iPad,
 * Android, TV). State: `src/platform/updates/ota.ts`; the host
 * (`./update-card.tsx`) decides when it shows (`chooseUpdateCard`).
 *
 * - Small and not modal: the page under it stays usable. Phones: across the
 *   bottom, above the tab bar and the mini player. Wide windows: bottom
 *   trailing, width 340. On phones and computers it never takes the focus by
 *   itself; after a manual check, "Restart now" (or "Try again") takes it.
 * - TV: a centred popup (`Sheet`) that holds the remote's focus, with
 *   "Restart now" focused. A card in the corner was easy to miss and hard to
 *   reach with the D-pad. "Snooze" (and Back) hides it for an hour
 *   (`snoozeOta`); it still waits while something plays or a player is open.
 * - "Restart now" asks first while video or audio plays. "Later" hides the
 *   card for this update; the update still starts on the next cold start.
 */
import { type ComponentRef, useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, Text, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { Touchable } from '@/components/touchable';
import { confirmDestructive } from '@/lib/confirm';
import { ACCESSORY_HEIGHT, FLOATING_MINI_HEIGHT, HAS_ACCESSORY, TAB_BAR_HEIGHT } from '@/lib/tab-bar-inset';
import { isTV } from '@/platform/tv';
import type { UpdateState } from '@/platform/updates/machine';
import { closeOtaCard, laterOta, restartOta, retryOta, snoozeOta } from '@/platform/updates/ota';
import { restartNeedsConfirm, shortMessage } from '@/platform/updates/ota-rules';
import { playerState, usePlayerStore } from '@/player/store';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

/** "Up to date" closes by itself after this time. */
const CURRENT_CLOSE_MS = 4000;
const CARD_WIDTH = 340;
const ERROR_MAX = 160;

/** "Restart now" (the card and the Settings row): asks first while something plays. */
export async function restartForUpdate(): Promise<void> {
  const { playing } = playerState();
  if (restartNeedsConfirm({ playing, playerOpen: false })) {
    const ok = await confirmDestructive('Restart Zoggyfin now?', 'Playback stops. Zoggyfin restarts with the update.', 'Restart now');
    if (!ok) return;
  }
  await restartOta();
}

/** The bottom offset of the card: clear of the tab bar and the mini player. */
function useBottom(wide: boolean): number {
  const safeBottom = useSafeAreaInsets().bottom;
  const mini = usePlayerStore((st) => !!st.now && st.presentation === 'mini');
  if (Platform.OS === 'web' && wide) return FLOATING_MINI_HEIGHT + spacing.lg * 2;
  const miniHeight = mini ? (HAS_ACCESSORY ? ACCESSORY_HEIGHT : FLOATING_MINI_HEIGHT + spacing.sm) : 0;
  // iOS 26 floats a taller tab bar; the extra gap keeps the card clear of it.
  const bar = HAS_ACCESSORY ? TAB_BAR_HEIGHT + spacing.lg : TAB_BAR_HEIGHT;
  return Math.max(safeBottom, spacing.sm) + bar + miniHeight + spacing.sm;
}

export function OtaUpdateCard({ state }: { state: UpdateState }) {
  return isTV ? <TvOtaPopup state={state} /> : <OtaCorner state={state} />;
}

/** TV: Back snoozes a ready update, closes anything else (never during the restart). */
function TvOtaPopup({ state }: { state: UpdateState }) {
  const onBack = () => {
    if (state.phase.kind === 'installing') return;
    if (state.phase.kind === 'ready') snoozeOta();
    else closeOtaCard();
  };
  return (
    <Sheet visible onClose={onBack}>
      <OtaBody state={state} tv />
    </Sheet>
  );
}

function OtaCorner({ state }: { state: UpdateState }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const wide = l.bp !== 'compact';
  const bottom = useBottom(wide);
  const y = useSharedValue(12);
  const opacity = useSharedValue(0);

  useEffect(() => {
    y.set(withSpring(0, { ...motion.spring.smooth, reduceMotion: ReduceMotion.System }));
    opacity.set(withTiming(1, { duration: motion.duration.base }));
  }, [y, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  const place = wide ? { right: l.gutter, width: scaled(CARD_WIDTH) } : { left: l.gutter, right: l.gutter };

  return (
    <View pointerEvents="box-none" style={[s.host, place, { bottom }]}>
      <Animated.View exiting={FadeOut.duration(motion.duration.fast)} style={[s.shadow, style]}>
        <View style={s.card}>
          <OtaBody state={state} tv={false} />
        </View>
      </Animated.View>
    </View>
  );
}

/** The content: the same in the corner card and in the TV popup. */
function OtaBody({ state, tv }: { state: UpdateState; tv: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const actionsRef = useRef<ComponentRef<typeof View>>(null);
  const { phase, offer, manual } = state;
  // TV: the main button always takes the remote's focus (the popup holds it).
  const focusMain = tv || manual;

  const title = titleFor(state);
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  // Web: after a manual check the main button takes the focus (TV: `preferredFocus`).
  useEffect(() => {
    if (!manual || Platform.OS !== 'web') return;
    const buttons = (actionsRef.current as unknown as HTMLElement | null)?.querySelectorAll?.<HTMLElement>('[role="button"]');
    buttons?.[buttons.length - 1]?.focus();
  }, [manual, phase.kind]);

  useEffect(() => {
    if (phase.kind !== 'current') return;
    const t = setTimeout(closeOtaCard, CURRENT_CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase.kind]);

  const message = offer?.notes[0] ?? null;
  const error = phase.kind === 'error' ? (shortMessage(phase.message, ERROR_MAX) ?? 'Unknown error.') : null;

  return (
        <View style={s.body} role="dialog" aria-modal={tv} accessibilityLabel={title} accessibilityLiveRegion="polite">
          <View style={s.header}>
            <View style={[s.badge, phase.kind === 'error' && s.badgeError]}>
              <Icon name={iconFor(state)} size={scaled(iconSize.sm)} color={phase.kind === 'error' ? c.danger : c.accent} />
            </View>
            <View style={s.headerText}>
              <Text style={s.title} numberOfLines={2}>
                {title}
              </Text>
              <Text style={s.subtitle} numberOfLines={3}>
                {subtitleFor(state)}
              </Text>
            </View>
            {phase.kind === 'current' && !tv ? (
              <Touchable onPress={closeOtaCard} hitSlop={8} radius={radius.pill} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="xmark.circle.fill" size={scaled(iconSize.md)} color={c.text3} />
              </Touchable>
            ) : null}
          </View>

          {message && (phase.kind === 'ready' || phase.kind === 'installing') ? (
            <Text style={s.message} numberOfLines={3}>
              {message}
            </Text>
          ) : null}

          {error ? (
            <Text style={s.error} numberOfLines={3}>
              {error}
            </Text>
          ) : null}

          {phase.kind === 'checking' || phase.kind === 'available' || phase.kind === 'downloading' || phase.kind === 'installing' ? (
            <View style={s.busy}>
              <ActivityIndicator size="small" color={c.text2} />
              <Text style={s.busyText}>{phase.kind === 'checking' ? 'Checking…' : phase.kind === 'installing' ? 'Restarting…' : 'Downloading…'}</Text>
            </View>
          ) : null}

          {phase.kind === 'available' || phase.kind === 'downloading' ? (
            <View ref={actionsRef} style={s.actions}>
              <Button variant="smallTonal" title="Hide" onPress={closeOtaCard} />
            </View>
          ) : null}
          {phase.kind === 'ready' ? (
            <View ref={actionsRef} style={s.actions}>
              {tv ? <Button variant="smallTonal" title="Snooze" onPress={() => snoozeOta()} /> : <Button variant="smallTonal" title="Later" onPress={laterOta} />}
              <Button variant="small" title="Restart now" onPress={() => void restartForUpdate()} preferredFocus={focusMain} />
            </View>
          ) : null}
          {phase.kind === 'error' ? (
            <View ref={actionsRef} style={s.actions}>
              <Button variant="smallTonal" title={offer ? 'Later' : 'Close'} onPress={offer ? laterOta : closeOtaCard} />
              <Button variant="small" title="Try again" onPress={retryOta} preferredFocus={focusMain} />
            </View>
          ) : null}
          {tv && (phase.kind === 'current' || phase.kind === 'checking') ? (
            <View style={s.actions}>
              <Button variant="small" title="Close" onPress={closeOtaCard} preferredFocus />
            </View>
          ) : null}
        </View>
  );
}

function titleFor(state: UpdateState): string {
  const { phase } = state;
  switch (phase.kind) {
    case 'checking':
      return 'Checking for updates';
    case 'current':
      return 'Zoggyfin is up to date';
    case 'available':
    case 'downloading':
      return 'Downloading an update';
    case 'ready':
      return 'An update is ready';
    case 'installing':
      return 'Restarting Zoggyfin';
    case 'error':
      return phase.step === 'check' ? 'Cannot check for updates' : phase.step === 'download' ? 'The update did not download' : 'Zoggyfin did not restart';
    default:
      return 'Updates';
  }
}

function subtitleFor(state: UpdateState): string {
  const { phase } = state;
  switch (phase.kind) {
    case 'checking':
      return `Current: ${state.current}.`;
    case 'current':
      return 'You have the newest update.';
    case 'available':
    case 'downloading':
      return 'You can continue to use Zoggyfin.';
    case 'ready':
      return 'Restart to use it now. If you do not, it starts the next time you open Zoggyfin.';
    case 'installing':
      return 'Zoggyfin opens again in a moment.';
    case 'error':
      if (phase.step === 'check') return 'Make sure that this device is online, then try again.';
      if (phase.step === 'download') return 'Nothing changed. Try again later.';
      return 'The update starts the next time you open Zoggyfin.';
    default:
      return '';
  }
}

function iconFor(state: UpdateState) {
  switch (state.phase.kind) {
    case 'error':
      return 'exclamationmark.triangle' as const;
    case 'current':
      return 'checkmark.circle.fill' as const;
    case 'ready':
    case 'installing':
      return 'arrow.clockwise' as const;
    default:
      return 'arrow.down.circle' as const;
  }
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  host: { position: 'absolute' as const, zIndex: 900 },
  shadow: { borderRadius: radius.lg, ...shadow('floating') },
  // Solid, not glass: the text must stay legible over artwork.
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden' as const,
    borderCurve: 'continuous' as const,
    backgroundColor: c.surface,
    borderWidth: sizes.hairline,
    borderColor: c.separator,
    padding: spacing.lg,
  },
  body: { gap: spacing.md },
  header: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.md },
  badge: {
    width: scaled(sizes.settingsIcon),
    height: scaled(sizes.settingsIcon),
    borderRadius: sizes.settingsIconRadius,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  badgeError: { backgroundColor: c.surface3 },
  headerText: { flex: 1, gap: spacing.xxs },
  title: { ...font(type.headline), color: c.text },
  subtitle: { ...font(type.footnote), color: c.text2 },
  message: { ...font(type.subheadline), color: c.text },
  error: { ...font(type.footnote), color: c.danger },
  busy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  busyText: { ...font(type.footnote), color: c.text2 },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: spacing.sm },
}));
