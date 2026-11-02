/**
 * Shared parts of the Admin screens: the access gate, the page, cards,
 * badges, progress bars and the confirm and text sheets. All of them are
 * JS views, so they work the same on iOS, Android, web and the Mac app.
 */
import { Stack } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { Touchable } from '@/components/touchable';
import { makeSettingsStyles } from '@/features/settings/rows';
import { TvScrollView } from '@/features/tv/page-scroll';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

import { type AdminTarget, useAdminAccess } from './access';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

/** Content width from which Admin screens use two columns (iPad landscape, Mac, desktop web). */
export const ADMIN_WIDE = 900;

export function useAdminWide(): boolean {
  return useLayout().contentWidth >= ADMIN_WIDE;
}

/** The grouped-screen header of every Admin screen. */
export function AdminHeader({ title }: { title: string }) {
  const { c } = useTheme();
  return <Stack.Screen options={{ title, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />;
}

/**
 * Opens a screen only for an admin account of the server. Other states get
 * a full-screen message: loading, no admin account, or an error with Retry.
 */
export function AdminGate({ serverId, title, children }: { serverId: string | undefined; title: string; children: (t: AdminTarget) => ReactNode }) {
  const access = useAdminAccess(serverId);
  const s = useStyles(makeStyles);
  return (
    <>
      <AdminHeader title={title} />
      {access.status === 'ready' ? (
        children(access.target)
      ) : access.status === 'loading' ? (
        <View style={s.fill}>
          <LoadingState rows={5} style={s.loading} />
        </View>
      ) : access.status === 'error' ? (
        <View style={s.fill}>
          <ErrorState error={access.error} onRetry={access.retry} />
        </View>
      ) : (
        <View style={s.fill}>
          <EmptyState
            icon="checkmark.shield"
            title={access.reason === 'not-admin' ? 'No admin access' : access.reason === 'no-server' ? 'This server is not saved' : 'Sign in to this server'}
            message={
              access.reason === 'not-admin'
                ? 'The Admin panel is only for administrators of this server. Sign in with an administrator account.'
                : access.reason === 'no-server'
                  ? 'It was removed from this device.'
                  : 'No account of this server is signed in on this device.'
            }
          />
        </View>
      )}
    </>
  );
}

/** A scrolling grouped page with pull to refresh, centred and clear of the iPad sidebar. */
export function AdminPage({ children, onRefresh, wide = false, inset = true, style }: { children: ReactNode; onRefresh?: () => unknown; wide?: boolean; inset?: boolean; style?: ViewStyle }) {
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const sidebarInset = useSidebarInset();
  const sidebar = inset ? sidebarInset : 0;
  const { c } = useTheme();
  const pull = usePullRefresh(onRefresh);
  useRefreshSpinner(pull.refreshing);
  return (
    <TvScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={rs.page}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[rs.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}
      refreshControl={pull.onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text3)} colors={[c.accent]} /> : undefined}>
      <View style={[rs.inner, wide && s.innerWide, style]}>{children}</View>
    </TvScrollView>
  );
}

/** Two columns on wide windows, one column below. */
export function Columns({ left, right, leftWidth = 0.42 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) {
  const wide = useAdminWide();
  const s = useStyles(makeStyles);
  if (!wide) {
    return (
      <>
        {left}
        {right}
      </>
    );
  }
  return (
    <View style={s.columns}>
      <View style={[s.column, { flex: leftWidth }]}>{left}</View>
      <View style={[s.column, { flex: 1 - leftWidth }]}>{right}</View>
    </View>
  );
}

/** Cards in a grid: one column on phones, two equal columns on wide windows. */
export function CardGrid({ children }: { children: ReactNode[] }) {
  const wide = useAdminWide();
  const s = useStyles(makeStyles);
  if (!wide) {
    return (
      <View style={s.grid}>
        {children.map((child, i) => (
          <View key={i}>{child}</View>
        ))}
      </View>
    );
  }
  const rows: ReactNode[][] = [];
  for (let i = 0; i < children.length; i += 2) rows.push(children.slice(i, i + 2));
  return (
    <View style={s.grid}>
      {rows.map((row, r) => (
        <View key={r} style={s.gridRow}>
          {row.map((child, i) => (
            <View key={i} style={s.gridCell}>
              {child}
            </View>
          ))}
          {row.length === 1 ? <View style={s.gridCell} /> : null}
        </View>
      ))}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useStyles(makeStyles);
  return <View style={[s.card, style]}>{children}</View>;
}

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

/** A small label in a pill. Colour is never the only signal: the text says the state. */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const fg = tone === 'accent' ? c.accent : tone === 'success' ? c.success : tone === 'warning' ? c.warning : tone === 'danger' ? c.danger : c.text2;
  return (
    <View style={[s.badge, tone === 'accent' ? { backgroundColor: c.accentSoft } : null]}>
      {icon ? <Icon name={icon} size={scaled(iconSize.xs)} color={fg} weight="semibold" /> : null}
      <Text style={[s.badgeText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A 4-pt progress bar (design system §7.11). `value` is 0–1. */
export function Bar({ value, tone = 'accent', label }: { value: number; tone?: Tone; label?: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const fill = tone === 'warning' ? c.warning : tone === 'danger' ? c.danger : tone === 'success' ? c.success : c.accent;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={s.barTrack} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[s.barFill, { width: `${pct}%`, backgroundColor: fill }]} />
    </View>
  );
}

/** A label and a value in one line of a card. */
export function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, mono && s.mono]} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

/** A section header outside a card, with an optional trailing action. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}

/**
 * A confirm for a destructive action in a sheet (the same on every
 * platform). With `typed`, the button works only after the person types
 * that exact text.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  action,
  typed,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  action: string;
  typed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const s = useStyles(makeStyles);
  const [text, setText] = useState('');
  // Each opening starts empty (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (!visible) setText('');
  }
  const ok = !typed || text.trim() === typed;
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={s.sheetBody}>
        <View style={s.warnRow}>
          <WarnIcon />
          <Text style={s.sheetText}>{message}</Text>
        </View>
        {typed ? (
          <TextField
            label={`Type "${typed}" to confirm`}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            accessibilityLabel={`Type ${typed} to confirm`}
            onSubmitEditing={() => ok && onConfirm()}
          />
        ) : null}
        <View style={s.sheetButtons}>
          <Button title="Cancel" variant="tonal" onPress={onClose} containerStyle={s.flex} />
          <DangerButton title={action} onPress={onConfirm} disabled={!ok} loading={busy} />
        </View>
      </View>
    </Sheet>
  );
}

function WarnIcon() {
  const { c } = useTheme();
  return <Icon name="exclamationmark.triangle" size={scaled(iconSize.md)} color={c.danger} />;
}

/** A large button in `danger` for destructive actions. The text uses `onAccent`, which passes AA on `danger` in both themes. */
export function DangerButton({ title, onPress, disabled, loading }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const off = disabled || loading;
  return (
    <Touchable
      kind="button"
      radius={radius.lg}
      onPress={onPress}
      disabled={off}
      containerStyle={s.flex}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [s.danger, { backgroundColor: c.danger, opacity: pressed ? 0.85 : 1 }]}>
      {loading ? (
        <ActivityIndicator color={c.onAccent} />
      ) : (
        <Text style={[s.dangerText, { color: c.onAccent }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Touchable>
  );
}

/** A sheet with one text field and a send button (message, new password). */
export function TextSheet({
  visible,
  title,
  label,
  hint,
  action,
  secure,
  multiline,
  busy,
  validate,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  label: string;
  hint?: string;
  action: string;
  secure?: boolean;
  multiline?: boolean;
  busy?: boolean;
  /** An error text for the value, or null when it is good. */
  validate?: (v: string) => string | null;
  onSubmit: (v: string) => void;
  onClose: () => void;
}) {
  const s = useStyles(makeStyles);
  const [text, setText] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (!visible) {
      setText('');
      setAgain('');
    }
  }
  const error = text ? (validate?.(text) ?? (secure && again && again !== text ? 'The two passwords are not the same.' : null)) : null;
  const ok = text.trim().length > 0 && !error && (!secure || again === text);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={s.sheetBody}>
        {hint ? <Text style={s.sheetText}>{hint}</Text> : null}
        <TextField
          label={label}
          value={text}
          onChangeText={setText}
          secureTextEntry={secure}
          autoCapitalize={secure ? 'none' : 'sentences'}
          autoCorrect={!secure}
          autoFocus
          multiline={multiline}
          style={multiline ? s.multiline : undefined}
          textContentType={secure ? 'newPassword' : undefined}
        />
        {secure ? <TextField label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" /> : null}
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={s.sheetButtons}>
          <Button title="Cancel" variant="tonal" onPress={onClose} containerStyle={s.flex} />
          <Button title={action} onPress={() => ok && onSubmit(text)} disabled={!ok} loading={busy} containerStyle={s.flex} />
        </View>
      </View>
    </Sheet>
  );
}

/** "Updated 12:01:05" under live lists, so a stale list is visible. */
export function LiveNote({ at, live, error }: { at: number; live: boolean; error?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  if (!at) return null;
  const time = new Date(at).toLocaleTimeString();
  return (
    <View style={s.live}>
      <View style={[s.liveDot, { backgroundColor: error ? c.warning : live ? c.success : c.text3 }]} />
      <Text style={s.liveText}>{error ? `Could not refresh. Last update ${time}` : live ? `Live. Updated ${time}` : `Updated ${time}`}</Text>
    </View>
  );
}

export const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  fill: { flex: 1, backgroundColor: c.bgGrouped, justifyContent: 'center' as const },
  loading: { paddingTop: spacing.xl },
  innerWide: { maxWidth: 1200 },
  columns: { flexDirection: 'row' as const, gap: spacing.xxl, alignItems: 'flex-start' as const },
  column: { gap: spacing.xxl, minWidth: 0 },
  grid: { gap: spacing.lg },
  gridRow: { flexDirection: 'row' as const, gap: spacing.lg, alignItems: 'flex-start' as const },
  gridCell: { flex: 1, minWidth: 0 },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderCurve: 'continuous' as const },
  badge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: c.surface2,
    alignSelf: 'flex-start' as const,
  },
  badgeText: { ...font(type.caption1), fontWeight: '600' as const },
  barTrack: { height: sizes.progress, borderRadius: radius.pill, backgroundColor: c.surface3, overflow: 'hidden' as const },
  barFill: { height: '100%' as const, borderRadius: radius.pill },
  fact: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: spacing.md, alignItems: 'baseline' as const },
  factLabel: { ...font(type.subheadline), color: c.text2 },
  factValue: { ...font(type.subheadline), color: c.text, flexShrink: 1, textAlign: 'right' as const },
  mono: { ...font(type.mono, { tabular: true }) },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginHorizontal: spacing.lg, gap: spacing.md, minHeight: 32 },
  sectionTitle: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2 },
  sheetBody: { gap: spacing.lg, paddingBottom: spacing.md },
  sheetText: { ...font(type.subheadline), color: c.text2, flex: 1 },
  warnRow: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-start' as const },
  danger: { minHeight: scaled(sizes.buttonHeight), borderRadius: radius.lg, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: spacing.xl, borderCurve: 'continuous' as const },
  dangerText: { ...font(type.headline) },
  sheetButtons: { flexDirection: 'row' as const, gap: spacing.md },
  multiline: { minHeight: 96, textAlignVertical: 'top' as const, paddingTop: spacing.md },
  error: { ...font(type.footnote), color: c.danger },
  live: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, marginHorizontal: spacing.lg },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { ...font(type.footnote, { tabular: true }), color: c.text2 },
}));
