/**
 * The rows and groups of the Settings screens (design system §7.15): inset
 * grouped sections, rows with a leading icon, info rows and action rows.
 *
 * TV Modern (design system §7.22): one column, 1120 u wide, at the page
 * edge; readable eyebrow section labels; 88 u rows with a 30 u label and a
 * bare 34 u icon (no icon tile). The styles are shared by every screen that
 * uses these rows (admin, servers, extensions), so they all get the look.
 */
import { Platform, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, sizes, spacing, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

const MODERN = isTV && isTvModern;
/** Modern: the bare leading icon and the trailing chevron. */
const ICON = u(34);
const CHEVRON = u(24);

/** RN Web paints the "on" thumb green unless told otherwise; the RN types do not list the prop. */
export const webSwitchColors: object = Platform.OS === 'web' ? { activeThumbColor: mediaColors.white } : {};

/** An inset grouped section (design system §7.15). */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

export function LeadingIcon({ name }: { name: IconName }) {
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  return (
    <View style={styles.leading}>
      <Icon name={name} size={MODERN ? ICON : scaled(iconSize.sm - 1)} color={MODERN ? c.text2 : mediaColors.white} />
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  last,
  trailing,
  role = 'button',
  checked,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
  trailing?: React.ReactNode;
  role?: 'button' | 'radio' | 'switch';
  checked?: boolean;
}) {
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityState={checked === undefined ? undefined : { checked }}
      style={({ pressed, hovered, focused }) => [styles.rowPad, (pressed || hovered || (focused && !isTV)) && styles.rowPressed]}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.trailing}>
          {value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {trailing ?? <Icon name="chevron.right" size={MODERN ? CHEVRON : scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />}
        </View>
      </View>
    </Touchable>
  );
}

export function InfoRow({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <View style={styles.rowPad} accessible accessibilityLabel={`${label}: ${value}`}>
      <LeadingIcon name={icon} />
      <View style={[styles.row, styles.rowBody, !last && styles.rowBorder]}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1} selectable>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function ActionRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles(makeSettingsStyles);
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered, focused }) => [styles.row, styles.actionRow, (pressed || hovered || (focused && !isTV)) && styles.rowPressed]}>
      <Text style={styles.destructive}>{label}</Text>
    </Touchable>
  );
}

export const makeSettingsStyles = createStyles((t: AppTheme) => (MODERN ? { ...classicStyles(t), ...modernStyles(t) } : classicStyles(t)));

/** TV Modern overrides (redesign §2.7). TV is always dark. */
function modernStyles({ c }: AppTheme) {
  const padX = u(24);
  return {
    content: { paddingHorizontal: u(tvm.size.gutter), paddingTop: 0, paddingBottom: u(96) },
    inner: { width: u(1120), maxWidth: '100%' as const, alignSelf: 'flex-start' as const, gap: u(tvm.size.sectionGap) },
    account: { minHeight: u(120), gap: u(20), paddingHorizontal: padX },
    name: { ...tvFont(tvm.type.rowTitle), color: c.text },
    muted: { ...tvFont(tvm.type.body), color: c.text2 },
    section: { gap: u(12) },
    sectionTitle: { ...tvFont(tvm.type.eyebrow), color: c.text3, marginLeft: padX },
    footer: { ...tvFont(tvm.type.meta), fontSize: u(24), lineHeight: u(32), fontWeight: '400' as const, color: c.text3, marginHorizontal: padX },
    card: { backgroundColor: c.surface, borderRadius: u(20), overflow: 'hidden' as const, borderCurve: 'continuous' as const },
    rowPad: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: padX, gap: u(20) },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: u(tvm.size.listRowHeight), gap: u(20) },
    rowBody: { flex: 1, justifyContent: 'space-between' as const, paddingRight: padX, paddingVertical: u(8) },
    leading: { width: ICON, height: ICON, alignItems: 'center' as const, justifyContent: 'center' as const },
    label: { ...tvFont(tvm.type.body), fontSize: u(30), lineHeight: u(36), fontWeight: '500' as const, color: c.text, flexShrink: 1 },
    trailing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: u(12), flexShrink: 1 },
    value: { ...tvFont(tvm.type.body), color: c.text2, flexShrink: 1, textAlign: 'right' as const },
    destructive: { ...tvFont(tvm.type.body), fontSize: u(30), lineHeight: u(36), fontWeight: '500' as const, color: c.danger, textAlign: 'center' as const },
  };
}

function classicStyles({ c, scheme }: AppTheme) {
  return {
    flex: { flex: 1 },
    page: { backgroundColor: c.bgGrouped },
    content: { padding: spacing.lg, paddingBottom: spacing.huge * 2 },
    inner: { width: '100%' as const, maxWidth: scaled(sizes.settingsMaxWidth), alignSelf: 'center' as const, gap: spacing.xxl },
    account: { minHeight: scaled(sizes.settingsAccountRow + 12), gap: spacing.md, paddingHorizontal: spacing.lg },
    name: { ...font(type.headline), color: c.text },
    muted: { ...font(type.subheadline), color: c.text2, marginTop: spacing.xxs },
    section: { gap: spacing.sm - 2 },
    sectionTitle: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2, marginLeft: spacing.lg },
    footer: { ...font(type.footnote), color: c.text2, marginHorizontal: spacing.lg },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
    rowPad: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: spacing.lg, gap: spacing.md },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: scaled(sizes.settingsRow), gap: spacing.md },
    rowBody: { flex: 1, justifyContent: 'space-between' as const, paddingRight: spacing.lg, paddingVertical: spacing.sm },
    rowBorder: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
    rowPressed: { backgroundColor: c.surface3 },
    leading: {
      width: scaled(sizes.settingsIcon),
      height: scaled(sizes.settingsIcon),
      borderRadius: sizes.settingsIconRadius,
      backgroundColor: scheme === 'light' ? c.text3 : c.surface3,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderCurve: 'continuous' as const,
    },
    label: { ...font(type.body), color: c.text, flexShrink: 1 },
    trailing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, flexShrink: 1 },
    value: { ...font(type.body), color: c.text2, flexShrink: 1, textAlign: 'right' as const },
    actionRow: { justifyContent: 'center' as const },
    destructive: { ...font(type.body), color: c.danger, textAlign: 'center' as const },
  };
}
