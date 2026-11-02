import axios from 'axios';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';

import { findServer as probeServer } from '@/api/jellyfin';
import { normalizeServerUrl } from '@/api/server-url';
import { type SavedServer, startUrl } from '@/auth/accounts';
import { staleSince } from '@/auth/server-identity';
import { useAccounts, useSession, useSessionStore } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { EmptyState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { InviteSection } from '@/features/invite/invite-section';
import { openAddUser, removeServerFlow, signOutUser, switchAccount } from '@/features/servers/actions';
import { checkAgain, ConnectionStatus } from '@/features/servers/connection-status';
import { ActionRow, Group, InfoRow, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import {
  PROBE_TIMEOUT_MS,
  probeOne,
  addAddress,
  type AddressKind,
  blockedByMixedContent,
  type ConnectionMode,
  failureText,
  guessKind,
  moveAddress,
  type ServerAddress,
  sameServerId,
} from '@/servers/addresses';
import { pageIsHttps, probeSystemInfo, useConnection } from '@/servers/connection';
import { networkSource } from '@/servers/network-source';
import { KIND_LABEL, MIXED_CONTENT_TEXT } from '@/servers/status';
import { cleanSsids, parseSsidList } from '@/servers/wifi-rule';
import { createStyles, type AppTheme, font, iconSize, mediaColors, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

const MODES: { value: ConnectionMode; label: string; icon: 'gauge' | 'house' | 'globe' }[] = [
  { value: 'auto', label: 'Automatic', icon: 'gauge' },
  { value: 'internal', label: 'Always internal', icon: 'house' },
  { value: 'external', label: 'Always external', icon: 'globe' },
];

/** One saved server: its addresses, the connection mode, the Wi-Fi rule and its users. */
export default function ServerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles(makeSettingsStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const accounts = useAccounts();
  const server = accounts.servers.find((s) => s.id === id) ?? null;
  const known = useConnection(id).status !== 'unknown';
  // A server that is not active was not checked yet: check it when its page opens.
  useEffect(() => {
    if (id && !known) checkAgain(id);
  }, [id, known]);

  if (!server) {
    return (
      <>
        <Stack.Screen options={{ title: 'Server', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
        <EmptyState icon="server.rack" title="This server is not saved" message="It was removed from this device." />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: server.name, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Group>
            <ConnectionStatus serverId={server.id} inset={false} />
          </Group>
          <AddressesSection server={server} />
          <ModeSection server={server} />
          {networkSource.available && Platform.OS !== 'web' ? <WifiSection server={server} /> : null}
          <UsersSection server={server} />
          <InviteSection serverId={server.id} />
          <Group title="About">
            <InfoRow icon="server.rack" label="Name" value={server.name} />
            <InfoRow icon="info.circle" label="Version" value={server.version ? `Jellyfin ${server.version}` : 'Unknown'} last />
          </Group>
          <Group>
            <ActionRow
              label="Remove server"
              onPress={async () => {
                if (!(await removeServerFlow(server.id))) return;
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/(home)/settings');
              }}
            />
          </Group>
        </View>
      </TvScrollView>
    </>
  );
}

function save(server: SavedServer, patch: Parameters<ReturnType<typeof useSessionStore.getState>['updateServer']>[1]) {
  useSessionStore.getState().updateServer(server.id, patch);
  checkAgain(server.id);
}

// ---- Addresses -------------------------------------------------------------------

function AddressesSection({ server }: { server: SavedServer }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [found, setFound] = useState<{ state: 'idle' | 'busy' | 'none' | 'known' | 'offer' | 'error'; url?: string; text?: string; answers?: boolean }>({
    state: 'idle',
  });
  const info = useConnection(server.id);

  /** "Find addresses": the server reports its LAN address in /System/Info/Public (LocalAddress). */
  const find = async () => {
    setFound({ state: 'busy' });
    const from = info.url ?? startUrl(server);
    if (!from) return setFound({ state: 'error', text: 'The server has no address to ask.' });
    try {
      const res = await fetchLocalAddress(from);
      if (!sameServerId(res.id, server.id)) return setFound({ state: 'error', text: 'A different server answered. Nothing was added.' });
      const local = res.local ? normalizeServerUrl(res.local) : null;
      if (!local) return setFound({ state: 'none', text: 'The server does not report a home network address.' });
      if (server.addresses.some((a) => a.url === local)) return setFound({ state: 'known', url: local, text: `The server reports ${local}. It is in the list.` });
      // A server in a container often reports an address that only the container sees.
      const check = await probeOne(local, server.id, probeSystemInfo, PROBE_TIMEOUT_MS);
      setFound({ state: 'offer', url: local, answers: check.ok });
    } catch (e) {
      if (__DEV__) console.warn('[servers] find addresses failed', e);
      setFound({ state: 'error', text: 'No address of the server answers now. Try again on a network where it answers.' });
    }
  };

  const addFound = () => {
    if (!found.url) return;
    // The LAN address goes first: at home it answers first; away it fails fast and the next one is used.
    const list = addAddress(server.addresses, found.url, 'internal');
    const moved = moveAddress(list, list.length - 1, 0);
    save(server, { addresses: moved });
    setFound({ state: 'idle' });
  };

  return (
    <Group
      title="Addresses"
      footer="The app tries every address at the same time and uses the first one in this list that answers. It sends your sign-in only to an address where this server answers.">
      {server.addresses.map((a, i) => (
        <AddressRow key={a.url} address={a} index={i} server={server} onPress={() => setEditing(i)} />
      ))}
      {found.state === 'offer' && found.url ? <FoundRow url={found.url} answers={!!found.answers} onAdd={addFound} onDismiss={() => setFound({ state: 'idle' })} /> : null}
      {found.state === 'none' || found.state === 'known' || found.state === 'error' ? <NoteRow text={found.text ?? ''} /> : null}
      <SettingsRow icon="plus" label="Add address" onPress={() => setEditing('new')} />
      <SettingsRow
        icon="magnifyingglass"
        label={found.state === 'busy' ? 'Finding addresses' : 'Find addresses'}
        onPress={() => void find()}
        last
        trailing={<View />}
      />
      <AddressSheet
        server={server}
        index={editing}
        onClose={() => setEditing(null)}
      />
    </Group>
  );
}

async function fetchLocalAddress(url: string): Promise<{ id: string | null; local: string | null }> {
  const res = await axios.get<{ Id?: string | null; LocalAddress?: string | null }>(`${url}/System/Info/Public`, { timeout: 4000 });
  return { id: res.data?.Id ?? null, local: res.data?.LocalAddress ?? null };
}

function AddressRow({ address, index, server, onPress }: { address: ServerAddress; index: number; server: SavedServer; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const rs = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const info = useConnection(server.id);
  const result = info.results[address.url];
  const inUse = info.status === 'connected' && info.url === address.url;
  const last = false;
  const [now] = useState(() => Date.now());
  const stale = result?.ok ? null : staleSince(address, now);
  let status = 'Not checked yet';
  if (blockedByMixedContent(address.url, pageIsHttps())) status = failureText('mixed-content');
  else if (result?.ok) status = `Answers in ${result.ms} ms`;
  else if (stale !== null) status = `Not reached since ${new Date(stale).toLocaleDateString()}`;
  else if (result && !result.ok) status = failureText(result.reason);
  if (address.found) status = `Found on this network · ${status}`;
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${index + 1}. ${address.url}, ${KIND_LABEL[address.kind]}. ${status}${inUse ? '. In use' : ''}. Edit`}
      style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || (focused && !isTV)) && rs.rowPressed]}>
      <View style={rs.leading}>
        <Icon name={address.kind === 'internal' ? 'house' : 'globe'} size={scaled(iconSize.sm - 1)} color={mediaColors.white} />
      </View>
      <View style={[rs.row, rs.rowBody, !last && rs.rowBorder]}>
        <View style={s.addrText}>
          <Text style={s.url} numberOfLines={1}>
            {address.url}
          </Text>
          <Text style={[s.sub, result && !result.ok ? { color: c.warning } : null]} numberOfLines={2}>
            {`${address.kind === 'internal' ? 'Internal' : 'External'} · ${status}`}
          </Text>
        </View>
        {inUse ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>In use</Text>
          </View>
        ) : null}
        {/* One tap removes an address that has not answered for a long time. The app never removes one by itself. */}
        {stale !== null && server.addresses.length > 1 ? (
          <Button
            title="Remove"
            variant="smallTonal"
            accessibilityLabel={`Remove ${address.url}`}
            onPress={() => save(server, { addresses: server.addresses.filter((x) => x.url !== address.url) })}
          />
        ) : null}
        <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
      </View>
    </Touchable>
  );
}

function FoundRow({ url, answers, onAdd, onDismiss }: { url: string; answers: boolean; onAdd: () => void; onDismiss: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.found}>
      <Text style={s.foundText}>
        {answers
          ? `The server reports a home network address: ${url}. It answers from this device.`
          : `The server reports a home network address: ${url}. It does not answer from this device now. This is usual when the server runs in a container; then enter the address of the computer instead.`}
      </Text>
      <View style={s.buttons}>
        <Button title={answers ? 'Add as internal address' : 'Add anyway'} variant={answers ? 'small' : 'smallTonal'} icon="plus" onPress={onAdd} />
        <Button title="Not now" variant="text" onPress={onDismiss} />
      </View>
    </View>
  );
}

function NoteRow({ text }: { text: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.found}>
      <Text style={s.foundText}>{text}</Text>
    </View>
  );
}

/** Add or edit one address: the URL, the kind, the order, remove. A new URL must answer as this server. */
function AddressSheet({ server, index, onClose }: { server: SavedServer; index: number | 'new' | null; onClose: () => void }) {
  const current = typeof index === 'number' ? server.addresses[index] : null;
  return (
    <Sheet visible={index !== null} title={current ? 'Edit address' : 'Add address'} onClose={onClose}>
      {index !== null ? <AddressForm key={String(index)} server={server} index={index} onClose={onClose} /> : null}
    </Sheet>
  );
}

function AddressForm({ server, index, onClose }: { server: SavedServer; index: number | 'new'; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const current = typeof index === 'number' ? server.addresses[index] : null;
  const [url, setUrl] = useState(current?.url ?? '');
  const [kind, setKind] = useState<AddressKind>(current?.kind ?? 'external');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<string | null>(null);

  const commit = (finalUrl: string) => {
    const others = server.addresses.filter((_, i) => i !== index);
    if (others.some((a) => a.url === finalUrl)) {
      setError('This address is in the list.');
      return;
    }
    const next: ServerAddress = { url: finalUrl, kind };
    const list = typeof index === 'number' ? server.addresses.map((a, i) => (i === index ? next : a)) : [...server.addresses, next];
    save(server, { addresses: list });
    onClose();
  };

  const submit = async () => {
    setError(null);
    setUnchecked(null);
    const text = url.trim();
    if (current && normalizeServerUrl(text) === current.url) {
      commit(current.url);
      return;
    }
    if (pageIsHttps() && /^http:\/\//i.test(text)) {
      // The browser cannot reach it from this page; save it for the apps and http pages.
      const n = normalizeServerUrl(text);
      if (!n) return setError('Enter an address, for example https://jellyfin.example.com');
      setError(MIXED_CONTENT_TEXT);
      setUnchecked(n);
      return;
    }
    setBusy(true);
    try {
      const { url: found, info } = await probeServer(text);
      if (!sameServerId(info.Id, server.id)) {
        setError(`A different Jellyfin server (${info.ServerName ?? 'no name'}) answers at this address. The app does not send your sign-in there.`);
        return;
      }
      commit(found);
    } catch {
      const n = normalizeServerUrl(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
      if (!n) {
        setError('Enter an address, for example https://jellyfin.example.com');
        return;
      }
      setError('No answer from this address now. You can save it, and the app uses it when it answers as this server.');
      setUnchecked(n);
    } finally {
      setBusy(false);
    }
  };

  const move = (to: number) => {
    if (typeof index !== 'number') return;
    save(server, { addresses: moveAddress(server.addresses, index, to) });
    onClose();
  };

  const remove = () => {
    if (typeof index !== 'number') return;
    if (server.addresses.length <= 1) {
      setError('A server needs one address. Add another address first.');
      return;
    }
    save(server, { addresses: server.addresses.filter((_, i) => i !== index) });
    onClose();
  };

  return (
      <View style={s.sheet}>
        <TextField
          label="Address"
          value={url}
          onChangeText={(t) => {
            setUrl(t);
            if (!current) setKind(guessKind(/^[a-z]+:\/\//i.test(t) ? t : `http://${t}`));
          }}
          placeholder="https://jellyfin.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Address"
        />
        <View style={s.chips} accessibilityRole="radiogroup">
          <Chip label="Internal" icon="house" selected={kind === 'internal'} onPress={() => setKind('internal')} accessibilityLabel="Internal: home network" />
          <Chip label="External" icon="globe" selected={kind === 'external'} onPress={() => setKind('external')} accessibilityLabel="External: internet" />
        </View>
        <Text style={s.hint}>Internal is an address on your home network. External is an address on the internet.</Text>
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {unchecked ? <Button title="Save without a check" variant="tonal" onPress={() => commit(unchecked)} /> : null}
        <Button title={current ? 'Save' : 'Add'} onPress={() => void submit()} loading={busy} disabled={!url.trim()} />
        {typeof index === 'number' ? (
          <View style={s.buttons}>
            <Button title="Move up" variant="smallTonal" icon="arrow.up" disabled={index === 0} onPress={() => move(index - 1)} />
            <Button title="Move down" variant="smallTonal" icon="arrow.down" disabled={index >= server.addresses.length - 1} onPress={() => move(index + 1)} />
            <Button title="Remove" variant="smallTonal" icon="trash" onPress={remove} />
          </View>
        ) : null}
      </View>
  );
}

// ---- Mode ------------------------------------------------------------------------

function ModeSection({ server }: { server: SavedServer }) {
  const { c } = useTheme();
  return (
    <Group title="Connection" footer="Automatic uses the first address that answers. Always internal and Always external use only the addresses of that kind.">
      {MODES.map((m, i) => (
        <SettingsRow
          key={m.value}
          icon={m.icon}
          label={m.label}
          role="radio"
          checked={server.mode === m.value}
          onPress={() => save(server, { mode: m.value })}
          last={i === MODES.length - 1}
          trailing={server.mode === m.value ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : <View />}
        />
      ))}
    </Group>
  );
}

// ---- Wi-Fi rule ------------------------------------------------------------------

function WifiSection({ server }: { server: SavedServer }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [text, setText] = useState(server.wifi.ssids.join(', '));
  const [note, setNote] = useState<string | null>(null);

  const toggle = async (on: boolean) => {
    setNote(null);
    if (on && !(await networkSource.requestPermission())) {
      setNote('The Wi-Fi rule needs location access. iOS tells apps the Wi-Fi name only with it. Allow location for Zoggyfin in Settings, then try again.');
      return;
    }
    save(server, { wifi: { ...server.wifi, enabled: on } });
  };

  const fillCurrent = async () => {
    setNote(null);
    if (!(await networkSource.requestPermission())) {
      setNote('Allow location access for Zoggyfin in Settings. iOS tells apps the Wi-Fi name only with it.');
      return;
    }
    const net = await networkSource.snapshot();
    if (!net || net.type !== 'wifi') return setNote('This device is not on Wi-Fi now.');
    if (!net.ssid) return setNote('The system did not tell the Wi-Fi name. Check that location access is on and precise.');
    const ssids = cleanSsids([...server.wifi.ssids, net.ssid]);
    setText(ssids.join(', '));
    save(server, { wifi: { ...server.wifi, ssids } });
  };

  const commitText = () => save(server, { wifi: { ...server.wifi, ssids: parseSsidList(text) } });
  const off = server.mode !== 'auto';

  return (
    <Group
      title="Wi-Fi rule"
      footer={
        off
          ? 'The Wi-Fi rule works only in Automatic mode.'
          : 'On these Wi-Fi networks the app uses the internal address. On other Wi-Fi networks and on cellular it uses the external address. When that address does not answer, the app uses the address that answers.'
      }>
      <SettingsRow
        icon="wifi"
        label="Use the internal address on home Wi-Fi"
        role="switch"
        checked={server.wifi.enabled}
        onPress={() => void toggle(!server.wifi.enabled)}
        last={!server.wifi.enabled && !note}
        trailing={
          <Switch
            value={server.wifi.enabled}
            onValueChange={(v) => void toggle(v)}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Use the internal address on home Wi-Fi"
          />
        }
      />
      {server.wifi.enabled ? (
        <View style={s.sheet}>
          <TextField
            label="Wi-Fi names"
            value={text}
            onChangeText={setText}
            onBlur={commitText}
            onSubmitEditing={commitText}
            placeholder="Home, Home 5G"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Wi-Fi names, separated by commas"
          />
          <Button title="Use current Wi-Fi" variant="smallTonal" icon="wifi" onPress={() => void fillCurrent()} />
        </View>
      ) : null}
      {note ? <NoteRow text={note} /> : null}
    </Group>
  );
}

// ---- Users -----------------------------------------------------------------------

function UsersSection({ server }: { server: SavedServer }) {
  const s = useStyles(makeStyles);
  const rs = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const session = useSession();
  const url = session?.serverId === server.id ? session.serverUrl : (startUrl(server) ?? '');
  return (
    <Group title="Users" footer="Tap a user to switch to it.">
      {server.users.map((u) => {
        const active = session?.serverId === server.id && session.userId === u.userId;
        return (
          <View key={u.userId} style={rs.rowPad}>
            <Touchable
              kind="row"
              onPress={() => switchAccount({ serverId: server.id, userId: u.userId })}
              accessibilityRole="button"
              accessibilityLabel={active ? `${u.userName}, active` : `Switch to ${u.userName}`}
              containerStyle={s.flex}
              style={s.userTap}>
              <Avatar session={{ serverId: server.id, serverUrl: url, userId: u.userId, userName: u.userName, userImageTag: u.userImageTag, token: null }} size={scaled(30)} />
              <Text style={[rs.label, s.flex]} numberOfLines={1}>
                {u.userName}
              </Text>
              {active ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
            </Touchable>
            <Touchable
              onPress={() => void signOutUser({ serverId: server.id, userId: u.userId })}
              hitSlop={8}
              radius={8}
              accessibilityRole="button"
              accessibilityLabel={`Sign ${u.userName} out`}
              style={s.signOut}>
              <Text style={s.signOutText}>Sign out</Text>
            </Touchable>
          </View>
        );
      })}
      <SettingsRow icon="person.badge.plus" label="Add user" onPress={() => openAddUser(server.id)} last />
    </Group>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  addrText: { flex: 1, gap: 2 },
  url: { ...font(type.body), color: c.text },
  sub: { ...font(type.footnote), color: c.text2 },
  badge: { backgroundColor: c.accentSoft, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999 },
  badgeText: { ...font(type.caption1), color: c.accent, fontWeight: '600' as const },
  found: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  foundText: { ...font(type.subheadline), color: c.text2 },
  buttons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm, alignItems: 'center' as const },
  sheet: { gap: spacing.md, padding: spacing.lg },
  chips: { flexDirection: 'row' as const, gap: spacing.sm },
  hint: { ...font(type.footnote), color: c.text2 },
  error: { ...font(type.footnote), color: c.danger },
  userTap: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, minHeight: scaled(sizes.settingsRow), paddingVertical: spacing.sm },
  signOut: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  signOutText: { ...font(type.subheadline), color: c.danger },
}));
