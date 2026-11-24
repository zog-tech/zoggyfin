import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useSessionStore } from '@/auth/session-store';
import { Touchable } from '@/components/touchable';
import { TvFocusPlate, TvPlateText } from '@/features/tv/tv-button';
import { checkServer } from '@/lib/online';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { checkConnection, useConnection } from '@/servers/connection';
import { connectionLine } from '@/servers/status';
import { createStyles, type AppTheme, dark, font, spacing, tvm, type, u, useStyles, useTheme } from '@/theme';

/** TV Modern look (design system §7.22): "Check again" is a text action with the focus plate, not a ring. */
const MODERN = isTV && isTvModern;

/** Checks again: the active server through the reachability check (it also updates the offline banner). */
export function checkAgain(serverId: string): void {
  if (useSessionStore.getState().session?.serverId === serverId) void checkServer();
  else void checkConnection(serverId);
}

/**
 * The status line of a server's connection: "Connected through Home network
 * (internal)" or "Connected through Internet (external)", a reason when it
 * needs one, and "Check again".
 */
export function ConnectionStatus({ serverId, inset }: { serverId: string; inset?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const info = useConnection(serverId);
  const line = connectionLine(info);
  const dot = line.tone === 'ok' ? c.success : line.tone === 'warning' ? c.warning : c.text3;
  return (
    <View style={[s.wrap, inset && s.inset]} accessibilityLiveRegion="polite">
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.text} numberOfLines={2} accessibilityLabel={line.detail ? `${line.text}. ${line.detail}` : line.text}>
          {line.text}
        </Text>
        {info.checking ? (
          <ActivityIndicator size="small" color={c.text2} accessibilityLabel="Checking" />
        ) : MODERN ? (
          <Touchable kind="plain" ring={false} onPress={() => checkAgain(serverId)} accessibilityRole="button" accessibilityLabel="Check again">
            <View style={ms.action}>
              <TvFocusPlate />
              <TvPlateText style={s.link} rest={dark.accent}>
                Check again
              </TvPlateText>
            </View>
          </Touchable>
        ) : (
          <Touchable onPress={() => checkAgain(serverId)} hitSlop={10} radius={8} accessibilityRole="button" accessibilityLabel="Check again">
            <Text style={s.link}>Check again</Text>
          </Touchable>
        )}
      </View>
      {line.detail ? <Text style={s.detail}>{line.detail}</Text> : null}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  inset: {
    borderTopWidth: 0.5,
    borderTopColor: c.separator,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...font(type.subheadline), color: c.text, flex: 1 },
  detail: { ...font(type.footnote), color: c.text2, marginLeft: 8 + spacing.sm },
  link: { ...font(type.subheadline), color: c.accent },
}));

const ms = StyleSheet.create({
  action: { justifyContent: 'center', height: u(tvm.size.toolbarItemHeight), paddingHorizontal: u(tvm.size.toolbarPadX) },
});
