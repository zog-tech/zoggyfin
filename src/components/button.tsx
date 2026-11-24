import { type ReactElement, type ReactNode, useContext } from 'react';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';

import { PlateIcon, TvFocusPlate, TvPlateText } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, dark, font, iconSize, radius, scaled, sizes, spacing, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './icon';
import { TouchFocusMark, Touchable } from './touchable';

export type ButtonVariant = 'primary' | 'tonal' | 'tonalAccent' | 'small' | 'smallTonal' | 'text';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  preferredFocus?: boolean;
}

/**
 * Buttons (design system §7.17). Primary: 50 pt, `accent` fill, `onAccent`
 * text. Tonal: `surface2` fill. Small: 32 pt pill. Text: no fill, `accent`.
 * TV Modern (§7.22) has no pill and no grey container: `primary` and
 * `small` draw the primary action (an Ember rectangle), every other variant
 * a text action (glyph and label, no container); both show the focus plate.
 */
export const Button: (props: ButtonProps) => ReactElement = isTV && isTvModern ? ModernButton : ClassicButton;

function ClassicButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  containerStyle,
  accessibilityLabel,
  preferredFocus,
}: ButtonProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const small = variant === 'small' || variant === 'smallTonal';
  const fg =
    variant === 'primary' || variant === 'small'
      ? c.onAccent
      : variant === 'tonalAccent' || variant === 'text'
        ? c.accent
        : c.text;
  const r = small ? radius.pill : radius.lg;
  return (
    <Touchable
      kind={variant === 'text' ? 'plain' : 'button'}
      radius={r}
      onPress={onPress}
      disabled={disabled || loading}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      containerStyle={containerStyle}
      style={({ pressed }) => [
        s.base,
        small ? s.small : s.large,
        { borderRadius: r },
        variant === 'primary' || variant === 'small' ? { backgroundColor: pressed ? c.accentPressed : c.accent } : null,
        variant === 'tonal' || variant === 'tonalAccent' || variant === 'smallTonal' ? { backgroundColor: pressed ? c.surface3 : c.surface2 } : null,
        variant === 'text' ? s.text : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={scaled(small ? iconSize.sm - 2 : iconSize.sm)} color={fg} weight="semibold" /> : null}
          <Text style={[small ? s.labelSmall : variant === 'text' ? s.labelText : s.label, { color: fg }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Touchable>
  );
}

const makeStyles = createStyles((_: AppTheme) => ({
  base: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  large: { minHeight: scaled(sizes.buttonHeight), paddingHorizontal: scaled(spacing.xl) },
  small: { minHeight: scaled(sizes.buttonSmall), paddingHorizontal: scaled(spacing.lg) },
  text: { minHeight: scaled(sizes.iconButton), paddingHorizontal: spacing.sm },
  label: font(type.headline),
  labelSmall: { ...font(type.subheadline), fontWeight: '600' as const },
  labelText: font(type.body),
}));

// ---------------------------------------------------------------------------
// TV Modern look: the primary action and the text action of §2.3 of the redesign.
// ---------------------------------------------------------------------------

const C = dark;
const ACTION_ICON = u(tvm.size.actionIcon);

function ModernButton({ title, onPress, variant = 'primary', icon, loading, disabled, style, containerStyle, accessibilityLabel, preferredFocus }: ButtonProps) {
  const primary = variant === 'primary' || variant === 'small';
  const rest = primary ? C.onAccent : C.text;
  return (
    <Touchable
      kind="plain"
      ring={false}
      onPress={onPress}
      disabled={disabled || loading}
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      containerStyle={[m.container, containerStyle]}>
      <ModernBox primary={primary} style={style}>
        {loading ? (
          <ActivityIndicator color={rest} />
        ) : (
          <>
            {icon ? <PlateIcon name={icon} size={ACTION_ICON} rest={rest} /> : null}
            <TvPlateText style={primary ? m.primaryLabel : m.label} rest={rest}>
              {title}
            </TvPlateText>
          </>
        )}
      </ModernBox>
    </Touchable>
  );
}

/** The box of an action: an Ember fill at rest (primary) or nothing (text), the white plate with the focus, scale 1.04. */
function ModernBox({ primary, style, children }: { primary: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const mark = useContext(TouchFocusMark);
  const reduced = useReducedMotion();
  const box = useAnimatedStyle(() => {
    const f = mark ? mark.get() : 0;
    return {
      transform: [{ scale: reduced ? 1 : 1 + (tvm.size.actionFocusScale - 1) * f }],
      ...(primary ? { backgroundColor: interpolateColor(f, [0, 1], [C.accent, tvm.color.plate]) } : null),
    };
  });
  return (
    <Animated.View style={[m.box, primary ? m.primary : m.text, style, box]}>
      {primary ? null : <TvFocusPlate />}
      {children}
    </Animated.View>
  );
}

const m = StyleSheet.create({
  /** An action is as wide as its label: it never stretches across its row. */
  container: { alignSelf: 'flex-start' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: u(14),
    height: u(tvm.size.actionHeight),
    borderRadius: u(tvm.size.plateRadius),
  },
  primary: { paddingHorizontal: u(tvm.size.primaryPadX) },
  text: { paddingHorizontal: u(tvm.size.actionPadX) },
  primaryLabel: { ...tvFont(tvm.type.action), fontWeight: '700' },
  label: { ...tvFont(tvm.type.action) },
});
