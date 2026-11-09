import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { authorizeQuickConnect, isQuickConnectEnabled } from '@/api/jellyfin';
import { useApi } from '@/api/use-api';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { LoadingState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { approveErrorText, CODE_LENGTH, cleanCode, isCompleteCode } from '@/features/quick-connect/code';
import { TvScrollView } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

type Phase = { name: 'idle' } | { name: 'busy' } | { name: 'done'; code: string } | { name: 'error'; message: string };

/**
 * Quick Connect approval: another device (a TV, a browser, another Jellyfin
 * app) shows a six-digit code; the person types it here and that device signs
 * in as this account. No password is typed on the other device.
 */
export default function QuickConnectScreen() {
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const { api, session, userId } = useApi();
  const bottomPad = useTabBottomPadding();
  const sidebar = useSidebarInset();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  // The guard against a second approve. A ref, because a fast second tap or
  // Return can run before the render that shows the busy phase.
  const approving = useRef(false);

  useEffect(() => {
    let live = true;
    void isQuickConnectEnabled(api).then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, [api]);

  const approve = async () => {
    if (!isCompleteCode(code) || approving.current) return;
    approving.current = true;
    setPhase({ name: 'busy' });
    try {
      const ok = await authorizeQuickConnect(api, code, userId);
      setPhase(ok ? { name: 'done', code } : { name: 'error', message: 'The server did not accept the code. Try again.' });
      if (ok) setCode('');
    } catch (e) {
      setPhase({ name: 'error', message: approveErrorText(e) });
    } finally {
      approving.current = false;
    }
  };

  const body =
    enabled === null ? (
      <LoadingState rows={2} />
    ) : !enabled ? (
      <View style={styles.card}>
        <Icon name="qrcode" size={scaled(36)} color={c.text3} />
        <Text style={styles.cardTitle}>Quick Connect is off</Text>
        <Text style={styles.cardText}>
          {session.serverName} does not accept Quick Connect codes. An administrator can turn it on in the Jellyfin dashboard, under General.
        </Text>
      </View>
    ) : (
      <>
        <Text style={styles.intro}>
          Sign in on another device without a password. On that device, pick Quick Connect. Then type the code that it shows here.
        </Text>
        <TextField
          label="Code"
          value={code}
          onChangeText={(t) => {
            setCode(cleanCode(t));
            if (phase.name !== 'busy') setPhase({ name: 'idle' });
          }}
          placeholder="000000"
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={CODE_LENGTH + 2}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={approve}
          style={styles.codeInput}
          accessibilityLabel="Quick Connect code"
        />
        {phase.name === 'error' ? (
          <Text style={styles.error} accessibilityRole="alert">
            {phase.message}
          </Text>
        ) : null}
        {phase.name === 'done' ? (
          <View style={styles.done} accessibilityRole="alert">
            <Icon name="checkmark.circle.fill" size={scaled(22)} color={c.success} />
            <Text style={styles.doneText}>
              Code {phase.code} is approved. The other device now signs in as {session.userName}.
            </Text>
          </View>
        ) : null}
        <Button title="Approve" icon="checkmark" onPress={approve} loading={phase.name === 'busy'} disabled={!isCompleteCode(code)} />
        <Text style={styles.footnote}>Approve only codes from your own devices. The device gets full access to {session.userName}.</Text>
      </>
    );

  return (
    <>
      <Stack.Screen options={{ title: 'Quick Connect', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TvScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}>
          <View style={styles.inner}>{body}</View>
        </TvScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bgGrouped },
  content: { padding: spacing.lg },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg, paddingTop: spacing.lg },
  intro: { ...font(type.body), color: c.text2 },
  codeInput: { ...font(type.title2, { tabular: true }), letterSpacing: 6, textAlign: 'center' as const },
  error: { ...font(type.footnote), color: c.danger },
  done: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: c.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
  },
  doneText: { ...font(type.subheadline), color: c.text, flex: 1 },
  footnote: { ...font(type.footnote), color: c.text3 },
  card: {
    alignItems: 'center' as const,
    gap: spacing.md,
    backgroundColor: c.surface,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
  },
  cardTitle: { ...font(type.headline), color: c.text, textAlign: 'center' as const },
  cardText: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const },
}));
