/**
 * The Together sheet ("Watch together" / "Listen together"): one hub for
 * every session. Join a session (nearby or on the server, one list), start
 * one ("Who can join?", then the room opens and the user picks what to play
 * with the normal app), or join with a code. In a session: the
 * people, the session settings (controls, new people, who can find it) and
 * end or leave. Nearby help: who can find the host, join codes, hotspots
 * and the guest's help card.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { useOffline } from '@/lib/online';
import { features } from '@/platform/tv';
import { isAudioItem } from '@/player';
import { usePlayerStore } from '@/player/store';
import { networkSource } from '@/servers/network-source';
import { spacing, useStyles, useTheme } from '@/theme';
import { wifiQr } from '@/together/join-code';
import { canHostNearby, nearby, nearbySupported } from '@/together/nearby';
import { guestHelp, HELP_DELAY_MS, helpCopy, type HelpItem, type HelpPlatform, type NetworkInfo } from '@/together/nearby-help';
import { linkNative } from '@/together/nearby-native';
import { closeTogetherSheet, openTogetherSheet, pastLobby, releaseTogetherSheet, setTogether, type SheetPlace, type TogetherState, useTogetherStore } from '@/together/store';
import { canSyncPlay, syncPlay, syncPlaySupported } from '@/together/syncplay';
import { groupStateLabel } from '@/together/syncplay-logic';
import { joinTransport, mergeSessions, playForEveryone, SERVER_CONTROLS_TEXT, type SessionRow, sessionHeadline, shortName } from '@/together/hub';
import { SHOWN_REQUESTS, visibleRequests } from '@/together/join-gate';
import type { Member } from '@/together/protocol';

import { QrCode } from './qr-code';
import { startSession, type StartTarget, targetFor, WhoStep } from './start-flow';
import { ChoiceRow, makeStyles, RowIcon, Section } from './together-parts';

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
const AUDIO_ENTRY_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum']);

/** True for the audio items that can start a "Listen together" session: a track, an audiobook, an album or an audio playlist. */
function isAudioEntry(item: BaseItemDto): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return AUDIO_ENTRY_TYPES.has(item.Type ?? '');
}

export interface TogetherEntry {
  open: () => void;
  /** "Watch together" or "Listen together". */
  label: string;
}

/** The item page's "Together" action, or null where watch or listen together does not apply. */
export function useTogetherEntry(item: BaseItemDto): TogetherEntry | null {
  const signedIn = useSessionStore((s) => !!s.session);
  const inSession = useTogetherStore((x) => playForEveryone(x) !== null);
  const video = VIDEO_TYPES.has(item.Type ?? '');
  if (!features.watchTogether || (!video && !isAudioEntry(item))) return null;
  if (!nearbySupported && !(syncPlaySupported && signedIn)) return null;
  // In a session, the item's Play button plays for everyone; this opens the session sheet.
  return { open: () => openTogetherSheet('item', inSession ? null : item), label: inSession ? 'Together' : video ? 'Watch together' : 'Listen together' };
}

/**
 * The item page's Play button in a session: "Play for everyone", or
 * "Only the host picks" (locked) for a guest when only the host picks.
 * Null with no session.
 */
export function usePlayForEveryone(): { label: string; locked: boolean } | null {
  const label = useTogetherStore((x) => playForEveryone(x)?.label ?? null);
  const locked = useTogetherStore((x) => playForEveryone(x)?.locked ?? false);
  return label ? { label, locked } : null;
}

/** Mount once per screen that can open the sheet; it shows only for its own screen. */
export function TogetherSheetHost({ where }: { where: SheetPlace }) {
  const open = useTogetherStore((s) => s.sheet.open && s.sheet.where === where);
  const seq = useTogetherStore((s) => s.sheet.seq);
  useEffect(() => () => releaseTogetherSheet(where), [where]);
  return open ? <TogetherSheet key={seq} /> : null;
}

/** What the sheet needs to know about this device. The preview screen gives fake values. */
export interface SheetEnv {
  nearbyOn: boolean;
  platform: HelpPlatform;
  /** This device can make a Wi-Fi network (Android local-only hotspot). */
  canMakeHotspot: boolean;
  network: NetworkInfo | null;
  /** Date.now() of the last render tick, for the help card delay. */
  now: number;
}

function devicePlatform(): HelpPlatform {
  if (Platform.OS === 'android') return 'android';
  return Platform.OS === 'ios' ? 'ios' : 'mac';
}

const isApple = (p: HelpPlatform) => p !== 'android';

/** The device facts for the sheet. Reads the network once and ticks when the help card is due. */
function useSheetEnv(browsingSince: number | null): SheetEnv {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nearbySupported) return;
    let live = true;
    networkSource
      .snapshot()
      .then((snap) => {
        if (live) setNetwork(snap);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (browsingSince === null) return;
    const due = browsingSince + HELP_DELAY_MS - Date.now();
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, due) + 50);
    return () => clearTimeout(t);
  }, [browsingSince]);
  return {
    nearbyOn: nearbySupported,
    platform: devicePlatform(),
    canMakeHotspot: typeof linkNative?.startHotspot === 'function',
    network,
    now,
  };
}

/** "Listen together" for audio, else "Watch together". */
export function sheetTitle(st: TogetherState, item: BaseItemDto | null): string {
  const inSession = st.mode !== 'none' && st.phase.name !== 'idle' && st.phase.name !== 'browsing';
  if (st.sheet.where === 'hub' && !pastLobby(st)) return 'Together';
  const audio = st.sheet.where === 'music' || (!!item && isAudioItem(item)) || (inSession && st.kind === 'audio');
  return audio ? 'Listen together' : 'Watch together';
}

function TogetherSheet() {
  const st = useTogetherStore();
  const playing = usePlayerStore((s) => s.now?.item ?? null);
  // The join place (sign-in screen, offline banner) only joins; hosting starts from a playing download.
  const item: BaseItemDto | null = st.sheet.where === 'join' ? null : (st.sheet.item ?? playing);
  const signedIn = useSessionStore((s) => !!s.session);
  const offline = useOffline();
  const env = useSheetEnv(st.browsingSince);
  const nearbySession = st.mode === 'nearby' && st.phase.name !== 'browsing' && st.phase.name !== 'idle';
  const group = st.syncplay.group;
  const lobby = !nearbySession && !group;

  // In the lobby: look for nearby sessions and SyncPlay groups.
  useEffect(() => {
    if (!lobby) return;
    if (nearbySupported) nearby().browse();
    if (signedIn && !offline && syncPlaySupported) void syncPlay().refreshGroups();
  }, [lobby, signedIn, offline]);

  const close = () => {
    closeTogetherSheet();
    // Stop looking when nothing was joined.
    const s = useTogetherStore.getState();
    if (s.mode === 'nearby' && (s.phase.name === 'browsing' || s.phase.name === 'idle')) void nearby().stopAll().then(() => setTogether({ notice: null }));
  };

  const base = sheetTitle(st, item);
  const title = group ? group.name : nearbySession ? (st.item ? st.item.album || st.item.name : 'Together') : base;
  return (
    <Sheet visible title={title} onClose={close} doneLabel="Done" fixedHeight>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
        <TogetherSheetContent st={st} item={item} signedIn={signedIn} offline={offline} env={env} />
      </ScrollView>
    </Sheet>
  );
}

/** The sheet body for a state. Exported for the development preview screen. */
export function TogetherSheetContent({
  st,
  item,
  signedIn,
  offline,
  env,
}: {
  st: TogetherState;
  item: BaseItemDto | null;
  signedIn: boolean;
  offline: boolean;
  env: SheetEnv;
}) {
  const nearbySession = st.mode === 'nearby' && st.phase.name !== 'browsing' && st.phase.name !== 'idle';
  if (st.syncplay.group) return <GroupView st={st} item={item} />;
  if (nearbySession) return <NearbyView st={st} env={env} />;
  return <Lobby st={st} item={item} signedIn={signedIn} offline={offline} env={env} />;
}

// ---- Lobby (the Together hub) -------------------------------------------------------

/** `target` null: an empty room (the host picks with the normal app). */
type LobbyStep = { name: 'main' } | { name: 'who'; target: StartTarget | null };

/**
 * The hub: one list of sessions to join (nearby hosts and server groups,
 * merged), one "Start a session" button, and "Join with a code". The help
 * card comes last, so that it moves none of the buttons above it.
 */
function Lobby({ st, item, signedIn, offline, env }: { st: TogetherState; item: BaseItemDto | null; signedIn: boolean; offline: boolean; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const session = useSessionStore((x) => x.session);
  const serverName = session?.serverName ?? null;
  const [step, setStep] = useState<LobbyStep>({ name: 'main' });
  const direct = targetFor(item, st.sheet.where);
  const server = signedIn && syncPlaySupported && !offline;
  const rows = mergeSessions(
    env.nearbyOn ? st.hosts : [],
    server ? st.syncplay.groups : [],
    { serverId: session?.serverId ?? null, serverName },
    groupStateLabel,
  );

  if (step.name === 'who') {
    return <WhoStep target={step.target} where={st.sheet.where} offline={offline} networkType={env.network?.type ?? null} onBack={() => setStep({ name: 'main' })} />;
  }

  const join = (row: SessionRow) => {
    const how = joinTransport(row);
    if (how === 'nearby' && row.peerId) {
      nearby().join(row.peerId);
      return;
    }
    if (how === 'server' && row.groupId) {
      closeTogetherSheet();
      void nearby().stopAll();
      void syncPlay().join(row.groupId);
    }
  };
  const scanning = env.nearbyOn || (server && st.syncplay.loading);
  const startTitle = direct
    ? direct.kind === 'audio' && !direct.item
      ? 'Start a session with this music'
      : `Start a session with “${direct.item?.Name ?? 'this'}”`
    : 'Start a session';

  return (
    <>
      {env.nearbyOn && st.rejoin ? <RejoinCard st={st} /> : null}

      <Section
        title="Sessions you can join"
        footer={
          server
            ? `Anyone with an account on ${serverName ?? 'your server'} can join its sessions there.`
            : env.nearbyOn
              ? undefined
              : 'Sign in to a server to see its sessions.'
        }>
        {st.notice ? (
          <View style={[s.group, s.row]}>
            <Icon name="exclamationmark.triangle" size={18} color={c.warning} />
            <Text style={[s.rowDetail, s.rowText, { color: c.warning }]}>{st.notice}</Text>
          </View>
        ) : null}
        <View style={s.group}>
          {rows.length === 0 ? (
            <View style={s.row}>
              {scanning ? <ActivityIndicator color={c.text3} /> : null}
              <Text style={s.rowDetail}>{env.nearbyOn ? 'No sessions nearby yet' : 'No sessions yet'}</Text>
            </View>
          ) : (
            rows.map((r, i) => (
              <View key={r.key} style={[s.row, i < rows.length - 1 && s.rowLine]}>
                <RowIcon name={r.kind === 'audio' ? 'music.note' : r.peerId ? 'antenna.radiowaves.left.and.right' : 'person.2.fill'} />
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {r.hostName}
                  </Text>
                  <Text style={s.rowDetail} numberOfLines={2}>
                    {[r.title, r.tag, r.ble ? 'Needs a quick Wi-Fi link' : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Button title="Join" variant="small" onPress={() => join(r)} />
              </View>
            ))
          )}
        </View>
      </Section>

      {st.sheet.where === 'join' && !signedIn ? null : (
        <Section title="Start a session" footer={direct ? undefined : 'Then pick something to play anywhere in the app. It plays for everyone.'}>
          <Button title={startTitle} icon={direct ? 'play.fill' : 'person.2.fill'} onPress={() => setStep({ name: 'who', target: direct })} />
          {direct ? <Button title="Start an empty session" variant="text" onPress={() => setStep({ name: 'who', target: null })} /> : null}
        </Section>
      )}

      {env.nearbyOn ? (
        <Section title="Join with a code" footer="Type the code that the host’s screen shows, or scan its QR code with the Camera app.">
          <CodeInput />
        </Section>
      ) : null}

      {/* Last, so that the help card shows below every start and join button and moves none of them. */}
      {env.nearbyOn ? (
        <View style={s.section}>
          <HelpCard st={st} env={env} />
          {st.hotspot && st.role !== 'host' ? <HotspotCard st={st} env={env} guest /> : null}
        </View>
      ) : null}
    </>
  );
}

/** A session from before an app restart: join it again, or forget it. */
function RejoinCard({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const r = st.rejoin!;
  const host = r.role === 'host';
  return (
    <View style={s.group}>
      <View style={s.row}>
        <RowIcon name={r.kind === 'audio' ? 'music.note' : 'arrow.clockwise'} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>
            {host ? `Resume “${r.title}”` : `Rejoin “${r.title}”`}
          </Text>
          <Text style={s.rowDetail} numberOfLines={2}>
            {host ? 'You hosted this session a moment ago' : `${r.hostName} · you were in this session a moment ago`}
          </Text>
        </View>
      </View>
      <View style={[s.cardButtons]}>
        <Button title="Not now" variant="smallTonal" onPress={() => nearby().dismissRejoin()} />
        <Button title={host ? 'Resume' : 'Rejoin'} variant="small" onPress={() => nearby().rejoin()} />
      </View>
    </View>
  );
}

const HELP_ICONS: Record<HelpItem['id'], IconName> = {
  'local-network-denied': 'wifi.exclamationmark',
  'bluetooth-off': 'dot.radiowaves.left.and.right',
  'bluetooth-denied': 'dot.radiowaves.left.and.right',
  'same-wifi': 'wifi',
  'apple-direct': 'antenna.radiowaves.left.and.right',
  'android-hotspot': 'personalhotspot',
  'personal-hotspot': 'personalhotspot',
  'isolated-wifi': 'exclamationmark.triangle',
  'scan-code': 'qrcode',
  'type-code': 'keyboard',
};

/** The guest's help card: why nothing shows, and what to do. */
function HelpCard({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const [open, setOpen] = useState<'scan-code' | 'type-code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const help = guestHelp({
    platform: env.platform,
    elapsedMs: st.browsingSince === null ? 0 : env.now - st.browsingSince,
    found: st.hosts.length,
    network: env.network,
    localNetwork: st.localNetwork,
    ble: st.ble,
    canMakeHotspot: env.canMakeHotspot,
    hasMobileData: env.network?.type === 'cellular',
  });
  if (!help.show) return null;

  const run = async (item: HelpItem) => {
    const action = 'action' in item ? item.action : null;
    switch (action) {
      case 'open-settings':
        nearby().openSettings();
        break;
      case 'ask-permission':
        void nearby().allowBluetooth();
        break;
      case 'make-hotspot':
        setBusy(true);
        setError(null);
        try {
          await nearby().makeHotspot();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
        break;
      case 'scan-code':
      case 'type-code':
        setOpen((o) => (o === action ? null : action));
        break;
    }
  };

  return (
    <>
      <Text style={s.label}>{st.localNetwork === 'denied' ? 'Zoggyfin cannot look for sessions' : 'Not finding the session?'}</Text>
      <View style={s.group}>
        {help.items.map((it, i) => {
          const copy = helpCopy(it);
          const action = copy.action;
          const hotspotDone = action?.id === 'make-hotspot' && !!st.hotspot;
          return (
            <View key={it.id} style={[s.helpRow, i < help.items.length - 1 && s.rowLine]}>
              <RowIcon name={HELP_ICONS[it.id]} />
              <View style={[s.rowText, s.helpText]}>
                <Text style={s.rowTitle}>{copy.title}</Text>
                <Text style={s.rowDetail}>{copy.detail}</Text>
                {action && !hotspotDone ? (
                  <View style={s.helpAction}>
                    <Button title={action.label} variant="smallTonal" loading={action.id === 'make-hotspot' && busy} onPress={() => void run(it)} />
                  </View>
                ) : null}
                {action?.id === 'make-hotspot' && error ? <Text style={s.notice}>{error}</Text> : null}
                {action?.id === 'scan-code' && open === 'scan-code' ? (
                  <Text style={s.rowDetail}>Open the Camera app and point it at the host’s code. Zoggyfin opens and asks to join.</Text>
                ) : null}
                {action?.id === 'type-code' && open === 'type-code' ? <CodeInput /> : null}
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

/** The short code field of the help card. */
function CodeInput() {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    if (!text.trim()) return;
    const ok = nearby().joinWithCode(text);
    setBad(!ok);
  };
  return (
    <View style={s.codeWrap}>
      <View style={s.codeRow}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setBad(false);
          }}
          onSubmitEditing={submit}
          placeholder="Code"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          cursorColor={c.accent}
          keyboardAppearance={scheme}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          accessibilityLabel="The host’s code"
          style={s.codeInput}
        />
        <Button title="Join" variant="small" disabled={!text.trim()} onPress={submit} />
      </View>
      {bad ? <Text style={s.notice}>This code is not correct.</Text> : null}
    </View>
  );
}

// ---- Nearby session ------------------------------------------------------------

function NearbyView({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const phase = st.phase;
  const host = st.role === 'host';

  if (phase.name === 'requesting' || phase.name === 'syncing') {
    const ble = phase.name === 'requesting' && phase.hostPeerId.startsWith('ble:');
    return (
      <Section title="Joining">
        <View style={[s.group, s.row]}>
          <ActivityIndicator color={c.text3} />
          <Text style={s.rowDetail}>
            {ble
              ? `Making a Wi-Fi link with ${phase.hostName}…`
              : phase.name === 'requesting'
                ? `Waiting for ${phase.hostName} to let you in…`
                : `Connecting to ${phase.hostName}…`}
          </Text>
        </View>
        <RendezvousRow st={st} />
        <Button title="Cancel" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  if (phase.name === 'ended') {
    return (
      <Section title="Session ended">
        <Text style={s.note}>{phase.message}</Text>
        <Button title="Done" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  const reconnecting = phase.name === 'reconnecting' ? phase : null;

  return (
    <>
      {host && st.requests.length ? (
        <Section title="Wants to join" footer={st.requests.length > SHOWN_REQUESTS ? 'Requests with no answer close after a minute.' : undefined}>
          <View style={s.group}>
            {visibleRequests(st.requests).shown.map((r, i, shown) => (
              <View key={r.inviteId} style={[s.row, (i < shown.length - 1 || st.requests.length > shown.length) && s.rowLine]}>
                <RowIcon name="person.fill" />
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={s.rowDetail}>
                    {[r.have ? 'Has it downloaded' : st.item?.path ? 'Streams it from you' : 'Streams it from the server', r.code ? 'Has your code' : null, r.ble ? 'Over Bluetooth' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Button title="Decline" variant="smallTonal" onPress={() => nearby().respond(r.inviteId, false)} />
                <Button title="Accept" variant="small" onPress={() => nearby().respond(r.inviteId, true)} />
              </View>
            ))}
            {visibleRequests(st.requests).more ? (
              <View style={s.row}>
                <Text style={s.rowDetail}>{`+${visibleRequests(st.requests).more} more`}</Text>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}

      {host && st.rendezvous ? <RendezvousRow st={st} /> : null}

      {host && st.streamWarning ? (
        <View style={[s.group, s.row]}>
          <Icon name={st.streamWarning.tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle'} size={18} color={st.streamWarning.tone === 'warning' ? c.warning : c.text2} />
          <Text style={[s.rowDetail, s.rowText, st.streamWarning.tone === 'warning' && { color: c.warning }]}>{st.streamWarning.text}</Text>
        </View>
      ) : null}

      <RoomNow st={st} />

      <Section title={sessionHeadline(st, null) ?? 'People'} footer={peopleFooter(st)}>
        <View style={s.group}>
          {reconnecting ? (
            <View style={[s.row, s.rowLine]}>
              <ActivityIndicator color={c.text3} />
              <Text style={s.rowDetail}>
                {reconnecting.waitingForHost
                  ? `${reconnecting.hostName} has the file. Waiting for them to come back…`
                  : `Reconnecting to ${reconnecting.hostName}…`}
              </Text>
            </View>
          ) : null}
          <View style={[s.row, s.rowLine]}>
            <RowIcon name="person.crop.circle" />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{host ? 'You' : (st.hostName ?? reconnecting?.hostName ?? 'Host')}</Text>
              <Text style={s.rowDetail}>Host</Text>
            </View>
          </View>
          {host ? null : (
            <View style={[s.row, st.members.length ? s.rowLine : null]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>You</Text>
                <Text style={s.rowDetail}>{!st.item ? 'Waiting' : st.source === 'local' ? 'Plays your download' : st.source === 'server' ? 'Streams from your server' : st.source === 'stream' ? 'Streams from the host' : 'Not playing'}</Text>
              </View>
            </View>
          )}
          {st.members.map((m, i, list) => (
            <MemberRow key={m.id} member={m} host={host} last={i === list.length - 1} />
          ))}
          {host && !st.members.length ? (
            <View style={s.row}>
              <ActivityIndicator color={c.text3} />
              <Text style={s.rowDetail}>Waiting for people nearby to join…</Text>
            </View>
          ) : null}
        </View>
      </Section>

      {host ? <HostHelp st={st} env={env} /> : null}

      {host ? (
        <Section title="Session settings">
          <View style={s.group}>
            <SwitchRow
              title="Only I control"
              detail={st.onlyHostControls ? 'Guests watch; you pick, play, pause and seek.' : 'Everyone can pick what plays, play, pause, seek and change the speed.'}
              value={st.onlyHostControls}
              onChange={(v) => nearby().setOnlyHostControls(v)}
            />
            <SwitchRow
              title="Don’t allow new people"
              detail={st.locked ? 'New requests are refused at once.' : 'People can ask to join. You accept each person.'}
              value={st.locked}
              onChange={(v) => nearby().setLocked(v)}
            />
            <ChoiceRow
              title="Anyone nearby can find it"
              selected={st.findable === 'anyone'}
              disabled={st.findable === 'code'}
              onPress={() => nearby().setFindable('anyone')}
            />
            <ChoiceRow
              title="Only with my code"
              detail={
                st.findable === 'code' ? 'Not shown nearby. To show it again, start a new session.' : 'Hides the session. People join with the code above.'
              }
              selected={st.findable === 'code'}
              onPress={() => nearby().setFindable('code')}
              last
            />
          </View>
          {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
        </Section>
      ) : (
        <Section title="Controls">
          <View style={[s.group, s.row]}>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{st.onlyHostControls ? 'Only the host controls' : 'Everyone controls'}</Text>
              <Text style={s.rowDetail}>
                {st.onlyHostControls ? 'The host picks, plays, pauses and seeks.' : 'Everyone can pick what plays, play, pause, seek and change the speed.'}
              </Text>
            </View>
            <Icon name={st.onlyHostControls ? 'lock.fill' : 'person.2.fill'} size={18} color={c.text2} />
          </View>
          {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
        </Section>
      )}

      <Button
        title={host ? 'End session' : 'Leave session'}
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void nearby().stopAll();
        }}
      />
    </>
  );
}

/**
 * What the room plays, or who picks next. The host (and a guest who may
 * pick) closes the sheet to pick something with the normal app.
 */
function RoomNow({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const signedIn = useSessionStore((x) => !!x.session);
  const host = st.role === 'host' || !!st.syncplay.group;
  const canPick = host || (signedIn && !st.onlyHostControls);
  const title = st.item ? st.item.album || st.item.name : null;
  const hostName = shortName(st.hostName);
  const line = title
    ? host
      ? 'Play something else anywhere in the app to switch for everyone.'
      : canPick
        ? 'Play something in the app to switch for everyone.'
        : `Only ${hostName} picks what plays.`
    : host
      ? 'Pick something to play anywhere in the app. It plays for everyone.'
      : canPick
        ? `Or pick something yourself: it plays for everyone.`
        : `Only ${hostName} picks what plays.`;
  return (
    <Section title="Playing">
      <View style={[s.group, s.row]}>
        <RowIcon name={title ? (st.kind === 'audio' ? 'music.note' : 'film') : 'person.2.fill'} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={2}>
            {title ?? (host ? 'Nothing yet' : `Waiting for ${hostName} to pick something`)}
          </Text>
          <Text style={s.rowDetail}>{line}</Text>
        </View>
      </View>
      {!title && canPick ? <Button title="Pick something" variant="tonal" icon="magnifyingglass" onPress={() => closeTogetherSheet()} /> : null}
    </Section>
  );
}

/** A switch row in "Session settings". */
function SwitchRow({ title, detail, value, onChange, disabled = false }: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={[s.row, s.rowLine]}>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowDetail}>{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: c.accent }} accessibilityLabel={title} />
    </View>
  );
}

/** Where a member's media comes from. */
function memberSource(m: Member, host: boolean): string {
  if (m.noMedia) return 'Not playing this';
  if (m.local) return 'Own download';
  if (m.server) return 'Streams from the server';
  return host ? 'Streams from you' : 'Streams from the host';
}

/** A person in the session. The host can remove them, and block their device for this session. */
function MemberRow({ member: m, host, last }: { member: Member; host: boolean; last: boolean }) {
  const s = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={!last && s.rowLine}>
      <View style={s.row}>
        <RowIcon name="person.fill" />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {m.name}
          </Text>
          <Text style={s.rowDetail}>
            {m.away ? 'Reconnecting…' : [memberSource(m, host), m.buffering ? 'Loading' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {host ? <Button title={open ? 'Cancel' : 'Remove'} variant="smallTonal" onPress={() => setOpen((o) => !o)} /> : null}
      </View>
      {host && open ? (
        <View style={s.cardButtons}>
          <Button title="Remove" variant="smallTonal" onPress={() => nearby().removeMember(m.id, false)} />
          <Button title="Remove and block this device" variant="small" onPress={() => nearby().removeMember(m.id, true)} />
        </View>
      ) : null}
    </View>
  );
}

/** The step of a Bluetooth rendezvous (a spinner, or a warning when it failed). */
function RendezvousRow({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  if (!st.rendezvous) return null;
  return (
    <View style={[s.group, s.row]}>
      {st.rendezvous.failed ? <Icon name="exclamationmark.triangle" size={18} color={c.warning} /> : <ActivityIndicator color={c.text3} />}
      <Text style={[s.rowDetail, st.rendezvous.failed && { color: c.warning }]}>{st.rendezvous.text}</Text>
    </View>
  );
}

function visibleIcon(line: string): IconName {
  if (line.startsWith('Only people with your code')) return 'qrcode';
  if (line.startsWith('No Wi-Fi')) return 'exclamationmark.triangle';
  if (line.includes('Bluetooth')) return 'dot.radiowaves.left.and.right';
  if (line.includes('direct')) return 'antenna.radiowaves.left.and.right';
  return 'wifi';
}

/** The host's help: who can find the session, the join code, and Android help. */
function HostHelp({ st, env }: { st: TogetherState; env: SheetEnv }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [androidOpen, setAndroidOpen] = useState(false);
  const apple = isApple(env.platform);
  return (
    <>
      {st.visibleTo.length ? (
        <Section title="Visible to">
          <View style={s.group}>
            {st.visibleTo.map((line, i) => (
              <View key={line} style={[s.row, i < st.visibleTo.length - 1 && s.rowLine]}>
                <RowIcon name={visibleIcon(line)} />
                <Text style={[s.rowDetail, s.rowText, line.startsWith('No Wi-Fi') && { color: c.warning }]}>{line}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {apple ? null : <HotspotCard st={st} env={env} />}

      {st.joinCode ? (
        <Section
          title="Join with a code"
          footer="Scan with the Camera app on the other device, or type the code. Use it when the Wi-Fi does not let devices see each other (common in hotels and on planes). You still accept each person.">
          <View style={[s.group, s.codeCard]}>
            <QrCode value={st.joinCode.link} size={180} label="The session code. Scan it on the other device." />
            <Text style={s.shortCode} selectable accessibilityLabel={`Code: ${st.joinCode.short.split('').join(' ')}`}>
              {st.joinCode.short}
            </Text>
          </View>
        </Section>
      ) : null}

      {apple ? (
        <View style={s.group}>
          <Pressable
            onPress={() => setAndroidOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: androidOpen }}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: c.surface2 }]}>
            <RowIcon name="info.circle" />
            <Text style={[s.rowTitle, s.rowText]}>Someone on Android?</Text>
            <Icon name={androidOpen ? 'chevron.up' : 'chevron.down'} size={14} color={c.text3} weight="semibold" />
          </Pressable>
          {androidOpen ? (
            <View style={s.expand}>
              <Text style={s.rowDetail}>
                Put both devices on the same Wi-Fi. With no Wi-Fi, the Android device makes the network: on that device, tap Make a hotspot in this sheet. If
                your iPhone has mobile data, Personal Hotspot also works.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const SETTINGS_ERROR = /permission|location|settings|allow/i;

/** Android: make a Wi-Fi network for the session and show its QR code. */
function HotspotCard({ st, env, guest = false }: { st: TogetherState; env: SheetEnv; guest?: boolean }) {
  const s = useStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const title = st.kind === 'audio' || st.sheet.where === 'music' ? 'Listen together' : 'Watch together';

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const h = await nearby().makeHotspot();
      if (!h) setNone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (st.hotspot) {
    return (
      <Section
        title="Hotspot"
        footer={
          guest
            ? `Join this Wi-Fi on the other device, then open ${title} there.`
            : `1. Scan this on the other device to join the Wi-Fi. 2. Then scan the session code or open ${title}.`
        }>
        <View style={[s.group, s.codeCard]}>
          <QrCode value={wifiQr(st.hotspot.ssid, st.hotspot.password)} size={180} label="The Wi-Fi code. Scan it on the other device to join the Wi-Fi." />
          <View style={s.wifiFacts}>
            <Text style={s.wifiLabel}>Wi-Fi</Text>
            <Text style={s.wifiValue} selectable>
              {st.hotspot.ssid}
            </Text>
            <Text style={s.wifiLabel}>Password</Text>
            <Text style={s.wifiValue} selectable>
              {st.hotspot.password}
            </Text>
          </View>
        </View>
        <Button title="Stop the hotspot" variant="tonal" icon="xmark" onPress={() => nearby().stopHotspot()} />
      </Section>
    );
  }

  if (guest) return null;

  if (!env.canMakeHotspot || none) {
    return (
      <Section title="No Wi-Fi?">
        <Text style={s.note}>Turn on the hotspot of this phone: Settings &gt; Connections &gt; Mobile Hotspot. Then the other device joins it.</Text>
      </Section>
    );
  }

  return (
    <Section title="No Wi-Fi?" footer="This phone makes a Wi-Fi network for the session. It needs no mobile data.">
      <Button title="Create a hotspot for this session" variant="tonal" icon="personalhotspot" loading={busy} onPress={() => void make()} />
      {error ? <Text style={s.notice}>{error}</Text> : null}
      {error && SETTINGS_ERROR.test(error) ? (
        <Button title="Open Settings" variant="smallTonal" icon="gearshape" onPress={() => nearby().openSettings()} />
      ) : null}
    </Section>
  );
}

function peopleFooter(st: TogetherState): string | undefined {
  const parts: string[] = [];
  if (st.waiting) parts.push('Waiting while someone loads.');
  if (st.sync && st.role === 'guest') {
    const d = st.sync.drift;
    parts.push(d === null ? 'Syncing…' : Math.abs(d) < 150 ? `In sync (${Math.round(Math.abs(d))} ms)` : `Catching up (${Math.round(d)} ms)`);
  }
  return parts.join(' ') || undefined;
}

// ---- SyncPlay group --------------------------------------------------------------

function GroupView({ st, item }: { st: TogetherState; item: BaseItemDto | null }) {
  const s = useStyles(makeStyles);
  const group = st.syncplay.group!;
  const serverName = useSessionStore((x) => x.session?.serverName ?? null);
  const playing = usePlayerStore((x) => x.now?.item ?? null);
  const playingId = playing?.Id ?? null;
  const moveTarget = playing ? targetFor(playing, st.sheet.where) : null;
  const canMove = nearbySupported && !!moveTarget && (moveTarget.kind === 'audio' || canHostNearby(playing));
  return (
    <>
      <RoomNow st={st} />
      <Section
        title={sessionHeadline(st, serverName) ?? 'Session'}
        footer={`Anyone with an account on ${serverName ?? 'this server'} can join. ${groupStateLabel(group.state)}.${st.sync ? ` Server clock: ${Math.round(st.sync.rtt)} ms round trip.` : ''}`}>
        <View style={s.group}>
          {(group.participants.length ? group.participants : ['You']).map((name, i, list) => (
            <View key={`${name}-${i}`} style={[s.row, i < list.length - 1 && s.rowLine]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={s.rowDetail}>Streams from the server</Text>
              </View>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Controls">
        <View style={s.group}>
          {/* Jellyfin SyncPlay has no host: the switch shows, off, with the reason and the way out below. */}
          <SwitchRow title="Only I control" detail={SERVER_CONTROLS_TEXT} value={false} onChange={() => undefined} disabled />
        </View>
      </Section>
      {item && canSyncPlay(item) && item.Id !== playingId ? (
        <Button title={`Play “${item.Name ?? 'this'}” for everyone`} icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      {item && canSyncPlay(item) && item.Id === playingId && group.state === 'Idle' ? (
        <Button title="Play this for everyone" icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      <View style={s.buttonRow}>
        <Button title="Previous" variant="tonal" icon="backward.fill" onPress={() => void syncPlay().previous()} containerStyle={{ flex: 1 }} />
        <Button title="Next" variant="tonal" icon="forward.fill" onPress={() => void syncPlay().next()} containerStyle={{ flex: 1 }} />
      </View>
      {canMove && moveTarget ? (
        <Section title="Only people you choose" footer="Leaves the server session and starts a nearby one that only people with your code can join. There you can turn on “Only I control”.">
          <Button
            title="Move to a nearby session with a code"
            variant="tonal"
            icon="qrcode"
            onPress={() => {
              void syncPlay()
                .leave()
                .then(() => startSession(moveTarget, 'nearby', 'code', st.sheet.where));
            }}
          />
        </Section>
      ) : null}
      <Button
        title="Leave session"
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void syncPlay().leave();
        }}
      />
    </>
  );
}
