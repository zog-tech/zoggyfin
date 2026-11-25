/**
 * "Report a problem" (Settings): the person writes what went wrong, and the
 * app shares or copies a plain-text report with the player log
 * (`lib/diag-store.ts`). The report holds the app version, the update, the
 * platform and the log: no server address, no account and no song names.
 * iOS and Android share through the system sheet; the web and the Mac app
 * copy to the clipboard. Not on TV (no text entry or share sheet to speak of).
 */
import * as Application from 'expo-application';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Share, Text, View } from 'react-native';

import { clientIdentity } from '@/auth/identity';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { TextField } from '@/components/text-field';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { writeClipboard } from '@/invite/clipboard';
import { buildReport, formatEntry } from '@/lib/diag-log';
import { diagEntries, flushDiag } from '@/lib/diag-store';
import { runningOta, runtimeVersionNow } from '@/lib/ota';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { toast } from '@/lib/toast';
import { appVersion, isDesktop } from '@/platform/desktop';
import { liteNow } from '@/platform/lite-now';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, fontFamily, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

import { reportInfo } from './report';

const CONTACT = 'admin@zog-tech.com';
/** The log view shows this many of the last entries; the report holds them all. */
const SHOWN_ENTRIES = 200;
const monoFamily = Platform.select({ ios: 'Menlo', android: 'monospace', default: fontFamily.webMono });

function reportText(userText: string): string {
  flushDiag();
  const info = reportInfo(
    {
      os: Platform.OS,
      osVersion: Platform.Version,
      tv: isTV,
      desktop: isDesktop,
      desktopVersion: appVersion,
      nativeVersion: Application.nativeApplicationVersion ?? null,
      nativeBuild: Application.nativeBuildVersion ?? null,
      fallbackVersion: clientIdentity().version,
      updateId: runningOta()?.id ?? null,
      runtimeVersion: runtimeVersionNow(),
      lite: liteNow(),
    },
    Date.now(),
  );
  return buildReport(info, userText, diagEntries());
}

export function ReportScreen() {
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const bottomPad = useTabBottomPadding();
  const sidebar = useSidebarInset();
  const [text, setText] = useState('');
  const [logShown, setLogShown] = useState<string[] | null>(null);
  // A ref, not render state: two taps in one frame must not open two sheets.
  const busy = useRef(false);

  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const ok = await writeClipboard(reportText(text));
      toast(ok ? 'Report copied' : 'This device cannot copy. Use Share report.', { icon: ok ? 'checkmark' : 'exclamationmark.triangle' });
    } finally {
      busy.current = false;
    }
  };

  const share = async () => {
    if (Platform.OS === 'web') {
      await copy();
      return;
    }
    if (busy.current) return;
    busy.current = true;
    try {
      await Share.share({ message: reportText(text), title: 'Zoggyfin problem report' }, { subject: 'Zoggyfin problem report', dialogTitle: 'Share report' });
    } catch {
      toast('The report could not be shared. Use Copy report.', { icon: 'exclamationmark.triangle' });
    } finally {
      busy.current = false;
    }
  };

  const toggleLog = () => setLogShown((shown) => (shown ? null : diagEntries().slice(-SHOWN_ENTRIES).map(formatEntry)));

  return (
    <>
      <Stack.Screen options={{ title: 'Report a problem', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TvScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}>
          <View style={styles.inner}>
            <TextField
              label="What went wrong?"
              value={text}
              onChangeText={setText}
              placeholder="For example: I pressed a song. It loaded but did not play."
              multiline
              textAlignVertical="top"
              style={styles.input}
              accessibilityLabel="What went wrong?"
            />
            <Text style={styles.note}>
              The report holds the app version and update, the platform and system version, and the player log. It holds no server address, no account and no song
              names.
            </Text>
            <Button title={Platform.OS === 'web' ? 'Copy report' : 'Share report'} icon={Platform.OS === 'web' ? 'doc.text' : 'square.and.arrow.up'} onPress={share} />
            {Platform.OS === 'web' ? null : <Button title="Copy report" icon="doc.text" variant="tonal" onPress={copy} />}
            <Text style={styles.note}>Send it to {CONTACT} or attach it to a GitHub issue.</Text>
            <Touchable
              kind="row"
              onPress={toggleLog}
              accessibilityRole="button"
              accessibilityLabel={logShown ? 'Hide log' : 'Show log'}
              accessibilityState={{ expanded: !!logShown }}
              style={({ pressed, hovered }) => [styles.disclosure, (pressed || hovered) && styles.disclosurePressed]}>
              <Icon name={logShown ? 'chevron.down' : 'chevron.right'} size={scaled(iconSize.sm - 2)} color={c.text2} weight="semibold" />
              <Text style={styles.disclosureText}>{logShown ? 'Hide log' : 'Show log'}</Text>
            </Touchable>
            {logShown ? (
              <View style={styles.log}>
                <Text style={styles.logText} selectable>
                  {logShown.length ? logShown.join('\n') : 'The log is empty.'}
                </Text>
              </View>
            ) : null}
          </View>
        </TvScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bgGrouped },
  content: { padding: spacing.lg },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg, paddingTop: spacing.lg },
  input: { minHeight: scaled(sizes.fieldHeight * 3), paddingTop: spacing.md, paddingBottom: spacing.md },
  note: { ...font(type.footnote), color: c.text2 },
  disclosure: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md },
  disclosurePressed: { backgroundColor: c.surface3 },
  disclosureText: { ...font(type.body), color: c.text },
  log: { backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderCurve: 'continuous' as const },
  logText: { ...font(type.mono), fontFamily: monoFamily, fontWeight: '400' as const, color: c.text2 },
}));
