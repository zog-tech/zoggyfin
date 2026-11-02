/**
 * Settings, Servers, <server>, Invite someone (administrators only).
 *
 * The short way: type a name, tap Send. The app makes the Jellyfin user with
 * a one-time password and opens the share sheet with the invite link. All
 * libraries, downloads and remote access are on by default; "Options"
 * changes them. An invite works for 7 days (`INVITE_DAYS`). The invites are
 * below: pending ones with their expiry, expired ones (the app deleted the
 * user, cleanup.ts), each with Send again and Revoke (or Remove).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { describeError } from '@/api/errors';
import { scopeKey } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { findServer } from '@/auth/accounts';
import { useAccounts } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { EmptyState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { Group, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { InviteQr } from '@/features/invite/invite-qr';
import { addressChoices, addressWarning, chosenAddresses, LABEL_TEXT } from '@/invite/addresses';
import { createInvitedUser, deleteUser, getLibraries, getUsers, setPasswordAsAdmin } from '@/invite/api';
import { cleanExpiredInvites } from '@/invite/cleanup';
import { inviteExtensions } from '@/invite/extensions';
import { type Invite, INVITE_DAYS, inviteDate, inviteLink, inviteMessage, LIMITS, needsTunnel } from '@/invite/payload';
import { DEFAULT_OPTIONS, type InviteOptions, makeOneTimePassword, usernameFor } from '@/invite/policy';
import { secureRandom } from '@/invite/random';
import { addRecord, type InviteEntry, inviteEntries, newRecord, pruneRecords, readRecords, removeRecord, writeRecords } from '@/invite/records';
import { canCopy, copyText, shareInvite } from '@/invite/share';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, mediaColors, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

interface Sent {
  userName: string;
  link: string;
  message: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** The time for invite records (in event handlers and queries, not in render). */
function nowMs(): number {
  return Date.now();
}

export function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles(makeSettingsStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const server = findServer(useAccounts(), id);
  const { api, session, scope } = useApi();
  const qc = useQueryClient();
  const extensions = useMemo(() => inviteExtensions()?.extensionsForInvite() ?? [], []);

  const [name, setName] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [libs, setLibs] = useState<Set<string> | null>(null); // null: all
  const [allowDownloads, setAllowDownloads] = useState(DEFAULT_OPTIONS.allowDownloads);
  const [allowRemote, setAllowRemote] = useState(DEFAULT_OPTIONS.allowRemote);
  const [vpn, setVpn] = useState<Set<string>>(new Set());
  const choices = useMemo(() => addressChoices(server?.addresses ?? [], vpn), [server?.addresses, vpn]);
  const [chosen, setChosen] = useState<Set<string> | null>(null); // null: the default choice
  const chosenSet = useMemo(() => chosen ?? new Set(choices.filter((x) => x.include).map((x) => x.url)), [chosen, choices]);
  const addresses = chosenAddresses(choices, chosenSet);
  const warning = addressWarning(addresses);
  const [withExtensions, setWithExtensions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  const libraries = useQuery({ queryKey: [...scopeKey(scope), 'invite', 'libraries'], queryFn: () => getLibraries(api), enabled: showOptions });
  const entriesKey = [...scopeKey(scope), 'invite', 'entries'];
  const entries = useQuery({
    queryKey: entriesKey,
    queryFn: async (): Promise<InviteEntry[]> => {
      // First the users of expired invites go (the link stops working on the server).
      await cleanExpiredInvites(api, session.serverId);
      const users = await getUsers(api);
      const now = nowMs();
      writeRecords(pruneRecords(readRecords(), session.serverId, users, now));
      return inviteEntries(readRecords(), session.serverId, users, now);
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: entriesKey });
    // The count in the profile menu.
    void qc.invalidateQueries({ queryKey: [...scopeKey(scope), 'invite', 'pending'] });
  };
  const pendingCount = (entries.data ?? []).filter((e) => e.state === 'pending').length;

  if (!server || server.id !== session.serverId) {
    return (
      <>
        <Stack.Screen options={{ title: 'Invite someone', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
        <EmptyState icon="server.rack" title="Switch to this server first" message="Invites use your account on this server." />
      </>
    );
  }

  const buildInvite = (userName: string, password: string, expiresAt: number): Invite => {
    const inv: Invite = { serverId: server.id, serverName: server.name, addresses, userName, password, inviter: session.userName, expiresAt };
    if (withExtensions && extensions.length) inv.extensions = extensions.slice(0, LIMITS.extensions);
    return inv;
  };

  const share = async (s: Sent) => {
    const r = await shareInvite(s.message, `Join ${server.name}`);
    if (r === 'copied') toast('The invite is copied. Paste it in a message.', { icon: 'checkmark' });
    else if (r === 'failed') toast('Could not open the share sheet. Use the QR code or copy the link.');
  };

  /** The link and the message of an invite that works until `expiresAt`. */
  const sentFor = (userName: string, password: string, expiresAt: number): Sent => {
    const link = inviteLink(buildInvite(userName, password, expiresAt));
    return { userName, link, expiresAt, message: inviteMessage({ inviter: session.userName, serverName: server.name, expiresAt }, link) };
  };

  const send = async () => {
    setError(null);
    const userName = usernameFor(name);
    if (!userName) return setError('Enter a name with letters or numbers.');
    if (warning === 'none') return setError('Choose at least one address.');
    const random = secureRandom();
    if (!random) return setError('This app version cannot make a safe password. Update the app, or invite from the web app.');
    setBusy(true);
    try {
      const password = makeOneTimePassword(random);
      const options: InviteOptions = { libraryIds: libs ? [...libs] : null, allowDownloads, allowRemote };
      const user = await createInvitedUser(api, userName, password, options);
      const record = newRecord({ serverId: server.id, userId: user.Id as string, userName, options }, nowMs());
      addRecord(record);
      const s = sentFor(userName, password, Date.parse(record.expiresAt as string));
      setSent(s);
      setName('');
      refresh();
      setBusy(false);
      void share(s);
    } catch (e) {
      const d = describeError(e);
      setError(
        d.status === 400
          ? `The server did not accept the name "${userName}". A user with this name can exist already. Use another name.`
          : d.kind === 'forbidden' || d.kind === 'auth'
            ? 'Your account cannot add users on this server. Only an administrator can.'
            : `${d.title}. ${d.message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** A new link for 7 more days. The old link stops working (a new one-time password, or a new user after the cleanup). */
  const sendAgain = async (e: InviteEntry) => {
    const r = e.record;
    const random = secureRandom();
    if (!random) return toast('This app version cannot make a safe password.');
    try {
      const password = makeOneTimePassword(random);
      const options = r.options ?? DEFAULT_OPTIONS;
      let userId = r.userId;
      if (r.expired) {
        // The app deleted the user at the expiry: make it again, with the same name and options.
        const user = await createInvitedUser(api, r.userName, password, options);
        userId = user.Id as string;
        removeRecord(server.id, r.userId);
      } else {
        await setPasswordAsAdmin(api, r.userId, password);
      }
      const record = newRecord({ serverId: server.id, userId, userName: r.userName, options }, nowMs());
      addRecord(record);
      const s = sentFor(r.userName, password, Date.parse(record.expiresAt as string));
      setSent(s);
      refresh();
      await share(s);
    } catch (err) {
      const d = describeError(err);
      toast(d.status === 400 ? `The server did not accept the name "${r.userName}". A user with this name exists already.` : d.title);
    }
  };

  /** Pending: deletes the user, so the link stops working. Expired: the user is gone already; the row goes. */
  const revoke = async (e: InviteEntry) => {
    const r = e.record;
    if (e.state === 'pending') {
      if (!(await confirmDestructive(`Revoke the invite for ${r.userName}?`, `This deletes the user ${r.userName} from ${server.name}. The invite link stops working.`, 'Revoke invite'))) return;
    }
    try {
      if (!r.expired) await deleteUser(api, r.userId);
      removeRecord(server.id, r.userId);
      if (sent?.userName === r.userName) setSent(null);
      refresh();
      if (e.state === 'pending') toast(`The invite for ${r.userName} is revoked.`, { icon: 'checkmark' });
    } catch (err) {
      toast(describeError(err).title);
    }
  };

  const toggleSet = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const allLibIds = libraries.data?.map((l) => l.id) ?? [];
  const tunnel = needsTunnel(addresses);

  return (
    <>
      <Stack.Screen options={{ title: 'Invite someone', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {sent ? <SentCard sent={sent} serverName={server.name} onShare={() => void share(sent)} onDone={() => setSent(null)} /> : null}

          <Group footer={`The person gets an account on ${server.name} and a link that signs them in. They set their own password after they join.`}>
            <InviteForm name={name} setName={setName} busy={busy} error={error} onSend={() => void send()} />
          </Group>

          {warning === 'home-only' ? (
            <Note icon="exclamationmark.triangle" text="These addresses work only on your home network. Away from home the person cannot connect. Open Options and add an internet, Tailscale or VPN address." warn />
          ) : null}
          {tunnel ? <Note icon="info.circle" text={`The person must connect to your ${tunnel === 'tailscale' ? 'Tailscale' : 'VPN'} first. The invite tells them.`} /> : null}

          <Group>
            <SettingsRow
              icon="gearshape"
              label="Options"
              value={showOptions ? undefined : 'All libraries'}
              onPress={() => setShowOptions((v) => !v)}
              last
              trailing={<Icon name={showOptions ? 'chevron.up' : 'chevron.down'} size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />}
            />
          </Group>

          {showOptions ? (
            <>
              <Group title="Libraries" footer={libs === null ? 'All libraries, also new ones.' : `${libs.size} of ${allLibIds.length} libraries.`}>
                {libraries.isPending ? <Note text="Loading the libraries." /> : null}
                {libraries.isError ? <Note text="Could not load the libraries. All libraries stay on." warn /> : null}
                {(libraries.data ?? []).map((l, i, arr) => {
                  const on = libs === null || libs.has(l.id);
                  return (
                    <CheckRow
                      key={l.id}
                      label={l.name}
                      checked={on}
                      last={i === arr.length - 1}
                      onPress={() => {
                        const next = toggleSet(libs ?? new Set(allLibIds), l.id);
                        setLibs(next.size === allLibIds.length ? null : next);
                      }}
                    />
                  );
                })}
              </Group>
              <Group title="Permissions" footer="The person is never an administrator.">
                <SwitchRow icon="arrow.down.circle" label="Allow downloads" value={allowDownloads} onChange={setAllowDownloads} />
                <SwitchRow icon="globe" label="Allow access away from home" value={allowRemote} onChange={setAllowRemote} last />
              </Group>
              <Group title="Addresses in the invite" footer="The app of the person tries these addresses and uses the first one that answers. Home network addresses work only at your home.">
                {choices.map((a, i) => (
                  <View key={a.url}>
                    <CheckRow
                      label={a.url}
                      sub={LABEL_TEXT[a.label]}
                      checked={chosenSet.has(a.url)}
                      last={i === choices.length - 1 && !(a.label === 'home' || vpn.has(a.url))}
                      onPress={() => setChosen(toggleSet(chosenSet, a.url))}
                    />
                    {a.label === 'home' || vpn.has(a.url) ? (
                      <MarkVpn
                        on={vpn.has(a.url)}
                        onPress={() => {
                          const next = toggleSet(vpn, a.url);
                          setVpn(next);
                          // A VPN address works away from home: include it.
                          if (next.has(a.url)) setChosen(new Set([...chosenSet, a.url]));
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </Group>
              {extensions.length ? (
                <Group title="Extensions" footer={`The person gets an offer to add them: ${extensions.map((u) => u.replace(/^https?:\/\//, '')).join(', ')}`}>
                  <SwitchRow icon="square.grid.2x2" label="Include my extensions" value={withExtensions} onChange={setWithExtensions} last />
                </Group>
              ) : null}
            </>
          ) : null}

          <Group
            title={pendingCount ? `Pending invites · ${pendingCount}` : 'Pending invites'}
            footer={`People who did not sign in yet. An invite works for ${INVITE_DAYS} days. Send again makes a new link for ${INVITE_DAYS} more days; the old link stops working. When an invite expires, Zoggyfin deletes the account that was never used.`}>
            {entries.isPending ? <Note text="Loading." /> : null}
            {entries.isError ? <Note text="Could not load the users of this server." warn /> : null}
            {entries.data && !entries.data.length ? <Note text="No pending invites." /> : null}
            {(entries.data ?? []).map((e) => (
              <InviteRow key={e.record.userId} entry={e} onSendAgain={() => void sendAgain(e)} onRevoke={() => void revoke(e)} />
            ))}
          </Group>
        </View>
      </TvScrollView>
    </>
  );
}

function InviteForm({ name, setName, busy, error, onSend }: { name: string; setName: (s: string) => void; busy: boolean; error: string | null; onSend: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.pad}>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Jane Doe"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={onSend}
        accessibilityLabel="Name of the person"
        maxLength={64}
      />
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Send invite" icon="person.badge.plus" onPress={onSend} loading={busy} disabled={!name.trim()} />
    </View>
  );
}

function SentCard({ sent, serverName, onShare, onDone }: { sent: Sent; serverName: string; onShare: () => void; onDone: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <Group
      title={`Invite for ${sent.userName}`}
      footer={`This link works until ${inviteDate(sent.expiresAt)}. Show the QR code to a person in the same room. The link has a one-time password: send it only to this person.`}>
      <View style={[s.pad, s.center]}>
        <InviteQr value={sent.link} size={scaled(220)} label={`QR code of the invite to ${serverName}`} />
        <View style={s.buttons}>
          <Button title="Share again" variant="smallTonal" onPress={onShare} />
          {canCopy ? (
            <Button
              title="Copy link"
              variant="smallTonal"
              onPress={() => void copyText(sent.link).then((ok) => toast(ok ? 'The link is copied.' : 'Could not copy the link.'))}
            />
          ) : null}
          <Button title="Done" variant="text" onPress={onDone} />
        </View>
      </View>
    </Group>
  );
}

/** "Expires October 27, 2026" or "Expired October 27, 2026". */
export function inviteRowText(e: Pick<InviteEntry, 'state' | 'expiresAt'>): string {
  if (!Number.isFinite(e.expiresAt)) return e.state === 'expired' ? 'Expired' : '';
  return `${e.state === 'expired' ? 'Expired' : 'Expires'} ${inviteDate(e.expiresAt)}`;
}

function InviteRow({ entry, onSendAgain, onRevoke }: { entry: InviteEntry; onSendAgain: () => void; onRevoke: () => void }) {
  const s = useStyles(makeStyles);
  const rs = useStyles(makeSettingsStyles);
  const name = entry.record.userName;
  const expired = entry.state === 'expired';
  return (
    <View style={[s.pad, s.pendingRow, rs.rowBorder]}>
      <View style={s.flex}>
        <Text style={rs.label} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[s.sub, expired ? s.expired : null]}>{inviteRowText(entry)}</Text>
      </View>
      <Button title="Send again" variant="smallTonal" onPress={onSendAgain} accessibilityLabel={`Send the invite for ${name} again`} />
      <Touchable
        onPress={onRevoke}
        hitSlop={8}
        radius={8}
        accessibilityRole="button"
        accessibilityLabel={expired ? `Remove the expired invite for ${name}` : `Revoke the invite for ${name}`}
        style={s.cancel}>
        <Text style={expired ? s.removeText : s.cancelText}>{expired ? 'Remove' : 'Revoke'}</Text>
      </Touchable>
    </View>
  );
}

function CheckRow({ label, sub, checked, last, onPress }: { label: string; sub?: string; checked: boolean; last?: boolean; onPress: () => void }) {
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || (focused && !isTV)) && rs.rowPressed]}>
      <Icon name={checked ? 'checkmark.circle.fill' : 'circle'} size={scaled(iconSize.md)} color={checked ? c.accent : c.text3} />
      <View style={[rs.row, rs.rowBody, !last && rs.rowBorder]}>
        <View style={s.flex}>
          <Text style={rs.label} numberOfLines={1}>
            {label}
          </Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
        </View>
      </View>
    </Touchable>
  );
}

function MarkVpn({ on, onPress }: { on: boolean; onPress: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <Touchable onPress={onPress} accessibilityRole="button" style={s.markVpn}>
      <Text style={s.link}>{on ? 'Not a VPN address' : 'This is a VPN address (WireGuard)'}</Text>
    </Touchable>
  );
}

function SwitchRow({ icon, label, value, onChange, last }: { icon: 'arrow.down.circle' | 'globe' | 'square.grid.2x2'; label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const { c } = useTheme();
  return (
    <SettingsRow
      icon={icon}
      label={label}
      role="switch"
      checked={value}
      onPress={() => onChange(!value)}
      last={last}
      trailing={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: c.accent, false: c.surface3 }}
          thumbColor={mediaColors.white}
          {...webSwitchColors}
          accessibilityLabel={label}
        />
      }
    />
  );
}

function Note({ text, icon, warn }: { text: string; icon?: 'info.circle' | 'exclamationmark.triangle'; warn?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={[s.note, s.pad]}>
      {icon ? <Icon name={icon} size={scaled(iconSize.sm)} color={warn ? c.warning : c.text2} /> : null}
      <Text style={[s.noteText, warn ? { color: c.warning } : null]}>{text}</Text>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  pad: { padding: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center' as const },
  buttons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  error: { ...font(type.footnote), color: c.danger },
  sub: { ...font(type.footnote), color: c.text2 },
  note: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
  noteText: { ...font(type.subheadline), color: c.text2, flex: 1 },
  pendingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: spacing.sm, minHeight: scaled(sizes.settingsRow) },
  cancel: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  cancelText: { ...font(type.subheadline), color: c.danger },
  removeText: { ...font(type.subheadline), color: c.text2 },
  expired: { color: c.warning },
  markVpn: { paddingLeft: spacing.lg + scaled(iconSize.md) + spacing.md, paddingBottom: spacing.sm, borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  link: { ...font(type.footnote), color: c.accent },
}));
