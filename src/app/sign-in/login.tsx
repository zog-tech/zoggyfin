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
import { createGate } from '@/lib/async-gate';
import { Button } from '@/components/button';
import { TextField, type TextFieldRef } from '@/components/text-field';
import { LanAccessHelp } from '@/features/servers/nearby-servers';
import { finishReinstall } from '@/features/servers/reinstall';
import { lanHelpAfterFailure, openLanSettings } from '@/features/servers/use-server-discovery';
import { TvScrollView } from '@/features/tv/page-scroll';
import { type LanHelp, withLanRetry } from '@/servers/discovery/lan-access';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

const POLL_MS = 2000;

/**
 * Quick Connect, one phase at a time. `token` comes from the screen's gate:
 * Cancel and unmount make it stale, so a late answer neither starts polling
 * nor signs in.
 */
type QuickConnect =
  | { name: 'idle' }
  | { name: 'starting'; token: number }
  | { name: 'waiting'; token: number; code: string; secret: string }
  | { name: 'finishing'; token: number; code: string };

const QC_IDLE: QuickConnect = { name: 'idle' };

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
  const [qc, setQc] = useState<QuickConnect>(QC_IDLE);
  const passwordRef = useRef<TextFieldRef>(null);
  /** Set at once on submit: the keyboard's Go key does not wait for the busy state to render. */
  const signingIn = useRef(false);
  const [qcGate] = useState(createGate);
  /** The Quick Connect phase now, for handlers that run before the next render. */
  const qcRef = useRef<QuickConnect>(QC_IDLE);
  const setPhase = (next: QuickConnect) => {
    qcRef.current = next;
    setQc(next);
  };

  useEffect(() => {
    isQuickConnectEnabled(api).then(setQcEnabled);
  }, [api]);

  // Leaving the page stops Quick Connect: a late answer must not sign in.
  useEffect(() => () => qcGate.cancel(), [qcGate]);

  const signIn = async () => {
    if (signingIn.current || !username.trim()) return;
    signingIn.current = true;
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
      signingIn.current = false;
    }
  };

  // Quick Connect: show a code, poll until the user approves it on another device.
  const startQuickConnect = async () => {
    if (qcRef.current.name !== 'idle') return;
    const token = qcGate.begin();
    setPhase({ name: 'starting', token });
    setError(null);
    try {
      const r = await initiateQuickConnect(api);
      if (!qcGate.current(token)) return;
      if (!r.Secret || !r.Code) throw new Error('The server did not return a code.');
      setPhase({ name: 'waiting', token, code: r.Code, secret: r.Secret });
    } catch (e) {
      if (!qcGate.current(token)) return;
      setPhase(QC_IDLE);
      setError(describeError(e).title);
    }
  };

  const cancelQuickConnect = () => {
    qcGate.cancel();
    setPhase(QC_IDLE);
  };

  const waiting = qc.name === 'waiting' ? qc : null;
  useEffect(() => {
    if (!waiting) return;
    const { token, secret, code } = waiting;
    let polling = true;
    const timer = setInterval(async () => {
      try {
        const s = await quickConnectState(api, secret);
        if (!polling || !qcGate.current(token) || !s.Authenticated) return;
        polling = false;
        clearInterval(timer);
        setPhase({ name: 'finishing', token, code });
        const result = await authenticateWithQuickConnect(api, secret);
        // Cancel or leaving the page while the sign-in ran: drop it.
        if (!qcGate.current(token)) return;
        finish(result);
      } catch (e) {
        if (!qcGate.current(token)) return;
        polling = false;
        clearInterval(timer);
        qcGate.cancel();
        setPhase(QC_IDLE);
        setError(`Quick Connect stopped. ${describeError(e).message}`);
      }
    }, POLL_MS);
    return () => {
      polling = false;
      clearInterval(timer);
    };
    // server is derived from stable params; the poll restarts only for a new code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting?.secret, waiting?.token, api]);

  const qcCode = qc.name === 'waiting' || qc.name === 'finishing' ? qc.code : null;

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
              <Text style={styles.qcHint}>{qc.name === 'finishing' ? 'Approved. Signing in…' : 'Waiting for approval. This page signs in by itself.'}</Text>
              <Button title="Cancel" variant="tonal" onPress={cancelQuickConnect} />
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
                <Button title="Use Quick Connect" icon="qrcode" variant="tonal" onPress={startQuickConnect} loading={qc.name === 'starting'} />
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
