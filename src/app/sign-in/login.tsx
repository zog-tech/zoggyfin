import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import {
  authenticateByName,
  authenticateWithQuickConnect,
  initiateQuickConnect,
  isQuickConnectEnabled,
  quickConnectState,
} from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { completeSignIn, type ServerInfo } from '@/auth/sign-in';
import { Button } from '@/components/button';
import { TextField, type TextFieldRef } from '@/components/text-field';
import { LanAccessHelp } from '@/features/servers/nearby-servers';
import { finishReinstall } from '@/features/servers/reinstall';
import { lanHelpAfterFailure, openLanSettings } from '@/features/servers/use-server-discovery';
import { TvScrollView } from '@/features/tv/page-scroll';
import { type LanHelp, withLanRetry } from '@/servers/discovery/lan-access';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

const POLL_MS = 2000;

export default function LoginScreen() {
  const styles = useStyles(makeStyles);
  const params = useLocalSearchParams<{ url: string; serverId: string; serverName: string; version: string; replaces?: string }>();
  const server: ServerInfo = {
    url: params.url,
    serverId: params.serverId,
    serverName: params.serverName,
    version: params.version || null,
  };
  const api = getApi(server.url, null);
  const adding = usePathname().startsWith('/add-account');
  /** Signed in already (adding an account): close the sheet over the app after the switch. */
  const finish = (result: Parameters<typeof completeSignIn>[1]) => {
    completeSignIn(server, result);
    // The user said that this is a reinstalled saved server: move its downloads and addresses.
    const s = useSessionStore.getState().session;
    if (params.replaces && s && result.AccessToken) {
      void finishReinstall(params.replaces, { url: server.url, token: result.AccessToken, serverId: s.serverId, userId: s.userId });
    }
    if (adding) router.dismissTo('/(tabs)/(home)');
  };

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanHelp, setLanHelp] = useState<LanHelp | null>(null);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [qcCode, setQcCode] = useState<string | null>(null);
  const passwordRef = useRef<TextFieldRef>(null);

  useEffect(() => {
    isQuickConnectEnabled(api).then(setQcEnabled);
  }, [api]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    setLanHelp(null);
    try {
      // A private address gets one retry: the local network prompt can still be open.
      finish(await withLanRetry(server.url, () => authenticateByName(api, username.trim(), password)));
    } catch (e) {
      const d = describeError(e);
      const help = await lanHelpAfterFailure(server.url, e);
      if (help) setLanHelp(help);
      else setError(d.kind === 'auth' ? 'Wrong username or password.' : `${d.title}. ${d.message}`);
      setBusy(false);
    }
  };

  // Quick Connect: show a code, poll until the user approves it on another device.
  const [qcSecret, setQcSecret] = useState<string | null>(null);
  const startQuickConnect = async () => {
    setError(null);
    try {
      const r = await initiateQuickConnect(api);
      if (!r.Secret || !r.Code) throw new Error('The server did not return a code.');
      setQcSecret(r.Secret);
      setQcCode(r.Code);
    } catch (e) {
      setError(describeError(e).title);
    }
  };

  useEffect(() => {
    if (!qcSecret) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const s = await quickConnectState(api, qcSecret);
        if (stopped || !s.Authenticated) return;
        stopped = true;
        clearInterval(timer);
        finish(await authenticateWithQuickConnect(api, qcSecret));
      } catch (e) {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        setQcSecret(null);
        setQcCode(null);
        setError(`Quick Connect stopped. ${describeError(e).message}`);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // server is derived from stable params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcSecret, api]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TvScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {server.serverName}
            {server.version ? ` · Jellyfin ${server.version}` : ''}
          </Text>

          {qcCode ? (
            <View style={styles.qc}>
              <Text style={styles.qcLabel}>Enter this code in Jellyfin under Settings, Quick Connect:</Text>
              <Text style={styles.qcCode} selectable accessibilityLabel={`Code ${qcCode.split('').join(' ')}`}>
                {qcCode}
              </Text>
              <Text style={styles.qcHint}>Waiting for approval. This page signs in by itself.</Text>
              <Button
                title="Cancel"
                variant="tonal"
                onPress={() => {
                  setQcSecret(null);
                  setQcCode(null);
                }}
              />
            </View>
          ) : (
            <>
              <TextField
                label="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                accessibilityLabel="Username"
              />
              <TextField
                ref={passwordRef}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={signIn}
                accessibilityLabel="Password"
              />
              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}
              {lanHelp ? <LanAccessHelp kind={lanHelp} onOpenSettings={openLanSettings} /> : null}
              <Button title="Sign in" onPress={signIn} loading={busy} disabled={!username.trim()} />
              {qcEnabled ? (
                <Button title="Use Quick Connect" icon="qrcode" variant="tonal" onPress={startQuickConnect} />
              ) : null}
            </>
          )}
        </View>
      </TvScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  content: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.xxl },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg },
  title: { ...font(type.largeTitle), color: c.text },
  subtitle: { ...font(type.subheadline), color: c.text2, marginTop: -spacing.sm, marginBottom: spacing.sm },
  error: { ...font(type.footnote), color: c.danger },
  qc: { gap: spacing.lg, backgroundColor: c.surface, padding: spacing.xxl, borderRadius: radius.lg, borderCurve: 'continuous' as const },
  qcLabel: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const },
  qcCode: { ...font(type.largeTitle, { tabular: true }), fontSize: scaled(44), lineHeight: scaled(52), letterSpacing: 8, color: c.text, textAlign: 'center' as const },
  qcHint: { ...font(type.footnote), color: c.text3, textAlign: 'center' as const },
}));
