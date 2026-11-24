import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { describeError } from '@/api/errors';
import { Icon, type IconName } from '@/components/icon';
import { createStyles, type AppTheme, dark, font, gridLayout, iconSize, scaled, sizes, spacing, tvFont, tvm, type, u, useLayout, useStyles, useTheme } from '@/theme';

import { Button } from './button';
import { Delayed, SkeletonBlock, SkeletonShownContext, SkeletonText } from './skeleton';
import { SHAPES, type TileShape } from './tile-shape';
import { TvPageTitle } from './tv-page-header';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';

/**
 * TV Modern look (design system §7.22): a state is a bare icon (no circle),
 * a 40 u title and one line of body text; the main button is a primary
 * action. Classic keeps the phone layout at TV scale.
 */
const MODERN = isTV && isTvModern;

function errorIcon(kind: string): IconName {
  return kind === 'network' || kind === 'timeout' || kind === 'offline' ? 'wifi.exclamationmark' : 'exclamationmark.triangle';
}

/**
 * A failed request (design system §7.13). Whole screen: icon, a plain title,
 * the reason and a Retry button. `compact` is the inline row version.
 */
export function ErrorState({
  error,
  onRetry,
  compact,
  style,
}: {
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
  style?: ViewStyle;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const d = describeError(error);
  if (compact) {
    return (
      <View style={[s.compact, style]} accessibilityRole="alert">
        <Icon name={errorIcon(d.kind)} size={scaled(iconSize.sm)} color={c.danger} />
        <Text style={s.compactText} numberOfLines={2}>
          {d.title}. {d.message}
        </Text>
        <Button title="Retry" variant="text" onPress={onRetry} />
      </View>
    );
  }
  if (MODERN) {
    return (
      <View style={[s.center, style]} accessibilityRole="alert">
        <Icon name={errorIcon(d.kind)} size={MODERN_ICON} color={c.text3} />
        <Text style={ms.title}>{d.title}</Text>
        <Text style={ms.message}>{d.message}</Text>
        <Button title="Retry" icon="arrow.clockwise" onPress={onRetry} containerStyle={ms.action} preferredFocus />
      </View>
    );
  }
  return (
    <View style={[s.center, style]} accessibilityRole="alert">
      <Icon name={errorIcon(d.kind)} size={scaled(sizes.stateIcon)} color={c.text3} />
      <Text style={s.title}>{d.title}</Text>
      <Text style={s.message}>{d.message}</Text>
      <Button title="Retry" icon="arrow.clockwise" onPress={onRetry} containerStyle={s.action} preferredFocus={isTV} />
    </View>
  );
}

/** Nothing to show: icon, title, one sentence and at most one tonal action. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  style,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: { title: string; onPress: () => void };
  style?: ViewStyle;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  if (MODERN) {
    return (
      <View style={[s.center, style]}>
        <Icon name={icon} size={MODERN_ICON} color={c.text3} />
        <Text style={ms.title}>{title}</Text>
        {message ? <Text style={ms.message}>{message}</Text> : null}
        {action ? <Button title={action.title} variant="primary" onPress={action.onPress} containerStyle={ms.action} /> : null}
      </View>
    );
  }
  return (
    <View style={[s.center, style]}>
      <Icon name={icon} size={scaled(sizes.stateIcon)} color={c.text3} />
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {action ? <Button title={action.title} variant="tonal" onPress={action.onPress} containerStyle={s.action} /> : null}
    </View>
  );
}

/** Loading a list: skeleton rows in the real layout. */
export function LoadingState({ style, rows = 6 }: { style?: ViewStyle; rows?: number }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  return (
    <Delayed>
      <View style={[s.list, { paddingHorizontal: l.gutter }, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={s.listRow}>
            <SkeletonBlock width={scaled(sizes.trackArt)} height={scaled(sizes.trackArt)} radius={6} />
            <View style={s.flex}>
              <SkeletonBlock width="60%" height={sizes.skeletonBar} radius={6} />
              <SkeletonBlock width="40%" height={sizes.skeletonBar} radius={6} style={s.gapTop} />
            </View>
          </View>
        ))}
      </View>
    </Delayed>
  );
}

/** Loading an item page: the hero, the title, the metadata line and the Play button. */
export function DetailSkeleton() {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const hero = Math.round(Math.min(l.contentWidth * (9 / 16), 420));
  return (
    <Delayed>
      <View accessibilityLabel="Loading" accessibilityRole="progressbar">
        <SkeletonBlock width={l.contentWidth} height={hero} />
        <View style={[s.detail, { paddingHorizontal: l.gutter }]}>
          <SkeletonBlock width="70%" height={scaled(28)} radius={8} style={s.selfCenter} />
          <SkeletonBlock width="45%" height={sizes.skeletonBar} radius={6} style={s.selfCenter} />
          <SkeletonBlock width="100%" height={scaled(sizes.buttonHeight)} radius={14} />
          <SkeletonBlock width="100%" height={sizes.skeletonBar} radius={6} />
          <SkeletonBlock width="80%" height={sizes.skeletonBar} radius={6} />
        </View>
      </View>
    </Delayed>
  );
}

/**
 * Loading a grid: skeleton tiles at the real grid sizes. TV Modern: `title`
 * shows the page title over the skeleton, where the loaded grid has it, so
 * the title does not jump when the tiles arrive.
 */
export function GridSkeleton({ shape, width, title }: { shape: TileShape; width?: number; title?: string }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const g = gridLayout(shape === 'thumb' ? 'thumb' : shape, width ?? l.contentWidth, l.tv, l.width);
  const h = g.tileWidth / SHAPES[shape].aspect;
  const radius = shape === 'circle' ? g.tileWidth / 2 : MODERN ? u(tvm.size.tileRadius) : shape === 'square' ? 8 : 10;
  const titled = MODERN && !!title;
  return (
    <Delayed>
      {titled ? (
        <View style={{ paddingHorizontal: g.gutter }}>
          <TvPageTitle title={title} />
        </View>
      ) : null}
      <View
        style={[s.grid, { paddingHorizontal: g.gutter, gap: g.gap }, MODERN && { rowGap: u(36) }, titled && ms.gridUnderTitle]}
        accessibilityLabel="Loading"
        accessibilityRole="progressbar">
        {Array.from({ length: g.columns * 3 }, (_, i) => (
          <View key={i} style={{ width: g.tileWidth }}>
            <SkeletonBlock width={g.tileWidth} height={h} radius={radius} />
            <SkeletonText width={g.tileWidth} />
          </View>
        ))}
      </View>
    </Delayed>
  );
}

/**
 * Wraps a screen's loading and loaded states. When a skeleton was on screen,
 * the content fades in (200 ms, strong ease-out), so the swap is not a hard
 * cut. Content that renders at once (from the persisted cache, or before the
 * skeleton's delay ends) appears with no fade. Opacity only, so Reduced
 * Motion needs no other path.
 */
export function FadeInAfterLoad({ loading, children }: { loading: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(false);
  const markSeen = useCallback(() => setSeen(true), []);
  if (loading) return <SkeletonShownContext.Provider value={markSeen}>{children}</SkeletonShownContext.Provider>;
  return seen ? <FadeIn>{children}</FadeIn> : <>{children}</>;
}

const FADE_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Mounts at opacity 0, so the content never paints at full opacity first. */
function FadeIn({ children }: { children: ReactNode }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, { duration: 200, easing: FADE_EASE_OUT }));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[stateStyles.fill, style]}>{children}</Animated.View>;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: spacing.xxl,
    gap: spacing.sm,
    minHeight: 260,
  },
  title: { ...font(type.headline), color: c.text, textAlign: 'center' as const, marginTop: spacing.md },
  message: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.stateMessageMaxWidth) },
  action: { marginTop: spacing.lg, minWidth: 160 },
  compact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingLeft: 14,
    marginHorizontal: spacing.lg,
    borderRadius: 14,
    backgroundColor: c.surface,
    minHeight: sizes.rowMin,
  },
  compactText: { ...font(type.footnote), color: c.text2, flex: 1 },
  list: { paddingTop: spacing.lg, gap: spacing.md },
  listRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  gapTop: { marginTop: 8 },
  detail: { gap: spacing.lg, marginTop: spacing.xl },
  selfCenter: { alignSelf: 'center' as const },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingTop: spacing.lg, rowGap: 20 },
}));

export const stateStyles = StyleSheet.create({ fill: { flex: 1 } });

const MODERN_ICON = u(72);

/** TV Modern state text (§2.7 of the redesign): title 40 u bold, body `c.text2` up to 900 u wide. */
const ms = StyleSheet.create({
  title: { ...tvFont(tvm.type.pageTitle), fontSize: u(40), lineHeight: u(48), color: dark.text, textAlign: 'center', marginTop: u(24) },
  message: { ...tvFont(tvm.type.body), color: dark.text2, textAlign: 'center', maxWidth: u(900) },
  action: { marginTop: u(32) },
  /** The toolbar row of the loaded page sits here; the skeleton starts under where it will be. */
  gridUnderTitle: { paddingTop: u(tvm.size.toolbarItemHeight) + u(28) },
});
