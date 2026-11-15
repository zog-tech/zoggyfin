/**
 * TV: the action button of the item page and the Home billboard, in the style
 * of the streaming apps on TV. At rest it is a translucent pill with white
 * text; focused it fills white with dark text and grows a little. The fill is
 * the one focus mark (no ring). Its colour and scale run on the UI thread
 * from the Touchable's focus mark, so a focus move does no React render.
 */
import { type ReactNode, useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { TouchFocusMark, Touchable } from '@/components/touchable';
import { type AppTheme, createStyles, font, iconSize, mediaColors, radius, scaled, spacing, type, useStyles } from '@/theme';

/** The rest and focus colours (media colours: the button sits on art). */
const REST_FILL = mediaColors.tvButtonRest;
const FOCUS_FILL = mediaColors.white;
const REST_TEXT = mediaColors.white;
const FOCUS_TEXT = mediaColors.tvButtonFocusText;

export function TvButton({
  label,
  icon,
  onPress,
  firstFocus,
  progress,
  active,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** This button takes the first focus of the page. */
  firstFocus?: boolean;
  /** A resume bar under the label, 0..1. */
  progress?: number | null;
  /** A toggle that is on (My List, Played): the icon shows it. */
  active?: boolean;
  accessibilityLabel?: string;
}) {
  const s = useStyles(makeStyles);
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      <Fill>
        {icon ? <TvButtonIcon name={icon} /> : null}
        <TvButtonLabel style={s.label}>{label}</TvButtonLabel>
        {progress != null ? (
          <View style={s.track}>
            <View style={[s.trackFill, { width: `${Math.max(3, Math.round(progress * 100))}%` }]} />
          </View>
        ) : null}
      </Fill>
    </Touchable>
  );
}

/**
 * TV: a round icon button in the same style (the music player's transport). The focus fills the
 * circle white. `active` marks a toggle that is on (shuffle, repeat) with a dot under it; the
 * dot sits inside the button's box, so nothing hangs outside it and nothing is clipped.
 */
export function TvIconButton({
  icon,
  label,
  onPress,
  size,
  firstFocus,
  active,
  plain,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** The circle's diameter in points (before the screen scale). */
  size: number;
  firstFocus?: boolean;
  active?: boolean;
  /** No fill at rest (the secondary transport buttons): only the focus fills the circle. */
  plain?: boolean;
}) {
  const d = scaled(size);
  return (
    <Touchable
      kind="plain"
      ring={false}
      firstFocus={firstFocus}
      hasTVPreferredFocus={firstFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}>
      <View style={{ alignItems: 'center', gap: scaled(4) }}>
        <Fill round={d} plain={plain}>
          <TvButtonIcon name={icon} size={Math.round(d * 0.46)} />
        </Fill>
        <View style={[dotStyle, { opacity: active ? 1 : 0 }]} />
      </View>
    </Touchable>
  );
}

const dotStyle = { width: 5, height: 5, borderRadius: 3, backgroundColor: mediaColors.white } as const;

/** The pill (or a circle of diameter `round`): its fill and scale follow the focus mark. */
function Fill({ children, round, plain }: { children: ReactNode; round?: number; plain?: boolean }) {
  const s = useStyles(makeStyles);
  const mark = useContext(TouchFocusMark);
  const rest = plain ? mediaColors.tvButtonClear : REST_FILL;
  const style = useAnimatedStyle(() => {
    const m = mark ? mark.get() : 0;
    return { backgroundColor: interpolateColor(m, [0, 1], [rest, FOCUS_FILL]), transform: [{ scale: 1 + 0.06 * m }] };
  });
  return (
    <Animated.View style={[round ? { width: round, height: round, borderRadius: round / 2, alignItems: 'center', justifyContent: 'center' } : s.pill, style]}>
      {children}
    </Animated.View>
  );
}

function TvButtonLabel({ children, style }: { children: string; style: object }) {
  const mark = useContext(TouchFocusMark);
  const color = useAnimatedStyle(() => ({ color: interpolateColor(mark ? mark.get() : 0, [0, 1], [REST_TEXT, FOCUS_TEXT]) }));
  return (
    <Animated.Text style={[style, color]} numberOfLines={1}>
      {children}
    </Animated.Text>
  );
}

/** The icon in two colours, cross-faded on the focus mark (an icon's colour is not animatable). */
function TvButtonIcon({ name, size: sizeIn }: { name: IconName; size?: number }) {
  const mark = useContext(TouchFocusMark);
  const size = sizeIn ?? scaled(iconSize.sm);
  const lit = useAnimatedStyle(() => ({ opacity: mark ? mark.get() : 0 }));
  const dim = useAnimatedStyle(() => ({ opacity: mark ? 1 - mark.get() : 1 }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, dim]}>
        <Icon name={name} size={size} color={REST_TEXT} weight="semibold" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, lit]}>
        <Icon name={name} size={size} color={FOCUS_TEXT} weight="semibold" />
      </Animated.View>
    </View>
  );
}

/** A plain text line in the TV button style, for a hint next to the buttons. */
export function TvButtonHint({ children }: { children: string }) {
  const s = useStyles(makeStyles);
  return <Text style={s.hint}>{children}</Text>;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: scaled(18),
    height: scaled(40),
    borderRadius: radius.sm,
  },
  label: { ...font(type.headline), color: REST_TEXT },
  track: {
    position: 'absolute' as const,
    left: scaled(18),
    right: scaled(18),
    bottom: scaled(5),
    height: 3,
    borderRadius: 2,
    backgroundColor: mediaColors.tvTrack,
    overflow: 'hidden' as const,
  },
  trackFill: { height: '100%' as const, backgroundColor: c.accent },
  hint: { ...font(type.footnote), color: mediaColors.white },
}));
