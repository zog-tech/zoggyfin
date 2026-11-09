/**
 * The person's side of an invite. The link opens this screen (or the person
 * pastes the link here). Steps:
 *
 * 1. Confirm: "Join <Server> as <username>?"
 * 2. Find the server: every address of the invite at the same time; only an
 *    address that answers with the invite's server Id gets the password.
 *    When no address answers, the server is saved and the invite waits.
 * 3. Sign in with the one-time password.
 * 4. Set an own password (Skip is allowed, with one reminder).
 * 5. Save the account and go to Home. When the invite has extensions, the
 *    extension system's confirm screen offers them there.
 *
 * The account becomes active only at the end: a new account mounts the app
 * again (each account has its own cache), and that would close this screen.
 *
 * A join belongs to one invite. A new link, a paste or leaving the screen
 * makes it stale (`joinGate`), so the steps of two invites never mix.
 */
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { authenticateByName, findServer } from '@/api/jellyfin';
import type { AuthenticationResult } from '@/api/types';
import { completeSignIn } from '@/auth/sign-in';
import { useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { TvScrollView } from '@/features/tv/page-scroll';
import { changeOwnPassword } from '@/invite/api';
import { canReadClipboard, readClipboard } from '@/invite/clipboard';
import { offerExtensionsLater } from '@/invite/extensions';
import { clearPendingInvite, loadPendingInvite, savePendingInvite, takeIncomingInvite, useIncomingInvite } from '@/invite/incoming';
import { reachInvite } from '@/invite/join';
import { createGate } from '@/lib/async-gate';
import { decodeInvite, type Invite, inviteDate, inviteErrorText, inviteExpired, inviteExpiredText, needsTunnel, payloadFromText, savedAddresses } from '@/invite/payload';
import { pageIsHttps, probeSystemInfo } from '@/servers/connection';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

type Step =
  | { name: 'paste'; error?: string }
  | { name: 'confirm' }
  | { name: 'joining' }
  | { name: 'unreachable' }
  | { name: 'failed'; text: string; title?: string }
  | { name: 'password'; joined: Joined };

interface Joined {
  url: string;
  version: string | null;
  result: AuthenticationResult;
}

const MIN_PASSWORD = 8;

interface ScreenState {
  invite: Invite | null;
  payload: string | null;
  step: Step;
}

/**
 * The screen state for a payload: the confirm step, the paste step with the
 * reason, or "expired" (the app does not send an expired invite's password).
 */
export function viewFor(p: string | null, fromPaste = false, now = Date.now()): ScreenState {
  if (!p) return { invite: null, payload: null, step: { name: 'paste', error: fromPaste ? 'This is not an invite link. Copy the full link from the message.' : undefined } };
  const r = decodeInvite(p);
  if (!r.ok) return { invite: null, payload: null, step: { name: 'paste', error: inviteErrorText(r.error) } };
  if (inviteExpired(r.invite, now)) return { invite: r.invite, payload: p, step: { name: 'failed', text: inviteExpiredText(r.invite), title: 'This invite expired' } };
  return { invite: r.invite, payload: p, step: { name: 'confirm' } };
}

export function AcceptInviteScreen() {
  const s = useStyles(makeStyles);
  // A new link, else an invite that waits for its server.
  const [view, setView] = useState<ScreenState>(() => viewFor(useIncomingInvite.getState().payload ?? loadPendingInvite()));
  const { invite, payload, step } = view;
  const setStep = (next: Step) => setView((v) => ({ ...v, step: next }));
  const [joinGate] = useState(createGate);
  /** True from the tap on Join until the join ends or goes stale. */
  const joining = useRef(false);
  /** Another invite (a new link or a paste): a join of the old one must not touch the screen. */
  const showInvite = (next: ScreenState) => {
    joinGate.cancel();
    joining.current = false;
    setView(next);
  };

  // The link is in the screen now; a new link while the screen is open replaces it.
  useEffect(() => {
    takeIncomingInvite();
    const unsubscribe = useIncomingInvite.subscribe((st) => {
      if (!st.payload) return;
      joinGate.cancel();
      joining.current = false;
      setView(viewFor(takeIncomingInvite()));
    });
    return () => {
      unsubscribe();
      joinGate.cancel();
    };
  }, [joinGate]);

  const join = async () => {
    if (!invite || !payload || joining.current) return;
    // It can expire while the screen is open.
    if (inviteExpired(invite, Date.now())) return setStep({ name: 'failed', text: inviteExpiredText(invite), title: 'This invite expired' });
    const token = joinGate.begin();
    joining.current = true;
    /** Sets the step only while this join is current. */
    const toStep = (next: Step) => {
      if (!joinGate.current(token)) return;
      joining.current = false;
      setStep(next);
    };
    setStep({ name: 'joining' });
    // The invite waits on this device until the join ends, also after a restart.
    savePendingInvite(payload);
    useSessionStore.getState().addServer({ serverId: invite.serverId, serverName: invite.serverName, addresses: savedAddresses(invite) });
    const reach = await reachInvite(invite, probeSystemInfo, { pageIsHttps: pageIsHttps() });
    if (reach.state === 'unreachable') return toStep({ name: 'unreachable' });
    if (reach.state === 'wrong-server') {
      return toStep({ name: 'failed', text: `A different server answers at the address of ${invite.serverName}. Zoggyfin did not send the invite there. Ask for a new invite.` });
    }
    try {
      const info = await findServer(reach.url).catch(() => null);
      const result = await authenticateByName(getApi(reach.url, null), invite.userName, invite.password);
      if (!result.AccessToken || !result.User?.Id) throw new Error('The server did not return a session.');
      toStep({ name: 'password', joined: { url: reach.url, version: info?.info.Version ?? null, result } });
    } catch (e) {
      const d = describeError(e);
      toStep({
        name: 'failed',
        text:
          d.kind === 'auth'
            ? `This invite does not work any more. It was used, revoked or it expired. Ask ${invite.inviter || 'the person who invited you'} for a new invite.`
            : `${d.title}. ${d.message}`,
      });
    }
  };

  const finish = (j: Joined) => {
    if (!invite) return;
    clearPendingInvite();
    if (invite.extensions?.length) offerExtensionsLater(invite.extensions);
    completeSignIn({ url: j.url, serverId: invite.serverId, serverName: invite.serverName, version: j.version }, j.result);
    // Keep all addresses of the invite, not only the one that answered.
    useSessionStore.getState().addServer({ serverId: invite.serverId, serverName: invite.serverName, addresses: savedAddresses(invite) });
    router.replace('/');
  };

  const notNow = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <TvScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.inner}>
          {step.name === 'paste' ? <PasteStep error={step.error} onOpen={(t) => showInvite(viewFor(payloadFromText(t), true))} onCancel={notNow} /> : null}
          {invite && (step.name === 'confirm' || step.name === 'joining') ? (
            <ConfirmStep invite={invite} busy={step.name === 'joining'} onJoin={() => void join()} onCancel={notNow} />
          ) : null}
          {invite && step.name === 'unreachable' ? <UnreachableStep invite={invite} onRetry={() => void join()} onLater={notNow} /> : null}
          {step.name === 'failed' ? (
            <>
              <Text style={s.title}>{step.title ?? 'Could not join'}</Text>
              <Text style={s.body} accessibilityRole="alert">
                {step.text}
              </Text>
              <Button
                title="Close"
                variant="tonal"
                onPress={() => {
                  clearPendingInvite();
                  notNow();
                }}
              />
            </>
          ) : null}
          {invite && step.name === 'password' ? (
            <PasswordStep invite={invite} joined={step.joined} onDone={() => finish(step.joined)} />
          ) : null}
        </View>
      </TvScrollView>
    </KeyboardAvoidingView>
  );
}

function PasteStep({ error, onOpen, onCancel }: { error?: string; onOpen: (text: string) => void; onCancel: () => void }) {
  const s = useStyles(makeStyles);
  const [text, setText] = useState('');
  return (
    <>
      <Text style={s.title}>Join with an invite</Text>
      <Text style={s.body}>Paste the invite link from the message. It starts with https://zoggyfin.zog-tech.com/join. Paste invite reads the link that the invite page copied.</Text>
      <TextField
        label="Invite link"
        value={text}
        onChangeText={setText}
        placeholder="https://zoggyfin.zog-tech.com/join#…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => onOpen(text)}
        accessibilityLabel="Invite link"
      />
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Open invite" onPress={() => onOpen(text)} disabled={!text.trim()} />
      {canReadClipboard ? <Button title="Paste invite" variant="tonal" onPress={() => void readClipboard().then((t) => onOpen(t ?? ''))} /> : null}
      <Button title="Cancel" variant="text" onPress={onCancel} />
    </>
  );
}

function tunnelText(invite: Invite): string | null {
  const t = needsTunnel(invite.addresses);
  if (!t) return null;
  return `Connect to ${invite.serverName}'s ${t === 'tailscale' ? 'Tailscale' : 'VPN'} first, then tap Join.`;
}

function ConfirmStep({ invite, busy, onJoin, onCancel }: { invite: Invite; busy: boolean; onJoin: () => void; onCancel: () => void }) {
  const s = useStyles(makeStyles);
  const tunnel = tunnelText(invite);
  return (
    <>
      <Text style={s.title}>{`Join ${invite.serverName}?`}</Text>
      <Text style={s.body}>
        {invite.inviter ? `${invite.inviter} invited you. ` : ''}
        {`You join as ${invite.userName}. Next, you set your own password.`}
        {invite.expiresAt !== undefined ? ` This link works until ${inviteDate(invite.expiresAt)}.` : ''}
      </Text>
      {tunnel ? <Text style={s.card}>{tunnel}</Text> : null}
      <Button title={busy ? 'Joining' : 'Join'} onPress={onJoin} loading={busy} />
      <Button title="Not now" variant="text" onPress={onCancel} disabled={busy} />
    </>
  );
}

function UnreachableStep({ invite, onRetry, onLater }: { invite: Invite; onRetry: () => void; onLater: () => void }) {
  const s = useStyles(makeStyles);
  const t = needsTunnel(invite.addresses);
  const how = t === 'tailscale' ? 'Connect to its Tailscale' : t === 'vpn' ? 'Connect to its VPN' : 'Connect to its Tailscale or VPN, or check your internet connection,';
  return (
    <>
      <Text style={s.title}>{`Cannot reach ${invite.serverName} yet`}</Text>
      <Text style={s.body}>{`${how} and tap Try again. The invite stays on this device, and ${invite.serverName} is in your servers.`}</Text>
      <Button title="Try again" onPress={onRetry} />
      <Button title="Later" variant="text" onPress={onLater} />
    </>
  );
}

function PasswordStep({ invite, joined, onDone }: { invite: Invite; joined: Joined; onDone: () => void }) {
  const s = useStyles(makeStyles);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminded, setReminded] = useState(false);

  const save = async () => {
    setError(null);
    if (pw.length < MIN_PASSWORD) return setError(`Use ${MIN_PASSWORD} or more characters.`);
    if (pw !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      await changeOwnPassword(getApi(joined.url, joined.result.AccessToken ?? null), joined.result.User?.Id as string, invite.password, pw);
      onDone();
    } catch (e) {
      setError(`${describeError(e).title}. Try again.`);
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={s.title}>Set your password</Text>
      <Text style={s.body}>{`You are in ${invite.serverName} as ${invite.userName}. The password in the invite is for one use. Set your own password now.`}</Text>
      <TextField label="New password" value={pw} onChangeText={setPw} secureTextEntry textContentType="newPassword" autoComplete="new-password" returnKeyType="next" accessibilityLabel="New password" />
      <TextField
        label="New password again"
        value={again}
        onChangeText={setAgain}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        accessibilityLabel="New password again"
      />
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Save password" onPress={() => void save()} loading={busy} disabled={!pw || !again} />
      {reminded ? (
        <Text style={s.card} accessibilityRole="alert">
          Anyone with the invite link can sign in as you until you set a password. You can set it later in the Jellyfin web app, under Profile.
        </Text>
      ) : null}
      <Button title={reminded ? 'Skip for now' : 'Skip'} variant="text" onPress={() => (reminded ? onDone() : setReminded(true))} disabled={busy} />
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  content: { flexGrow: 1, justifyContent: 'center' as const, padding: spacing.xxl },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg },
  title: { ...font(type.largeTitle), color: c.text },
  body: { ...font(type.body), color: c.text2 },
  error: { ...font(type.footnote), color: c.danger },
  card: { ...font(type.subheadline), color: c.text, backgroundColor: c.surface, padding: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' as const },
}));
