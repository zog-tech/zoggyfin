/**
 * Nearby mode: watch or listen together with no internet. The host shares
 * a downloaded video, or its audio queue; guests nearby find the session,
 * ask to join and play their own download of each item or the host's file
 * over the session port.
 *
 * Transport: `link.ts` over the native transport of each platform
 * (Network.framework on iPhone, iPad and Mac; NSD and sockets on Android).
 * Discovery: Bonjour / DNS-SD, Bluetooth LE (`rendezvous.ts`: an Android
 * device makes a Wi-Fi network for the session), or a join code.
 *
 * A session goes on when a device drops off (`recovery.ts`): guests come
 * back with the session key; when the host drops, the members elect a new
 * host that has the media.
 */
import { router } from 'expo-router';
import { Platform } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { randomId } from '@/lib/id';
import { checkServer, useOnlineStore } from '@/lib/online';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { isAudioItem, playHere, type PlayRequest, stopVideoForAudio } from '@/player';
import type { AudioItem } from '@/player/audio/item';
import { audioSession } from '@/player/audio/session';
import { audioState } from '@/player/audio/store';
import { controlGate, queueGate, type UserControl } from '@/player/control-gate';
import { videoSession } from '@/player/session';
import { type PlayRoute, playRouter } from '@/player/play-router';
import { type NowPlaying, playerState, setPlayerState, usePlayerStore } from '@/player/store';
import { networkSource } from '@/servers/network-source';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { bindAudioPort, fromSharedQueue, hostQueue, sharedAudioItem, waitForGapless } from './audio-binding';
import { fileBitrateMbps, hostPath, streamingFromHost, streamWarning, type TransportPath } from './budget';
import { sessionDeviceKey } from './device-key';
import { positionAt } from './drift';
import { Follower } from './follower';
import { keyMatches, joinLink, newSessionKey, type JoinPayload, parseJoinLink, parseShortCode, pickCodeAddress, shortCode, shortSession } from './join-code';
import { NearbyLink } from './link';
import type { BleState, NearbyLinkNative } from './link-native-types';
import { IDLE, type PhaseEvent, transition } from './machine';
import { chooseGuestVideoSource, guestKeepsPlayer, noAccessText } from './guest-source';
import { guestSource, HostShares, localRecord } from './nearby-media';
import { linkNative } from './nearby-native';
import { visibleTo, type HelpPlatform } from './nearby-help';
import { bindVideoPort, type BoundPort, whenPlayerReady } from './player-binding';
import { realTimers } from './player-port';
import {
  type Advert,
  type Anchor,
  bleAdvert,
  decodeAdvert,
  encodeAdvert,
  type JoinContext,
  type MediaKind,
  type Member,
  type Message,
  type PickRequest,
  roomAdvert,
  type SharedItem,
  type SharedQueue,
  type StreamRef,
} from './protocol';
import { afterHostLoss, handoverAnchor, handoverJump, REJOIN_WINDOW, retryDelay, shouldRetry } from './recovery';
import { createRendezvous, decodeInfo, encodeInfo, type Rendezvous, type RendezvousEffect } from './rendezvous';
import { generateKeyPair } from './rendezvous-crypto';
import { deviceKey, type Findable, isFinalRefusal, JoinGate, MAX_GUESTS, REFUSAL_TEXT } from './join-gate';
import { HostRoom, IDLE_PORT, type RoomMedia } from './room';
import { guestKeyOf, mediaKey, requestOfPick, type RoomRole, routeInRoom } from './room-route';
import { shortName } from './hub';
import { closeTogetherSheet, initialTogether, openTogetherSheet, type SavedSession, setTogether, type SheetPlace, togetherState } from './store';
import { syncLog } from './sync-log';

/** True where nearby mode can run: an app with the nearby module (iOS, iPadOS, Android, the Mac app), not TV. */
export const nearbySupported: boolean = features.watchTogether && linkNative !== null;

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);
/** A guest that streams from the host reads at most this far ahead, s (the players read 50 s or more by default). */
const HOST_READ_AHEAD = 15;
const SAVED_KEY = 'together.session.v1';
/** Nothing plays this long on the host: the room has no item, ms. */
const EMPTY_AFTER = 4000;
/** A lost nearby service leaves the list after this wait, ms (an advert that changes can drop off for a moment). */
const LOST_AFTER = 3000;

function helpPlatform(): HelpPlatform {
  if (Platform.OS === 'android') return 'android';
  return Platform.OS === 'ios' ? 'ios' : 'mac';
}

/** True when this device reaches its server now (the last check, or a new one of at most 3 s). */
async function serverReachable(): Promise<boolean> {
  const st = useOnlineStore.getState();
  if (st.reachable !== null && Date.now() - st.checkedAt < 60_000) return st.reachable;
  return Promise.race([checkServer().catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
}

/** The host plays this video from its server (signed in to the item's server). */
function streamsFromServer(item: BaseItemDto): boolean {
  const session = useSessionStore.getState().session;
  return !!session && (!item.ServerId || item.ServerId === session.serverId);
}

/**
 * The host can start a nearby session for this video: it has it downloaded,
 * or it streams it from its server. Guests then play their own copy, the
 * host's file, or the same server (see guest-source.ts).
 */
export function canHostNearby(item: BaseItemDto | null | undefined): boolean {
  return nearbySupported && !!item && VIDEO_TYPES.has(item.Type ?? '') && (localRecord(item.Id) !== null || streamsFromServer(item));
}

/** The host can share the audio that plays now (its queue). */
export function canHostAudio(): boolean {
  const now = playerState().now;
  return nearbySupported && now?.kind === 'audio' && audioState().queue.entries.length > 0;
}

function displayName(): string {
  const user = useSessionStore.getState().session?.userName;
  const device = clientIdentity().device;
  return user ? `${user} · ${device}` : device;
}

function toBaseItem(s: SharedItem): BaseItemDto {
  return { Id: s.id, Name: s.name, Type: s.type as BaseItemDto['Type'], SeriesName: s.seriesName ?? undefined, RunTimeTicks: s.runTimeTicks ?? undefined };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Leaves the full-screen player, when it shows. Once only: a second call before the route goes does nothing. */
function leavePlayer(): void {
  if (playerState().presentation !== 'full') return;
  setPlayerState({ presentation: 'hidden' });
  if (router.canGoBack()) router.back();
  else router.replace(useSessionStore.getState().session ? '/' : '/sign-in');
}

/** The session state with no session (the sheet keeps its place). */
function noSession() {
  const { sheet, syncplay, onlyHostControls, ble, localNetwork, rejoin } = togetherState();
  return { ...initialTogether, sheet, syncplay, onlyHostControls, ble, localNetwork, rejoin };
}

/** Where the guest reaches the host: a found service, or an address (join code, Bluetooth). */
type HostTarget = { serviceId: string } | { host: string; port: number };

class NearbyController {
  private native: NearbyLinkNative | null = linkNative;
  private link: NearbyLink | null = null;
  private room: HostRoom | null = null;
  private follower: Follower | null = null;
  private port: BoundPort | null = null;
  private hostQueueBinding: { dispose(): void } | null = null;
  private shares: HostShares | null = null;
  /** The session as this device knows it (host or guest). */
  private session: { id: string; key: string; epoch: number; kind: MediaKind; title: string; itemId: string | null } | null = null;
  private codeKey: string | null = null;
  /** Host: the guard against strangers (join-gate.ts). */
  private gate: JoinGate | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  /** "Who can find it" for the next session (stopAll before a new host must not lose it). */
  private nextFindable: Findable = 'anyone';
  private serverPort = 0;
  private serviceName: string | null = null;
  /** This device's member id for the session (stable across reconnects). */
  private memberId: string = randomId();
  // Guest
  private hostPeer: string | null = null;
  private hostTarget: HostTarget | null = null;
  private lastAddress: { host: string; port: number } | null = null;
  private mediaBase: string | null = null;
  private joinAdvert: Advert | null = null;
  private loadToken = 0;
  private loaded = false;
  /** The guest got its first welcome (a later one is a relink). */
  private welcomed = false;
  /** The guest's key of the room's item that it plays or loads (see `guestKeyOf`). */
  private guestKey: string | null = null;
  private reconnect: { since: number; attempt: number; timer: ReturnType<typeof setTimeout> | null; trying: boolean; oldHostId: string | null } | null = null;
  private gaplessTimer: ReturnType<typeof setTimeout> | null = null;
  private moving: string | null = null;
  // Host: watches for a newer host after it lost every member.
  private demoteWatch: ReturnType<typeof setInterval> | null = null;
  // Bluetooth
  private ble: Map<string, Rendezvous> = new Map();
  private bleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private bleInfo: Map<string, ReturnType<typeof decodeInfo>> = new Map();
  private bleSubs: { remove(): void }[] = [];
  private keyPair: ReturnType<typeof generateKeyPair> | null = null;
  private miscSubs: { remove(): void }[] = [];
  /** Development (together-lab): stream from the host even with a local copy. */
  devForceStream = false;
  // Host: the upload budget (budget.ts).
  private path: TransportPath = 'wifi-phone';
  /** The bitrate of the shared file, Mbit/s; null when unknown. */
  private fileMbps: number | null = null;
  /** The host shares a video file that guests can stream. */
  private streamable = false;
  private lastWarning: string | null = null;
  /** Host: the device key of each member's join (by member id), for "Remove and block". */
  private memberDevices = new Map<string, string>();
  /** Host: the TXT record that the network advert has now (JSON), or null with no advert. */
  private advertKey: string | null = null;
  /** Host: the Bluetooth INFO is published. */
  private bleAdvertising = false;
  /** Host: the Bluetooth centrals that are subscribed now; each gets the new INFO when the room changes. */
  private bleCentrals = new Set<string>();
  /** Guest: a lost service goes from the list after a moment (a host that changes its advert can drop off for a moment). */
  private lostTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---- Helpers ----------------------------------------------------------------------

  private random = (n: number): Uint8Array => {
    const b64 = this.native?.randomBytes(n) ?? '';
    const bin = typeof atob === 'function' ? atob(b64) : '';
    const out = new Uint8Array(n);
    for (let i = 0; i < n && i < bin.length; i++) out[i] = bin.charCodeAt(i);
    if (bin.length < n) throw new Error('No secure random source.');
    return out;
  };

  private ev(msg: string, data?: object): void {
    syncLog.event(this.now(), msg, data);
    if (__DEV__) console.log(`[nearby] ${this.room ? 'host' : 'guest'} ${msg}`, data ? JSON.stringify(data) : '');
  }

  private dispatch(event: PhaseEvent): void {
    const phase = transition(togetherState().phase, event);
    if (phase !== togetherState().phase) setTogether({ phase });
  }

  private now = () => this.native?.monotonicNow() ?? Date.now();

  private ensureLink(): NearbyLink | null {
    const n = this.native;
    if (!n) return null;
    if (!this.link) {
      this.link = new NearbyLink(n, realTimers, {
        sessionKey: () => (this.room ? (this.session?.key ?? null) : null),
        isCodeKey: (k) => !!this.codeKey && keyMatches(k, this.codeKey),
        admit: (e) => this.admit(e.peerId, e.ctx, e.withKey),
      });
      this.link.open();
      this.miscSubs.push(
        n.on('onError', (e) => {
          if (e.code === 'local-network-denied') setTogether({ localNetwork: 'denied' });
          else setTogether({ notice: e.message });
        }),
        n.on('onHotspot', (e) => {
          if (e.state === 'stopped' || e.state === 'failed') setTogether({ hotspot: null });
          if (e.state === 'failed' && e.message) setTogether({ notice: e.message });
        }),
      );
    }
    this.link.setHandlers({
      onRequest: (e) => this.onRequest(e.peerId, e.ctx, e.code),
      onPeerUp: (peerId, ctx) => this.onPeerUp(peerId, ctx),
      onPeerDown: (peerId, e) => this.onPeerDown(peerId, e),
      onMessage: (peerId, m, at) => this.onMessage(peerId, m, at),
      onServiceFound: (e) => this.onServiceFound(e.serviceId, e.txt),
      onServiceLost: (id) => this.onServiceLost(id),
    });
    return this.link;
  }

  private closeLink(): void {
    this.link?.close();
    this.link = null;
    this.miscSubs.forEach((s) => s.remove());
    this.miscSubs = [];
  }

  private send = (message: Message, to?: string[]) => this.link?.send(message, to ?? null);

  private save(role: 'host' | 'guest', hostName: string): void {
    const s = this.session;
    if (!s) return;
    const saved: SavedSession = { sessionId: s.id, key: s.key, epoch: s.epoch, role, hostName, title: s.title, kind: s.kind, memberId: this.memberId, itemId: s.itemId, at: Date.now() };
    writeJson(SAVED_KEY, saved);
  }

  private forget(): void {
    storage.remove(SAVED_KEY);
    setTogether({ rejoin: null });
  }

  /** At launch: a session from before an app restart that can be joined again. */
  loadSaved(): void {
    if (!nearbySupported) return;
    const saved = readJson<SavedSession | null>(SAVED_KEY, null);
    if (saved && Date.now() - saved.at < REJOIN_WINDOW && typeof saved.sessionId === 'string') setTogether({ rejoin: saved });
    else storage.remove(SAVED_KEY);
  }

  // ---- Host ----------------------------------------------------------------------

  /**
   * Opens a room: a session with no item yet. The host then plays anything
   * with the normal app, and the room shares it (see `watchHostPlayer`).
   * `adopt`: the room starts with what plays now (the pill in a player).
   * Returns true when the room is open.
   */
  async openRoom(opts: { adopt?: boolean; resume?: SavedSession } = {}): Promise<boolean> {
    if (!this.native) {
      toast('Nearby sessions do not work here.');
      return false;
    }
    if (togetherState().mode !== 'none') await this.stopAll();
    await this.startHosting({ adopt: !!opts.adopt, resume: opts.resume });
    return !!this.room;
  }

  /** Opens a room with this video (the together lab). */
  async host(item: BaseItemDto, resume?: SavedSession): Promise<void> {
    if (!(await this.openRoom({ resume }))) return;
    playHere({ item, autoplay: false });
  }

  /** Opens a room with the audio queue that plays now. */
  async hostAudio(resume?: SavedSession): Promise<void> {
    if (!canHostAudio()) {
      toast('Play some music or an audiobook first.');
      return;
    }
    await this.openRoom({ adopt: true, resume });
  }

  /** The room media for what the player plays now, with a port bound to that player; null when nothing plays. */
  private buildMedia(): (RoomMedia & { port: BoundPort; binding: { dispose(): void } | null; mbps: number | null }) | null {
    const now = playerState().now;
    const shares = this.shares;
    if (!now || !shares) return null;
    const audioShare = (e: { item: AudioItem }) => sharedAudioItem(e.item, { path: shares.mediaPath(e.item.Id, e.item.ServerId), art: shares.artPath(e.item.AlbumId ?? e.item.Id) });
    if (now.kind === 'audio') {
      const cur = audioState().queue.entries[audioState().queue.index];
      if (!cur) return null;
      const queue = hostQueue(audioShare);
      const port = bindAudioPort((c) => this.room?.apply(c));
      return { kind: 'audio', item: audioShare(cur), stream: null, queue, player: port, port, binding: queue, mbps: null };
    }
    const it = now.item;
    const r = localRecord(it.Id);
    const activeServerId = useSessionStore.getState().session?.serverId ?? null;
    let item: SharedItem;
    let stream: StreamRef | null = null;
    let mbps: number | null = null;
    if (r) {
      const path = shares.mediaPath(r.itemId);
      item = {
        id: r.itemId,
        serverId: r.serverId || null,
        name: it.Name ?? r.item.Name ?? 'Video',
        type: it.Type ?? r.item.Type ?? 'Video',
        seriesName: it.SeriesName ?? r.item.SeriesName ?? null,
        runTimeTicks: it.RunTimeTicks ?? r.item.RunTimeTicks ?? null,
        mediaSourceId: r.mediaSourceId,
        container: r.mediaFile.split('.').pop() ?? 'mp4',
        path,
        art: shares.artPath(r.itemId),
      };
      if (path && this.serviceName) stream = { service: this.serviceName, path };
      mbps = fileBitrateMbps(r.bytesTotal ?? r.bytesDone, it.RunTimeTicks ?? r.item.RunTimeTicks);
    } else {
      // The host streams it from its server: guests that are signed in there do the same.
      item = {
        id: it.Id ?? 'video',
        serverId: it.ServerId ?? activeServerId,
        name: it.Name ?? 'Video',
        type: it.Type ?? 'Video',
        seriesName: it.SeriesName ?? null,
        runTimeTicks: it.RunTimeTicks ?? null,
        mediaSourceId: now.plan.mediaSourceId || (it.MediaSources?.[0]?.Id ?? null),
        container: null,
        path: null,
        art: null,
      };
    }
    const port = bindVideoPort((c) => this.room?.apply(c), { endPauses: true });
    return { kind: 'video', item, stream, player: port, port, binding: null, mbps };
  }

  /** The title of a room for the advert, the saved session and the sheet. */
  private titleOf(kind: MediaKind, item: SharedItem | null): string {
    if (!item) return '';
    if (kind === 'audio') return audioState().queue.source?.name ?? item.album ?? item.name;
    return item.name;
  }

  private async startHosting(opts: {
    adopt?: boolean;
    resume?: SavedSession;
    takeover?: { anchor: Anchor; members: Member[]; epoch: number; sessionId: string; key: string; media: number | null };
  }): Promise<void> {
    const n = this.native!;
    this.ensureLink();
    const t = opts.takeover;
    const sessionId = t?.sessionId ?? opts.resume?.sessionId ?? randomId();
    const key = t?.key ?? opts.resume?.key ?? newSessionKey(this.random);
    const epoch = t?.epoch ?? opts.resume?.epoch ?? 0;
    if (opts.resume) this.memberId = opts.resume.memberId;
    this.codeKey = hex(this.random(10));
    this.serviceName = `zgf-${hex(this.random(4))}`;

    // The port first: starting it clears the shared files.
    const now = playerState().now;
    const startWith = (opts.adopt || t) && now ? now : null;
    const activeServerId = useSessionStore.getState().session?.serverId ?? null;
    const curEntry = startWith?.kind === 'audio' ? audioState().queue.entries[audioState().queue.index] : undefined;
    const kind: MediaKind = startWith?.kind ?? 'video';
    const r = startWith?.kind === 'video' ? localRecord(startWith.item.Id) : null;
    const advertItemId = startWith ? (startWith.kind === 'audio' ? (curEntry?.item.Id ?? 'queue') : (startWith.item.Id ?? 'video')) : 'room';
    const advertServerId = startWith ? (r ? r.serverId || null : (startWith.item.ServerId ?? activeServerId)) : activeServerId;
    const advertTitle = startWith ? (startWith.kind === 'audio' ? (audioState().queue.source?.name ?? startWith.item.Album ?? startWith.item.Name ?? 'Music') : (startWith.item.Name ?? 'Video')) : '';
    const advert = encodeAdvert({ sessionId, hostName: displayName(), itemId: advertItemId, itemName: advertTitle, serverId: advertServerId, kind, epoch });
    try {
      // "Only with my code": the port opens with no advert, so nobody nearby sees the session, not even for a moment.
      const unlisted = this.nextFindable === 'code';
      const server = unlisted && n.startServerUnlisted ? await n.startServerUnlisted(this.serviceName) : await n.startServer(this.serviceName, advert);
      this.serverPort = server.port;
      this.serviceName = server.service;
      this.advertKey = unlisted ? null : JSON.stringify(advert);
      setTogether({ findable: this.nextFindable, locked: false });
      // An older build has no unlisted start: stop its advert at once.
      if (unlisted && !n.startServerUnlisted) n.stopAdvertising();
    } catch (e) {
      this.session = null;
      toast(`Could not start the nearby session: ${e instanceof Error ? e.message : String(e)}`, { icon: 'exclamationmark.triangle' });
      return;
    }

    this.shares = new HostShares(n, hex(this.random(12)));
    const media = startWith ? this.buildMedia() : null;
    this.port = media?.port ?? null;
    this.hostQueueBinding = media?.binding ?? null;
    this.fileMbps = media?.mbps ?? null;
    this.streamable = media?.kind === 'video' && media.stream !== null;
    this.lastWarning = null;
    const title = this.titleOf(kind, media?.item ?? null);
    this.session = { id: sessionId, key, epoch, kind, title, itemId: media?.kind === 'video' ? media.item.id : null };

    this.gate = new JoinGate(this.now);
    this.gate.locked = false;
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = setInterval(() => this.expireRequests(), 5_000);
    this.room = new HostRoom(
      {
        send: this.send,
        now: this.now,
        player: media?.player ?? IDLE_PORT,
        timers: realTimers,
        onChange: () => this.publishHost(),
        onDenied: () => undefined,
        pong: (peer, id, t0, t1) => this.link?.sendPong(peer, id, t0, t1),
        onPick: (memberId, name, pick) => this.onPick(memberId, name, pick),
        drop: (peer) => setTimeout(() => this.link?.drop(peer), 300),
      },
      {
        sessionId,
        item: media?.item ?? null,
        stream: media?.stream ?? null,
        onlyHostControls: togetherState().onlyHostControls,
        kind,
        queue: media?.queue,
        key,
        epoch,
        hostId: this.memberId,
        anchor: t?.anchor,
        members: t?.members,
        media: t?.media ?? undefined,
      },
    );
    if (media) this.room.setGroupRate(playerState().rate || 1);
    this.hostKey = media ? mediaKey(playerState().now) : null;
    setTogether({ mode: 'nearby', role: 'host', kind, item: media?.item ?? null, hostName: displayName(), requests: [], notice: null, rejoin: null });
    if (t) this.dispatch({ type: 'PROMOTED' });
    else {
      setTogether({ phase: IDLE });
      this.dispatch({ type: 'HOST', sessionId });
    }
    controlGate.set((c) => {
      this.room?.apply(c);
      return true;
    });
    this.publishHost();
    playRouter.set(this.router);
    this.watchHostPlayer();
    syncLog.start('host', () => ({ pos: this.port?.position() ?? 0, playing: this.port?.isPlaying() ?? false, track: this.port?.track?.() ?? null }), this.now, !t);
    this.save('host', displayName());
    this.publishHost();
    void this.refreshHostFacts();
    if (togetherState().findable !== 'code') void this.startBleHost();
  }

  // ---- Host: the room follows the player ------------------------------------------

  /** The media key of the room now: what the host's player plays when the room took it. */
  private hostKey: string | null = null;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private unwatchHost: (() => void) | null = null;
  /** A guest's pick that plays now: the room names the guest in the `media` message. */
  private pendingPick: { memberId: string; name: string } | null = null;

  /**
   * The host's player is the source of the room. Whatever it plays (a Play
   * button, the next episode, autoplay, a guest's pick) becomes the room's
   * item once it has loaded. While it loads, the group pauses. When nothing
   * plays for a moment (the player closed), the room has no item.
   */
  private watchHostPlayer(): void {
    this.unwatchHost?.();
    this.unwatchHost = usePlayerStore.subscribe((st) => this.onHostPlayer(st.now, st.status));
  }

  private onHostPlayer(now: NowPlaying | null, status: string): void {
    if (!this.room) return;
    const key = mediaKey(now);
    if (key !== null && key === this.hostKey) {
      this.clearEmptyTimer();
      return;
    }
    if (key === null) {
      this.suspendHost();
      // A change from video to audio passes through "nothing plays": wait a moment first.
      this.emptyTimer ??= setTimeout(() => {
        this.emptyTimer = null;
        if (!mediaKey(playerState().now) && this.room?.hasMedia) this.toEmptyRoom();
      }, EMPTY_AFTER);
      return;
    }
    this.clearEmptyTimer();
    if (status === 'ready' || status === 'buffering') this.adoptHostMedia();
    else this.suspendHost();
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  /** Lets the room's port and queue go (the player loads something else). */
  private releaseHostMedia(): void {
    this.port?.dispose();
    this.port = null;
    this.hostQueueBinding?.dispose();
    this.hostQueueBinding = null;
  }

  /** The host's player loads something new: the group pauses until it is ready. */
  private suspendHost(): void {
    if (!this.port && this.hostKey === null) return;
    this.releaseHostMedia();
    this.hostKey = null;
    this.room?.suspend();
  }

  /** The room takes what the host's player plays now. `keep`: it plays already, the group takes its state. */
  private adoptHostMedia(opts: { keep?: boolean } = {}): void {
    const room = this.room;
    if (!room) return;
    this.releaseHostMedia();
    const media = this.buildMedia();
    if (!media) {
      this.toEmptyRoom();
      return;
    }
    this.port = media.port;
    this.hostQueueBinding = media.binding;
    this.fileMbps = media.mbps;
    this.streamable = media.kind === 'video' && media.stream !== null;
    this.hostKey = mediaKey(playerState().now);
    const pick = this.pendingPick;
    this.pendingPick = null;
    room.setGroupRate(playerState().rate || 1);
    room.setMedia(media, { keep: opts.keep, by: pick?.memberId });
    this.roomChanged(media.kind, media.item);
    this.ev('room media', { kind: media.kind, item: media.item.id, by: pick?.name });
  }

  /** The room has no item now. */
  private toEmptyRoom(): void {
    const room = this.room;
    if (!room) return;
    this.releaseHostMedia();
    this.hostKey = null;
    this.streamable = false;
    room.setMedia(null);
    this.roomChanged(room.kind, null);
  }

  /** The session facts after the room's item changed. */
  private roomChanged(kind: MediaKind, item: SharedItem | null): void {
    const s = this.session;
    if (s) this.session = { ...s, kind, title: this.titleOf(kind, item), itemId: kind === 'video' ? (item?.id ?? null) : null };
    setTogether({ kind, item });
    this.save('host', displayName());
    this.publishHost();
    this.refreshAdvert(item);
  }

  /**
   * Host: the advert (Bonjour TXT and Bluetooth INFO) says what the room has
   * now, so the nearby list on other devices shows the new title, or that
   * the host picks something. The native layer changes the TXT record in
   * place (Apple) or registers it again after a short wait (Android).
   */
  private refreshAdvert(item: SharedItem | null): void {
    const n = this.native;
    const s = this.session;
    if (!n || !s || !this.room || togetherState().findable === 'code') return;
    const activeServerId = useSessionStore.getState().session?.serverId ?? null;
    const serverId = item ? (item.serverId ?? (localRecord(item.id)?.serverId || null) ?? activeServerId) : activeServerId;
    const advert = roomAdvert({ sessionId: s.id, hostName: displayName(), epoch: s.epoch, kind: s.kind, itemId: item?.id ?? null, title: s.title, serverId });
    const txt = encodeAdvert(advert);
    const key = JSON.stringify(txt);
    if (this.advertKey !== null && key !== this.advertKey && n.updateAdvert) {
      this.advertKey = key;
      n.updateAdvert(txt);
      this.ev('advert', { title: advert.itemName, item: advert.itemId });
    }
    if (this.bleAdvertising && n.bleAdvertise) {
      const info = this.bleInfoText();
      if (info && info !== this.lastBleInfo) {
        this.lastBleInfo = info;
        n.bleAdvertise(info, 'Zoggyfin');
        // A central reads INFO once: the subscribed ones get the new INFO as a message (an older guest ignores it).
        for (const peer of this.bleCentrals) n.bleSend?.(peer, info);
      }
    }
  }

  /** Where the session sheet opens now: on the player that shows, else over the app. */
  private sheetPlace(): SheetPlace {
    if (playerState().presentation === 'full') return playerState().now?.kind === 'audio' ? 'music' : 'player';
    return 'room';
  }

  /** A guest picked something for everyone. The host plays it here, and the room shares it. */
  private onPick(memberId: string, name: string, pick: PickRequest): void {
    const request = requestOfPick(pick);
    const why = this.cannotPlayHere(request);
    const peer = this.room?.peerOf(memberId) ?? null;
    if (why) {
      if (peer) this.send({ t: 'denied', reason: why }, [peer]);
      return;
    }
    const audio = isAudioItem(request.item);
    // A new queue for the music that plays: the next queue message names the guest. Else the `media` message does.
    if (audio && this.room?.kind === 'audio' && this.room.hasMedia) this.room.markQueuePick(memberId);
    else this.pendingPick = { memberId, name };
    // From video to music, `playHere` closes the video player first (stopVideoForAudio).
    toast(`${shortName(name)} picked ${pick.item.name || 'something'}`, { icon: 'person.2.fill' });
    playHere(audio ? request : { ...request, autoplay: false });
  }

  /** Why the host cannot play a guest's pick, or null when it can. */
  private cannotPlayHere(request: PlayRequest): string | null {
    const item = request.list?.[request.index ?? 0] ?? request.item;
    if (localRecord(item.Id) || localRecord(request.item.Id)) return null;
    const session = useSessionStore.getState().session;
    if (session && (!item.ServerId || item.ServerId === session.serverId)) return null;
    return `${displayName()} cannot play this: it is not on their server or in their downloads.`;
  }

  /** The play router of a nearby session (see play-router.ts). */
  private readonly router: PlayRoute = {
    route: (request) => {
      const f = this.follower;
      const who: RoomRole = this.room ? { role: 'host' } : f ? { role: 'guest', onlyHostControls: f.onlyHostControls } : { role: 'none' };
      const r = routeInRoom(who, request, isAudioItem(request.item));
      if (r.kind === 'here') return r.request;
      // A guest asks the host; the host may still say no (`denied` comes back as a toast).
      if (r.kind === 'pick') f?.pick(r.pick);
      else toast(r.reason, { icon: 'lock.fill' });
      return null;
    },
    autoplay: () => !!this.room,
    queueLock: () => (this.follower && !this.room ? 'The host picks what plays in this session.' : null),
  };

  /** The join code and the "Visible to" lines. */
  private async refreshHostFacts(): Promise<void> {
    const n = this.native;
    const s = this.session;
    if (!n || !s || !this.room) return;
    try {
      const all = await n.addresses();
      this.path = hostPath({ platform: helpPlatform(), addresses: all, hotspot: !!togetherState().hotspot });
      this.publishHost();
      const addrs = pickCodeAddress(all);
      if (addrs.length && this.codeKey) {
        const payload: JoinPayload = { v: 1, addrs: addrs.map((a) => a.address), port: this.serverPort, session: shortSession(s.id), key: this.codeKey, name: displayName().slice(0, 30) };
        setTogether({ joinCode: { link: joinLink(payload), short: shortCode(payload) } });
      } else {
        setTogether({ joinCode: null });
      }
    } catch {
      setTogether({ joinCode: null });
    }
    const snap = networkSource.available ? await networkSource.snapshot() : null;
    const hs = togetherState().hotspot;
    setTogether({
      visibleTo:
        togetherState().findable === 'code'
          ? ['Only people with your code (the session does not show nearby)']
          : visibleTo({ platform: helpPlatform(), network: snap, ble: togetherState().ble, hotspot: hs ? { ssid: hs.ssid } : null }),
    });
  }

  private publishHost(): void {
    const room = this.room;
    if (!room) return;
    setTogether({ members: room.memberList, waiting: room.state.waiting, onlyHostControls: room.onlyHostControls });
    controlGate.setPlaying(room.hasMedia ? room.state.wantPlaying : null);
    this.checkBudget(room.memberList);
    // A host with every member away looks for a newer host of the same session (it took over while this device was gone).
    const anyUp = room.memberList.some((m) => !m.away);
    if (!anyUp && room.memberList.length && !this.demoteWatch) this.watchForNewerHost();
    if (anyUp && this.demoteWatch) this.stopDemoteWatch();
  }

  /** Warns the host when more guests stream from it than its path can carry (budget.ts). */
  private checkBudget(members: Member[]): void {
    const w = this.streamable ? streamWarning({ path: this.path, bitrateMbps: this.fileMbps, streaming: streamingFromHost(members) }) : null;
    const cur = togetherState().streamWarning;
    if (w?.text !== cur?.text) setTogether({ streamWarning: w });
    // A toast once for each new warning (not for the notes, and not again on each heartbeat).
    if (w?.tone === 'warning' && w.text !== this.lastWarning) toast(w.text, { icon: 'exclamationmark.triangle' });
    this.lastWarning = w?.tone === 'warning' ? w.text : null;
  }

  private onRequest(peerId: string, ctx: JoinContext, code: boolean): void {
    if (!this.room) {
      this.link?.respond(peerId, false);
      return;
    }
    const req = { inviteId: peerId, peerId, name: ctx.name, have: ctx.have, code, device: deviceKey(peerId, ctx.memberId, ctx.device), at: this.now() };
    setTogether({ requests: [...togetherState().requests.filter((r) => r.peerId !== peerId), req] });
    toast(`${req.name} wants to join you`, { icon: 'person.2.fill', action: { label: 'View', onPress: () => openTogetherSheet(this.sheetPlace(), null) } });
  }

  respond(inviteId: string, accept: boolean, reason?: string): void {
    const req = togetherState().requests.find((r) => r.inviteId === inviteId);
    setTogether({ requests: togetherState().requests.filter((r) => r.inviteId !== inviteId) });
    if (req?.ble) {
      this.bleHandle(inviteId, accept ? { type: 'APPROVE' } : { type: 'DECLINE' });
      return;
    }
    // A request that got in while the session filled up.
    if (accept && this.gate && (this.room?.memberList.length ?? 0) >= MAX_GUESTS) {
      this.link?.respond(inviteId, false, REFUSAL_TEXT.full);
      return;
    }
    this.link?.respond(inviteId, accept, reason);
  }

  // ---- Host: who may join -------------------------------------------------------

  /** The link's join gate: refuse at once, ask the host, or let a member back in. */
  private admit(peerId: string, ctx: JoinContext, withKey: boolean): 'ok' | 'ask' | { refuse: string } {
    const g = this.gate;
    if (!g || !this.room) return withKey ? 'ok' : 'ask';
    const device = deviceKey(peerId, ctx.memberId, ctx.device);
    if (withKey) {
      const back = g.screenReturn(device);
      if (back === null) return 'ok';
      if (back !== 'ask') return { refuse: REFUSAL_TEXT[back] };
    }
    const r = g.screen(device, this.gateFacts());
    if (r) this.ev('refused', { peerId, why: r });
    return r ? { refuse: REFUSAL_TEXT[r] } : 'ask';
  }

  private gateFacts() {
    return {
      guests: this.room?.memberList.length ?? 0,
      pending: togetherState().requests.map((q) => ({ peerId: q.peerId, device: q.device ?? `p:${q.peerId}`, at: q.at ?? this.now() })),
    };
  }

  /** "Don't allow new people": new requests are refused at once, with no prompt. */
  setLocked(value: boolean): void {
    if (this.gate) this.gate.locked = value;
    setTogether({ locked: value });
  }

  /**
   * Who can find the session. "code": no Bonjour and no Bluetooth advert;
   * guests join only with the QR code or the typed code. A running session
   * can go from "anyone" to "code"; the other way needs a new session
   * (the native transport cannot advertise the open port again).
   */
  setFindable(value: Findable): void {
    if (!this.room) {
      this.nextFindable = value;
      setTogether({ findable: value });
      return;
    }
    if (value === 'code') {
      this.native?.stopAdvertising();
      this.native?.bleStopAdvertising?.();
      this.advertKey = null;
      this.bleAdvertising = false;
      setTogether({ findable: 'code' });
      void this.refreshHostFacts();
    }
  }

  /** Removes a member from the session. With `block`, its device cannot ask again in this session. */
  removeMember(memberId: string, block: boolean): void {
    const room = this.room;
    const g = this.gate;
    if (!room || !g) return;
    const peer = room.expel(memberId, block ? REFUSAL_TEXT['removed-blocked'] : REFUSAL_TEXT.removed);
    // The key the member's join had (its device key when it sent one), else the same rule as `deviceKey`.
    g.remove(this.memberDevices.get(memberId) ?? (peer && peer === memberId ? deviceKey(peer) : deviceKey('', memberId)), block);
    if (peer) setTimeout(() => this.link?.drop(peer), 300);
    this.publishHost();
  }

  private stopGate(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.expiryTimer = null;
    this.gate = null;
    this.memberDevices.clear();
  }

  /** Refuses the requests that waited too long. */
  private expireRequests(): void {
    const g = this.gate;
    if (!g) return;
    for (const p of g.expired(this.gateFacts().pending)) this.respond(p.peerId, false, REFUSAL_TEXT.timeout);
  }

  setOnlyHostControls(value: boolean): void {
    setTogether({ onlyHostControls: value });
    this.room?.setOnlyHostControls(value);
  }

  // ---- Guest ---------------------------------------------------------------------

  /** Looks for nearby sessions. `ble: false` (the Home card): the network only, to save battery. */
  browse(opts: { ble?: boolean } = {}): void {
    const n = this.native;
    if (!n) return;
    const st = togetherState();
    if (st.mode === 'nearby' && st.phase.name !== 'idle' && st.phase.name !== 'browsing' && st.phase.name !== 'ended') return;
    this.ensureLink();
    // The notice stays: it can say why the last join failed (declined, full, blocked).
    setTogether({ mode: 'nearby', role: 'guest', hosts: [], phase: IDLE, browsingSince: Date.now(), localNetwork: st.localNetwork === 'denied' ? 'denied' : 'unknown' });
    this.dispatch({ type: 'BROWSE' });
    n.startBrowsing();
    if (opts.ble !== false) void this.startBleScan(false);
  }

  /** Stops looking, when this device only looks (no session, no join in progress). */
  stopBrowsing(): void {
    const st = togetherState();
    if (st.mode === 'nearby' && (st.phase.name === 'browsing' || st.phase.name === 'idle') && !this.room && !this.follower) void this.stopAll();
  }

  private onServiceFound(serviceId: string, txt: Record<string, string>): void {
    const advert = decodeAdvert(txt);
    if (!advert) return;
    const lost = this.lostTimers.get(serviceId);
    if (lost) clearTimeout(lost);
    this.lostTimers.delete(serviceId);
    setTogether({ localNetwork: 'ok' });
    if (this.reconnect) {
      this.reconnectTo(serviceId, advert);
      return;
    }
    if (this.room) {
      this.maybeDemote(serviceId, advert);
      return;
    }
    // A known host keeps its place in the list: a new advert changes its row (the title), not the order.
    const row = { peerId: serviceId, advert, via: 'network' as const };
    const others = togetherState().hosts.filter((h) => !(h.via === 'ble' && shortSession(h.advert.sessionId) === shortSession(advert.sessionId)));
    const at = others.findIndex((h) => h.peerId === serviceId);
    setTogether({ hosts: at >= 0 ? others.map((h, i) => (i === at ? row : h)) : [...others, row] });
  }

  private onServiceLost(serviceId: string): void {
    if (this.lostTimers.has(serviceId)) return;
    this.lostTimers.set(
      serviceId,
      setTimeout(() => {
        this.lostTimers.delete(serviceId);
        setTogether({ hosts: togetherState().hosts.filter((h) => h.peerId !== serviceId) });
      }, LOST_AFTER),
    );
  }

  /** Sends a join request to a host found nearby (on the network or over Bluetooth). */
  join(peerId: string): void {
    const host = togetherState().hosts.find((h) => h.peerId === peerId);
    const link = this.ensureLink();
    if (!link || !host) return;
    if (host.via === 'ble') {
      this.bleJoin(peerId, host.advert);
      return;
    }
    this.joinAdvert = host.advert;
    this.startJoin({ serviceId: peerId }, host.advert.hostName, {});
  }

  /** Joins with a join code: a `zoggyfin://join?…` link (QR) or the short text code. */
  joinWithCode(text: string): boolean {
    const link = this.ensureLink();
    if (!link) return false;
    const payload = parseJoinLink(text.trim());
    const short = payload ? null : parseShortCode(text);
    if (!payload && !short) return false;
    const addrs = payload ? payload.addrs : [short!.addr];
    const port = payload ? payload.port : short!.port;
    const key = payload ? payload.key : short!.keyPrefix;
    const hostName = payload?.name ?? 'the host';
    this.joinAdvert = null;
    if (togetherState().mode !== 'nearby') setTogether({ mode: 'nearby', role: 'guest', hosts: [], notice: null, phase: IDLE });
    if (togetherState().phase.name !== 'browsing') this.dispatch({ type: 'BROWSE' });
    this.tryAddresses(addrs, port, key, hostName, payload ? payload.session : `k:${short!.keyPrefix}`);
    return true;
  }

  /** Tries each address of a code in turn. `salt`: for the device key (see `joinContext`). */
  private tryAddresses(addrs: string[], port: number, key: string, hostName: string, salt: string | null = null): void {
    const [first, ...rest] = addrs;
    if (!first) {
      this.dispatch({ type: 'DISCONNECTED', peerId: togetherState().phase.name === 'requesting' ? (togetherState().phase as { hostPeerId: string }).hostPeerId : '' });
      setTogether({ notice: 'Could not reach the host. Check that both devices are on the same Wi-Fi.' });
      return;
    }
    const peer = this.startJoin({ host: first, port }, hostName, { key, salt });
    this.codeFallback = rest.length ? { peer, rest, port, key, hostName, salt } : null;
  }

  private codeFallback: { peer: string; rest: string[]; port: number; key: string; hostName: string; salt: string | null } | null = null;

  /**
   * The join context. `salt`: the session's short id (or a code's key prefix) for the device
   * key (device-key.ts), so the host's block holds after this app restarts.
   */
  private joinContext(have: boolean, salt: string | null, key?: string): JoinContext {
    let device: string | null = null;
    if (salt) {
      try {
        device = sessionDeviceKey(salt, () => hex(this.random(16)));
      } catch {
        device = null;
      }
    }
    return { v: 1, name: displayName(), have, memberId: this.memberId, ...(key ? { key } : {}), ...(device ? { device } : {}) };
  }

  /** The salt of the device key for the session this device is in now. */
  private sessionSalt(): string | null {
    return this.session ? shortSession(this.session.id) : null;
  }

  private startJoin(target: HostTarget, hostName: string, extra: { key?: string; salt?: string | null }): string {
    const link = this.ensureLink()!;
    const have = this.joinAdvert ? localRecord(this.joinAdvert.itemId, this.joinAdvert.serverId) !== null : false;
    const salt = extra.salt ?? (this.joinAdvert ? shortSession(this.joinAdvert.sessionId) : null);
    const ctx = this.joinContext(have, salt, extra.key);
    const peer = link.join(target, ctx);
    this.hostTarget = target;
    if ('host' in target) this.lastAddress = target;
    this.dispatch({ type: 'REQUEST', hostPeerId: peer, hostName });
    setTogether({ notice: null, hostName });
    return peer;
  }

  private onPeerUp(peerId: string, ctx: JoinContext | null): void {
    this.ev('peer up', { peerId, host: !!this.room, name: ctx?.name });
    if (this.room) {
      // The room gets the guest's hello. Keep the device key of the member, for a block.
      if (ctx) this.memberDevices.set(ctx.memberId || peerId, deviceKey(peerId, ctx.memberId, ctx.device));
      return;
    }
    void ctx;
    const phase = togetherState().phase;
    if (phase.name === 'reconnecting') {
      this.relinked(peerId);
      return;
    }
    if (phase.name !== 'requesting' || phase.hostPeerId !== peerId) return;
    this.codeFallback = null;
    this.dispatch({ type: 'CONNECTED', peerId });
    if (togetherState().phase.name === 'syncing') this.startFollower(peerId);
  }

  private onPeerDown(peerId: string, e: { declined: boolean; reason: string | null; wasUp: boolean }): void {
    this.ev('peer down', { peerId, host: !!this.room, hostPeer: this.hostPeer, ...e });
    if (this.room) {
      this.room.removeMember(peerId);
      setTogether({ requests: togetherState().requests.filter((r) => r.peerId !== peerId) });
      return;
    }
    const phase = togetherState().phase;
    if (phase.name === 'requesting' && phase.hostPeerId === peerId) {
      const fb = this.codeFallback;
      if (fb && fb.peer === peerId && !e.declined) {
        this.dispatch({ type: 'DISCONNECTED', peerId });
        this.tryAddresses(fb.rest, fb.port, fb.key, fb.hostName, fb.salt);
        return;
      }
      this.dispatch({ type: 'DISCONNECTED', peerId });
      const after = togetherState().phase;
      if (after.name === 'browsing') setTogether({ notice: e.declined ? (e.reason ?? after.notice ?? null) : (e.reason ? `Could not join: ${e.reason}` : (after.notice ?? null)) });
      return;
    }
    if (this.reconnect && peerId === this.hostPeer) {
      this.reconnect.trying = false;
      this.hostPeer = null;
      if (e.declined && isFinalRefusal(e.reason)) this.closeGuest(e.reason!);
      return;
    }
    if ((phase.name === 'joined' || phase.name === 'syncing') && peerId === this.hostPeer) this.linkLost();
  }

  private onMessage(peerId: string, m: Message, receivedAt: number): void {
    if (this.room) {
      this.room.receive(peerId, m, receivedAt);
      return;
    }
    if (!this.follower || peerId !== this.hostPeer) return;
    // A welcome after a relink can bring another item (the room moved on while the link was down).
    const plan = m.t === 'welcome' ? this.planWelcome(m) : null;
    this.follower.receive(m, receivedAt);
    if (m.t === 'welcome' && plan) {
      this.afterWelcome(m, plan);
    } else if (m.t === 'queue' && m.by) {
      this.pickNote(m.by, m.queue.entries[m.queue.index]?.item.album ?? m.queue.entries[m.queue.index]?.item.name ?? 'music');
    } else if (m.t === 'removed') {
      // The host removed this device: no reconnect, and say so plainly.
      this.dispatch({ type: 'HOST_ENDED' });
      this.closeGuest(m.reason);
    } else if (m.t === 'end') {
      this.dispatch({ type: 'HOST_ENDED' });
      const p = togetherState().phase;
      this.closeGuest(p.name === 'ended' ? p.message : 'The session ended.');
    }
  }

  /** Before the follower reads a welcome: is it the first one, the same item again, or another item? */
  private planWelcome(m: Extract<Message, { t: 'welcome' }>): 'first' | 'same' | 'switch' {
    if (!this.welcomed) return 'first';
    const key = guestKeyOf(m.kind ?? 'video', m.item);
    if (key === this.guestKey) return 'same';
    // The audio queue of the welcome must load as a new item, not update the old one.
    this.loaded = false;
    this.loadToken++;
    return 'switch';
  }

  private afterWelcome(m: Extract<Message, { t: 'welcome' }>, plan: 'first' | 'same' | 'switch'): void {
    const newHost = !!this.session && (m.epoch ?? 0) !== this.session.epoch;
    const kind = m.kind ?? 'video';
    const title = m.item ? (kind === 'audio' ? (this.joinAdvert?.itemName || m.item.album || m.item.name) : m.item.name) : '';
    this.session = { id: m.sessionId, key: m.key ?? this.session?.key ?? '', epoch: m.epoch ?? 0, kind, title, itemId: kind === 'audio' ? null : (m.item?.id ?? null) };
    if (plan === 'first') {
      this.welcomed = true;
      this.dispatch({ type: 'WELCOME', sessionId: m.sessionId });
    }
    setTogether({ item: m.item, kind, onlyHostControls: m.onlyHostControls });
    this.save('guest', togetherState().hostName ?? 'Host');
    if (plan === 'first') {
      this.guestKey = guestKeyOf(kind, m.item);
      if (m.item && kind === 'video') void this.loadGuestVideo(m.item);
      // Audio loads on the queue (follower → onQueue). No item: the guest waits for the host to pick one.
    } else if (plan === 'switch') {
      this.switchGuestMedia(kind, m.item, m.queue ?? null);
    } else if (newHost && togetherState().source === 'stream' && m.item) {
      void this.reloadStream(m.item);
    }
  }

  /** "Sam picked Dune" on the other guests. `by` is the picker's member id. */
  private pickNote(by: string, title: string): void {
    const f = this.follower;
    if (!f || by === f.facts?.selfId) return;
    const name = f.allMembers.find((x) => x.id === by)?.name ?? 'Someone';
    toast(`${name.split(' · ')[0]} picked ${title}`, { icon: 'person.2.fill' });
  }

  /** Rooms: the host plays another item, or none. */
  private switchGuestMedia(kind: MediaKind, item: SharedItem | null, queue: SharedQueue | null, by?: string): void {
    const f = this.follower;
    if (!f) return;
    this.ev('room media', { kind, item: item?.id ?? null });
    this.loadToken++;
    this.port?.dispose();
    this.port = null;
    if (this.gaplessTimer) clearTimeout(this.gaplessTimer);
    this.gaplessTimer = null;
    this.moving = null;
    this.loaded = false;
    this.guestKey = guestKeyOf(kind, item);
    const title = item ? (kind === 'audio' ? (item.album ?? item.name) : item.name) : '';
    if (this.session) this.session = { ...this.session, kind, title, itemId: kind === 'video' ? (item?.id ?? null) : null };
    setTogether({ item, kind, source: null, notice: null });
    this.save('guest', togetherState().hostName ?? 'Host');
    if (by && item) this.pickNote(by, title);
    if (!item) {
      void this.stopGuestPlayer();
      return;
    }
    if (kind === 'video') {
      void this.loadGuestVideo(item);
      return;
    }
    if (playerState().presentation === 'full' && playerState().now?.kind === 'video') leavePlayer();
    if (queue) void this.loadGuestAudio(queue, false);
  }

  /** The room has no item: the guest's player stops (the room bar says who picks). */
  private async stopGuestPlayer(): Promise<void> {
    queueGate.set(null);
    audioSession().leaveShared();
    const now = playerState().now;
    if (now?.kind === 'video') {
      leavePlayer();
      await videoSession().stop();
    } else if (now?.kind === 'audio') {
      await audioSession().stop();
    }
  }

  /** The guest cannot play the room's item: it says why and stays in the room for the next item. */
  private guestCannot(message: string): void {
    this.ev('guest cannot play', { message });
    setTogether({ notice: message, source: null });
    toast(message, { icon: 'exclamationmark.triangle' });
    this.follower?.cannotPlay();
    this.port?.dispose();
    this.port = null;
    if (playerState().now?.kind === 'video') {
      leavePlayer();
      void videoSession().stop();
    }
  }

  /** The guest closed its player (or stopped the music): it stays in the room, and the group does not wait for it. */
  private onGuestPlayer(now: NowPlaying | null, status: string): void {
    if (!this.follower || this.room || !this.loaded || now || status !== 'idle') return;
    this.ev('guest closed the player');
    this.loaded = false;
    this.port?.dispose();
    this.port = null;
    queueGate.set(null);
    audioSession().leaveShared();
    this.follower.cannotPlay();
    setTogether({ source: null });
    toast('You are still in the session. The next item opens here.', { icon: 'person.2.fill' });
  }

  private unwatchGuest: (() => void) | null = null;

  private watchGuestPlayer(): void {
    this.unwatchGuest?.();
    this.unwatchGuest = usePlayerStore.subscribe((st) => this.onGuestPlayer(st.now, st.status));
    playRouter.set(this.router);
  }

  private startFollower(hostPeer: string): void {
    this.hostPeer = hostPeer;
    this.native?.stopBrowsing();
    void this.stopBleScan();
    const f = new Follower({
      send: (m) => this.send(m, this.hostPeer ? [this.hostPeer] : []),
      now: this.now,
      timers: realTimers,
      onChange: () => this.publishGuest(),
      onDenied: (reason) => {
        setTogether({ notice: reason });
        toast(reason, { icon: 'lock.fill' });
      },
      onSample: (s) => syncLog.sample(s),
      onQueue: (q) => void this.onGuestQueue(q),
      onTrackMismatch: (track, anchor) => this.onTrackMismatch(track, anchor),
      onMedia: (m) => this.switchGuestMedia(m.kind, m.item, m.queue ?? null, m.by),
    });
    this.follower = f;
    this.watchGuestPlayer();
    const a = this.joinAdvert;
    const own = a && a.kind !== 'audio' && localRecord(a.itemId, a.serverId) ? [a.itemId] : [];
    f.start(displayName(), own, { memberId: this.memberId, canHost: own.length > 0, maker: this.canMakeHotspot() });
    void this.resolveMediaBase();
  }

  private async resolveMediaBase(): Promise<string | null> {
    const n = this.native;
    const t = this.hostTarget;
    if (!n || !t) return null;
    try {
      this.mediaBase = 'serviceId' in t ? await n.mediaBase(t.serviceId, null, 0) : await n.mediaBase(null, t.host, t.port);
    } catch {
      this.mediaBase = null;
    }
    return this.mediaBase;
  }

  private publishGuest(): void {
    const f = this.follower;
    if (!f) return;
    const st = f.stats;
    controlGate.setPlaying(f.wantsPlay);
    setTogether({
      members: f.members,
      onlyHostControls: f.onlyHostControls,
      waiting: f.isWaiting,
      sync: st.clock ? { offset: st.clock.offset, rtt: st.clock.rtt, drift: st.drift === null ? null : st.drift * 1000 } : null,
    });
  }

  private startPosition(): number {
    const f = this.follower;
    const anchor = f?.groupAnchor;
    const hostNow = f?.hostNow() ?? null;
    return anchor ? (hostNow !== null ? positionAt(anchor, hostNow) : anchor.position) : 0;
  }

  /** Closes a sheet on another screen first: two modals cannot open at once. */
  private async closeOtherSheet(token: number): Promise<boolean> {
    const sheet = togetherState().sheet;
    if (sheet.open && sheet.where !== 'player' && sheet.where !== 'music') {
      closeTogetherSheet();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return token === this.loadToken;
  }

  private async loadGuestVideo(item: SharedItem): Promise<void> {
    const f = this.follower;
    if (!f) return;
    const token = ++this.loadToken;
    const base = this.mediaBase ?? (await this.resolveMediaBase());
    const own = guestSource(item, null, { forceStream: this.devForceStream });
    const activeServerId = useSessionStore.getState().session?.serverId ?? null;
    const sameServer = !!item.serverId && item.serverId === activeServerId;
    const src = chooseGuestVideoSource(item, {
      ownFile: own?.local ? own.uri : null,
      base,
      activeServerId,
      serverReachable: sameServer && !own?.local && !this.devForceStream ? await serverReachable() : false,
      forceStream: this.devForceStream,
    });
    if (token !== this.loadToken || this.follower !== f) return;
    if (src.kind === 'none') {
      this.guestCannot(src.reason === 'no-access' ? noAccessText(togetherState().hostName ?? 'The host') : item.path ? 'Could not open the stream from the host.' : 'The host cannot share this item.');
      return;
    }
    let local = src.kind === 'local';
    let fromServer = src.kind === 'server';
    setTogether({ source: local ? 'local' : fromServer ? 'server' : 'stream' });
    if (!(await this.closeOtherSheet(token))) return;
    if (playerState().now?.kind === 'audio') {
      queueGate.set(null);
      audioSession().leaveShared();
      await audioSession().stopForVideo();
    }
    if (token !== this.loadToken || this.follower !== f) return;
    // The player may still show what played before (the same film, alone): only the new load counts.
    const before = playerState().now;
    if (src.kind === 'server') {
      // Signed in to the same server: stream straight from it, at the group position.
      void videoSession().play({ item: toBaseItem(item), startPositionTicks: Math.round(this.startPosition() * 10_000_000), autoplay: false });
    } else {
      this.playGuestFile(item, src.uri, local);
    }
    router.navigate('/player');
    let ok = await whenPlayerReady(30_000, { after: before });
    if (token !== this.loadToken || this.follower !== f) return;
    if (!ok && fromServer && base && item.path) {
      // The server did not answer in time: read the host's file after all.
      this.ev('server stream failed, use the host');
      fromServer = false;
      local = false;
      setTogether({ source: 'stream' });
      const failed = playerState().now;
      this.playGuestFile(item, `${base}${item.path}`, false);
      ok = await whenPlayerReady(30_000, { after: failed });
      if (token !== this.loadToken || this.follower !== f) return;
    }
    if (!ok) {
      this.guestCannot('The video could not be played here.');
      return;
    }
    this.port = bindVideoPort((c) => {
      if (!f.request(c)) this.revertOutside(c);
    });
    this.attachGuest(f, local, fromServer);
  }

  /** Plays the guest's own download, or the host's file (a short player read-ahead: the host's upload is shared). */
  private playGuestFile(item: SharedItem, uri: string, local: boolean): void {
    const record = local ? localRecord(item.id, item.serverId) : null;
    void videoSession().playSource({ item: toBaseItem(item), uri, startSeconds: this.startPosition(), autoplay: false, record, readAhead: local ? undefined : HOST_READ_AHEAD });
  }

  private attachGuest(f: Follower, local: boolean, fromServer = false): void {
    controlGate.set((c) => {
      f.request(c);
      return true;
    });
    f.attach(this.port!, local, fromServer);
    this.publishGuest();
    const fresh = !this.loaded;
    this.loaded = true;
    syncLog.start('guest', () => ({ pos: this.port?.position() ?? 0, playing: this.port?.isPlaying() ?? false, track: this.port?.track?.() ?? null }), this.now, fresh);
  }

  /** A new host after a handover: a guest that streamed reads the new host's file at the same position. */
  private async reloadStream(item: SharedItem): Promise<void> {
    const base = await this.resolveMediaBase();
    const kind = this.session?.kind ?? 'video';
    if (kind === 'video') {
      const src = guestSource(item, base);
      if (!src) return;
      const position = this.port?.position() ?? this.startPosition();
      // Play at once when the group plays: the port still reports the old player's play state.
      void videoSession().playSource({ item: toBaseItem(item), uri: src.uri, startSeconds: position, autoplay: this.groupPlaying(), record: null, readAhead: src.local ? undefined : HOST_READ_AHEAD });
      return;
    }
    const q = this.follower?.queue;
    if (q) await this.loadGuestAudio(q, true);
  }

  // ---- Guest audio ---------------------------------------------------------------------

  private async onGuestQueue(q: SharedQueue): Promise<void> {
    if (!this.loaded) {
      await this.loadGuestAudio(q, false);
      return;
    }
    // The guest plays video now: a `media` message brings the audio, not a queue update.
    if (playerState().now?.kind !== 'audio') return;
    audioSession().updateShared(fromSharedQueue(q), q.longForm, this.groupPlaying());
    this.sendCanHost(q);
  }

  private sendCanHost(q: SharedQueue): void {
    const all = q.entries.length > 0 && q.entries.every((e) => localRecord(e.item.id, e.item.serverId) !== null);
    const port = this.port;
    this.send({ t: 'buffering', buffering: port?.isBuffering() ?? false, local: togetherState().source === 'local', canHost: all }, this.hostPeer ? [this.hostPeer] : []);
  }

  private async loadGuestAudio(q: SharedQueue, reload: boolean): Promise<void> {
    const f = this.follower;
    if (!f) return;
    const token = ++this.loadToken;
    const base = this.mediaBase ?? (await this.resolveMediaBase());
    const items = new Map(q.entries.map((e) => [e.item.id, e.item] as const));
    const activeServerId = useSessionStore.getState().session?.serverId ?? null;
    const onServer = !this.devForceStream && q.entries.some((e) => e.item.serverId && e.item.serverId === activeServerId);
    const server = { activeServerId, reachable: onServer ? await serverReachable() : false };
    if (token !== this.loadToken || this.follower !== f) return;
    let anyStream = false;
    let anyLocal = false;
    let anyServer = false;
    const source = (item: { Id: string }) => {
      const s = items.get(item.Id);
      const src = s ? guestSource(s, base, { forceStream: this.devForceStream, server }) : null;
      if (src?.local) anyLocal = true;
      else if (src) anyStream = true;
      else if (s && server.reachable && s.serverId === activeServerId) anyServer = true;
      return src?.uri ?? null;
    };
    await stopVideoForAudio();
    if (token !== this.loadToken || this.follower !== f) return;
    queueGate.set('The host plays the queue in this session.');
    await audioSession().loadShared(fromSharedQueue(q), q.longForm, source, this.startPosition(), { autoplay: reload && this.groupPlaying() });
    if (token !== this.loadToken || this.follower !== f) return;
    setTogether({ source: anyStream || !anyLocal ? 'stream' : 'local' });
    if (!reload) {
      if (!(await this.closeOtherSheet(token))) return;
      router.navigate('/now-playing');
      this.port = bindAudioPort((c) => {
        if (!f.request(c)) this.revertOutside(c);
      });
      this.attachGuest(f, !anyStream && !anyServer, anyServer && !anyStream);
    }
    this.sendCanHost(q);
  }

  /** True while the group plays (a reloaded player starts at once, see `reloadStream`). */
  private groupPlaying(): boolean {
    return this.follower?.groupAnchor?.playing ?? false;
  }

  /** The guest plays another entry than the group: wait for the gapless change, or move now. */
  private onTrackMismatch(track: string, anchor: Anchor): void {
    if (this.moving === track) return;
    const f = this.follower;
    if (!f) return;
    const wait = waitForGapless({ queue: f.queue, playerTrack: this.port?.track?.() ?? null, groupTrack: track, remaining: audioSession().remaining(), rate: anchor.rate });
    if (wait !== null) {
      if (this.gaplessTimer) return;
      this.gaplessTimer = setTimeout(() => {
        this.gaplessTimer = null;
        if (this.port?.track?.() !== track) this.moveTo(track, anchor);
      }, wait);
      return;
    }
    this.moveTo(track, anchor);
  }

  private moveTo(track: string, anchor: Anchor): void {
    this.moving = track;
    const hostNow = this.follower?.hostNow() ?? null;
    const position = hostNow !== null ? positionAt(anchor, hostNow) : anchor.position;
    void audioSession()
      // Play at once when the group plays: the port still reports the old track's play state.
      .moveShared(track, Math.max(0, position), anchor.playing)
      .finally(() => {
        this.moving = null;
        this.follower && this.port && this.follower.attach(this.port, togetherState().source === 'local');
      });
  }

  /** A guest that may not control: undo a change from the lock screen. */
  private revertOutside(c: UserControl): void {
    if (c.action === 'play') this.port?.pause();
    else if (c.action === 'pause') this.port?.play();
  }

  // ---- Drops and reconnects ------------------------------------------------------------

  /** The guest lost the link to the host: play on, and try to come back. */
  private linkLost(): void {
    this.ev('link lost');
    this.dispatch({ type: 'LINK_LOST', at: Date.now() });
    if (togetherState().phase.name !== 'reconnecting') return;
    this.reconnect = { since: Date.now(), attempt: 0, timer: null, trying: false, oldHostId: this.follower?.facts?.hostId ?? null };
    this.hostPeer = null;
    toast(`Lost the link to ${togetherState().hostName ?? 'the host'}. Playing on and reconnecting…`, { icon: 'wifi.exclamationmark' });
    this.native?.startBrowsing();
    void this.startBleScan(true);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const r = this.reconnect;
    if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => this.retry(), retryDelay(r.attempt));
  }

  private retry(): void {
    const r = this.reconnect;
    const f = this.follower;
    const s = this.session;
    if (!r || !f || !s) return;
    r.attempt += 1;
    if (!shouldRetry(r.since, Date.now())) {
      this.dispatch({ type: 'GIVE_UP', message: `The connection to ${togetherState().hostName ?? 'the host'} was lost.` });
      this.reconnect = null;
      this.closeGuest(`The connection to ${togetherState().hostName ?? 'the host'} was lost.`);
      return;
    }
    const selfId = f.facts?.selfId ?? this.memberId;
    const oldHostId = r.oldHostId ?? '__host__';
    const decision = afterHostLoss({
      selfId,
      oldHostId,
      members: [
        ...f.allMembers.filter((m) => m.id !== selfId),
        // Without a player port this device cannot continue the group, so it must not win.
        { id: selfId, joinedAt: f.allMembers.find((m) => m.id === selfId)?.joinedAt, canHost: this.canHostNow(), away: false, noMedia: !this.port },
      ],
      elapsed: Date.now() - r.since,
    });
    this.dispatch({ type: 'WAITING_FOR_HOST', waiting: decision.kind === 'wait-for-host' });
    this.ev('retry', { attempt: r.attempt, decision: decision.kind, members: f.allMembers.length });
    if (decision.kind === 'become-host' && this.port) {
      void this.promote();
      return;
    }
    // Retry, follow a new host or wait: try the last address (a code join or Bluetooth); the browser handles the rest.
    if (!r.trying && this.lastAddress && decision.kind !== 'follow') {
      r.trying = true;
      this.hostPeer = this.ensureLink()!.join(this.lastAddress, this.joinContext(false, this.sessionSalt(), s.key));
    }
    this.scheduleRetry();
  }

  /** The browser found a service while reconnecting: the same session, from the old host or a new one. */
  private reconnectTo(serviceId: string, advert: Advert): void {
    const r = this.reconnect;
    const s = this.session;
    if (!r || !s || r.trying || advert.sessionId !== s.id || (advert.epoch ?? 0) < s.epoch) return;
    r.trying = true;
    this.hostTarget = { serviceId };
    this.hostPeer = this.ensureLink()!.join({ serviceId }, this.joinContext(false, this.sessionSalt(), s.key));
  }

  private relinked(peerId: string): void {
    this.ev('relinked', { peerId });
    const f = this.follower;
    const r = this.reconnect;
    if (!f || !r) return;
    if (r.timer) clearTimeout(r.timer);
    this.reconnect = null;
    this.hostPeer = peerId;
    this.native?.stopBrowsing();
    void this.stopBleScan();
    this.mediaBase = null;
    void this.resolveMediaBase();
    f.relink((m) => this.send(m, this.hostPeer ? [this.hostPeer] : []), true, { canHost: this.canHostNow() });
    this.dispatch({ type: 'RELINKED', hostPeerId: peerId, hostName: togetherState().hostName ?? 'Host' });
    toast('Back in the session.', { icon: 'person.2.fill' });
  }

  private canHostNow(): boolean {
    const s = this.session;
    if (!s) return false;
    if (s.kind === 'video') return !!s.itemId && localRecord(s.itemId) !== null;
    const q = this.follower?.queue;
    return !!q && q.entries.length > 0 && q.entries.every((e) => localRecord(e.item.id, e.item.serverId) !== null);
  }

  private canMakeHotspot(): boolean {
    return this.native?.platform === 'android' && typeof this.native.startHotspot === 'function';
  }

  /** This guest is the new host: it continues from its own player, so its position does not jump. */
  private async promote(): Promise<void> {
    const f = this.follower;
    const s = this.session;
    const port = this.port;
    const r = this.reconnect;
    if (!f || !s || !port || !r) return;
    if (r.timer) clearTimeout(r.timer);
    this.reconnect = null;
    const last = f.groupAnchor;
    const offset = f.offset ?? 0;
    const now = this.now();
    const anchor = last ? handoverAnchor(last, offset, now, { position: port.position() }) : { playing: port.isPlaying(), rate: 1, hostTime: now, position: port.position() };
    const jump = last ? Math.round(handoverJump(last, offset, anchor, now) * 1000) : null;
    this.ev('promote', { jump });
    if (last) console.log(`[together] handover: position change ${jump} ms`);
    const selfId = f.facts?.selfId ?? this.memberId;
    const members = f.allMembers.filter((m) => m.id !== selfId && m.id !== r.oldHostId);
    const media = f.media;
    f.release();
    this.follower = null;
    // A join to the old host may still be open (a retry): close it, so the old host cannot take this device back as a guest.
    if (this.hostPeer) this.link?.drop(this.hostPeer);
    this.hostPeer = null;
    this.unwatchGuest?.();
    this.unwatchGuest = null;
    this.native?.stopBrowsing();
    this.memberId = selfId;
    // The new host: the room binds its own port to the player that plays; the room takes the controls.
    port.dispose();
    this.port = null;
    queueGate.set(null);
    audioSession().leaveShared();
    await this.startHosting({
      takeover: { anchor, members, epoch: s.epoch + 1, sessionId: s.id, key: s.key, media },
    });
    setTogether({ source: null });
    toast('You are the host now.', { icon: 'person.2.fill' });
  }

  private watchForNewerHost(): void {
    this.native?.startBrowsing();
    this.demoteWatch = setInterval(() => this.native?.startBrowsing(), 15_000);
  }

  private stopDemoteWatch(): void {
    if (this.demoteWatch) clearInterval(this.demoteWatch);
    this.demoteWatch = null;
    if (this.room) this.native?.stopBrowsing();
  }

  /** The old host came back and another member is the host now: it joins that host as a member. */
  private maybeDemote(serviceId: string, advert: Advert): void {
    const s = this.session;
    if (!s || !this.room || advert.sessionId !== s.id || (advert.epoch ?? 0) <= s.epoch || serviceId === this.serviceName) return;
    this.stopDemoteWatch();
    this.stopGate();
    this.ev('demote', { to: advert.hostName, epoch: advert.epoch });
    const port = this.port;
    this.room.dispose();
    this.room = null;
    this.unwatchHost?.();
    this.unwatchHost = null;
    this.clearEmptyTimer();
    this.hostKey = null;
    this.hostQueueBinding?.dispose();
    this.hostQueueBinding = null;
    controlGate.set(null);
    this.native?.stopServer();
    port?.dispose();
    this.port = null;
    toast(`${advert.hostName} is the host now. You join as a member.`, { icon: 'person.2.fill' });
    this.joinAdvert = advert;
    setTogether({ role: 'guest', phase: { name: 'browsing' }, requests: [], joinCode: null, members: [] });
    this.loaded = true;
    this.welcomed = true;
    this.guestKey = guestKeyOf(s.kind, s.kind === 'video' ? (s.itemId ? ({ id: s.itemId } as SharedItem) : null) : ({ id: 'audio' } as SharedItem));
    this.session = { ...s, epoch: advert.epoch ?? s.epoch };
    // The player keeps what it plays: the new welcome brings the anchor, and the follower moves it.
    const f = new Follower({
      send: (m) => this.send(m, this.hostPeer ? [this.hostPeer] : []),
      now: this.now,
      timers: realTimers,
      onChange: () => this.publishGuest(),
      onSample: (x) => syncLog.sample(x),
      onQueue: (q) => void this.onGuestQueue(q),
      onTrackMismatch: (track, anchor) => this.onTrackMismatch(track, anchor),
      onMedia: (m) => this.switchGuestMedia(m.kind, m.item, m.queue ?? null, m.by),
    });
    this.follower = f;
    this.watchGuestPlayer();
    const peer = this.startJoin({ serviceId }, advert.hostName, { key: s.key });
    this.hostPeer = peer;
    const rebound = s.kind === 'audio' ? bindAudioPort((c) => f.request(c)) : bindVideoPort((c) => f.request(c));
    this.port = rebound;
    f.start(displayName(), [], { memberId: this.memberId, canHost: true, maker: this.canMakeHotspot() });
    setTogether({ source: 'local' });
    this.attachGuest(f, true);
  }

  /** After an app restart: joins the saved session again (a host that finds no new host starts it again). */
  rejoin(): void {
    const saved = togetherState().rejoin;
    if (!saved || !this.native) return;
    this.memberId = saved.memberId;
    this.session = { id: saved.sessionId, key: saved.key, epoch: saved.epoch, kind: saved.kind, title: saved.title, itemId: saved.itemId };
    this.browse();
    setTogether({ notice: `Looking for “${saved.title}”…` });
    const deadline = Date.now() + 6000;
    const tick = setInterval(() => {
      const host = togetherState().hosts.find((h) => h.via === 'network' && h.advert.sessionId === saved.sessionId);
      if (host) {
        clearInterval(tick);
        this.joinAdvert = host.advert;
        this.startJoin({ serviceId: host.peerId }, host.advert.hostName, { key: saved.key });
        this.forget();
        return;
      }
      if (Date.now() < deadline) return;
      clearInterval(tick);
      if (saved.role === 'host') {
        this.forget();
        // The room opens again; a video that the host has downloaded plays in it again.
        const r = saved.kind === 'video' && saved.itemId ? localRecord(saved.itemId) : null;
        if (r) void this.host(r.item, saved);
        else void this.openRoom({ adopt: saved.kind === 'audio' && canHostAudio(), resume: saved });
      } else {
        setTogether({ notice: `“${saved.title}” is not nearby.` });
      }
    }, 500);
  }

  dismissRejoin(): void {
    this.forget();
  }

  // ---- Bluetooth rendezvous ----------------------------------------------------------------

  private listenBle(): void {
    const n = this.native;
    if (!n || this.bleSubs.length || !n.bleScan) return;
    this.bleSubs = [
      n.on('onBleState', (e) => {
        setTogether({ ble: e.state });
        if (this.room) void this.refreshHostFacts();
      }),
      n.on('onBlePeer', (e) => this.onBlePeer(e.peerId, e.info)),
      n.on('onBlePeerLost', (e) => {
        this.bleInfo.delete(e.peerId);
        setTogether({ hosts: togetherState().hosts.filter((h) => !(h.via === 'ble' && h.peerId === e.peerId)) });
      }),
      n.on('onBleConnected', (e) => {
        if (e.role === 'peripheral') this.bleCentrals.add(e.peerId);
        if (e.role === 'peripheral' && this.room) this.bleHostPeer(e.peerId);
      }),
      n.on('onBleMessage', (e) => {
        if (!this.onBleInfo(e.peerId, e.text)) this.bleHandle(e.peerId, { type: 'MESSAGE', text: e.text });
      }),
      n.on('onBleDisconnected', (e) => {
        this.bleCentrals.delete(e.peerId);
        this.bleHandle(e.peerId, { type: 'LINK_LOST' });
      }),
    ];
  }

  /** Bluetooth state; asks for the permission only when `ask`. */
  async bleCheck(ask: boolean): Promise<BleState | null> {
    const n = this.native;
    if (!n?.bleState) return null;
    let state = await n.bleState();
    if (ask && state !== 'on' && state !== 'off' && state !== 'unsupported' && n.bleRequestPermission) state = await n.bleRequestPermission();
    setTogether({ ble: state });
    return state;
  }

  private async startBleScan(ask: boolean): Promise<void> {
    const state = await this.bleCheck(ask);
    if (state !== 'on') return;
    this.listenBle();
    this.native?.bleScan?.();
  }

  private async stopBleScan(): Promise<void> {
    this.native?.bleStopScan?.();
  }

  /** The sheet's "Allow Bluetooth": asks, then scans. */
  async allowBluetooth(): Promise<void> {
    await this.startBleScan(true);
    if (this.room) void this.startBleHost();
  }

  private async startBleHost(): Promise<void> {
    const n = this.native;
    if (!n?.bleAdvertise || !this.session) return;
    const state = await this.bleCheck(true);
    if (state !== 'on' || !this.room) return;
    this.listenBle();
    const info = this.bleInfoText();
    if (!info) return;
    this.lastBleInfo = info;
    this.bleAdvertising = true;
    n.bleAdvertise(info, 'Zoggyfin');
    void this.refreshHostFacts();
  }

  /** The last INFO that the host published over Bluetooth. */
  private lastBleInfo: string | null = null;

  /** The Bluetooth INFO of the room now (the title is empty in an empty room). */
  private bleInfoText(): string | null {
    const n = this.native;
    const s = this.session;
    if (!n || !s) return null;
    return encodeInfo({
      v: 1,
      session: shortSession(s.id),
      host: displayName(),
      title: s.title,
      kind: s.kind,
      platform: n.platform,
      canHotspot: this.canMakeHotspot(),
      canJoinWifi: typeof n.joinWifi === 'function',
    });
  }

  /**
   * Guest: a host sends its INFO again when its room changes. True when the
   * text is an INFO: the row of that host changes in place, and the
   * rendezvous does not see the text.
   */
  private onBleInfo(peerId: string, text: string): boolean {
    const info = decodeInfo(text);
    if (!info) return false;
    const old = this.bleInfo.get(peerId);
    if (old && old.session !== info.session) return true;
    this.bleInfo.set(peerId, info);
    const hosts = togetherState().hosts;
    if (hosts.some((h) => h.via === 'ble' && h.peerId === peerId)) {
      setTogether({ hosts: hosts.map((h) => (h.via === 'ble' && h.peerId === peerId ? { ...h, advert: bleAdvert(info) } : h)) });
    }
    return true;
  }

  private onBlePeer(peerId: string, text: string): void {
    const info = decodeInfo(text);
    if (!info) return;
    this.bleInfo.set(peerId, info);
    const st = togetherState();
    if (this.reconnect && this.session && info.session === shortSession(this.session.id)) {
      // The session is back over Bluetooth (for example a new Wi-Fi network after the old one went away).
      this.bleJoin(peerId, { sessionId: this.session.id, hostName: info.host, itemId: '', itemName: info.title, serverId: null, kind: info.kind });
      return;
    }
    // Skip a session that the network already shows.
    if (st.hosts.some((h) => h.via === 'network' && shortSession(h.advert.sessionId) === info.session)) return;
    const row = { peerId, advert: bleAdvert(info), via: 'ble' as const };
    const at = st.hosts.findIndex((h) => h.peerId === peerId);
    setTogether({ hosts: at >= 0 ? st.hosts.map((h, i) => (i === at ? row : h)) : [...st.hosts, row] });
  }

  private ensureKeyPair() {
    this.keyPair ??= generateKeyPair(this.random);
    return this.keyPair;
  }

  private selfCaps() {
    const n = this.native!;
    return { name: displayName(), platform: n.platform, canHotspot: this.canMakeHotspot(), canJoinWifi: typeof n.joinWifi === 'function', memberId: this.memberId };
  }

  /** Guest: starts the Bluetooth rendezvous with a host. */
  private bleJoin(peerId: string, advert: Advert): void {
    const info = this.bleInfo.get(peerId);
    if (!info) return;
    this.joinAdvert = advert;
    const machine = createRendezvous({ role: 'guest', self: this.selfCaps(), session: info.session, hostName: info.host, have: false, keyPair: this.ensureKeyPair(), random: this.random });
    this.ble.set(peerId, machine);
    if (!this.reconnect) {
      this.dispatch({ type: 'REQUEST', hostPeerId: `ble:${peerId}`, hostName: info.host });
      setTogether({ hostName: info.host });
    }
    this.runBle(peerId, machine.start());
  }

  /** Host: a guest connected over Bluetooth. */
  private bleHostPeer(peerId: string): void {
    const s = this.session;
    if (!s || this.ble.has(peerId)) return;
    const machine = createRendezvous({ role: 'host', self: this.selfCaps(), session: shortSession(s.id), rejoinKey: s.key, keyPair: this.ensureKeyPair(), random: this.random });
    this.ble.set(peerId, machine);
    this.runBle(peerId, machine.start());
  }

  private bleHandle(peerId: string, event: Parameters<Rendezvous['handle']>[0]): void {
    const m = this.ble.get(peerId);
    if (!m) return;
    this.runBle(peerId, m.handle(event));
  }

  private runBle(peerId: string, effects: RendezvousEffect[]): void {
    const n = this.native;
    const m = this.ble.get(peerId);
    if (!n || !m) return;
    for (const e of effects) {
      switch (e.type) {
        case 'send':
          n.bleSend?.(peerId, e.text);
          break;
        case 'askApproval': {
          const refusal = this.gate?.screen(`b:${peerId}`, this.gateFacts()) ?? null;
          if (refusal) {
            this.bleHandle(peerId, { type: 'DECLINE' });
            break;
          }
          const req = { inviteId: peerId, peerId, name: e.name, have: e.have, ble: true, device: `b:${peerId}`, at: this.now() };
          setTogether({ requests: [...togetherState().requests.filter((r) => r.peerId !== peerId), req] });
          toast(`${e.name} wants to join you`, { icon: 'person.2.fill' });
          break;
        }
        case 'startHotspot':
          void this.makeHotspot().then(
            (h) => this.bleHandle(peerId, h ? { type: 'HOTSPOT_READY', ssid: h.ssid, password: h.password } : { type: 'HOTSPOT_FAILED' }),
            (err: unknown) => this.bleHandle(peerId, { type: 'HOTSPOT_FAILED', message: err instanceof Error ? err.message : String(err) }),
          );
          break;
        case 'joinWifi':
          void (n.joinWifi?.(e.ssid, e.password) ?? Promise.reject(new Error('This device cannot join a Wi-Fi network.'))).then(
            () => this.bleHandle(peerId, { type: 'WIFI_JOINED' }),
            (err: unknown) => this.bleHandle(peerId, { type: 'WIFI_FAILED', message: err instanceof Error ? err.message : String(err) }),
          );
          break;
        case 'needAddresses':
          void n.addresses().then((a) => this.bleHandle(peerId, { type: 'ADDRESSES', addrs: pickCodeAddress(a).map((x) => x.address), port: this.serverPort }));
          break;
        case 'connect': {
          this.lastAddress = e.addrs[0] ? { host: e.addrs[0], port: e.port } : null;
          if (this.reconnect) {
            if (this.lastAddress) {
              this.reconnect.trying = true;
              this.hostPeer = this.ensureLink()!.join(this.lastAddress, this.joinContext(false, this.sessionSalt(), e.rejoinKey));
            }
            this.bleHandle(peerId, { type: 'CONNECTED' });
            break;
          }
          // The rendezvous request ends here; the TCP join (with the key: no second approval) takes over.
          this.dispatch({ type: 'DISCONNECTED', peerId: `ble:${peerId}` });
          this.tryAddresses(e.addrs, e.port, e.rejoinKey, togetherState().hostName ?? 'the host');
          this.bleHandle(peerId, { type: 'CONNECTED' });
          break;
        }
        case 'progress':
          setTogether({ rendezvous: { text: e.text, failed: false } });
          break;
        case 'setTimer': {
          const old = this.bleTimers.get(peerId);
          if (old) clearTimeout(old);
          this.bleTimers.set(
            peerId,
            setTimeout(() => this.bleHandle(peerId, { type: 'TIMEOUT' }), e.ms),
          );
          break;
        }
        case 'done':
        case 'fail': {
          const old = this.bleTimers.get(peerId);
          if (old) clearTimeout(old);
          this.bleTimers.delete(peerId);
          this.ble.delete(peerId);
          if (e.type === 'fail') {
            setTogether({ rendezvous: { text: e.message, failed: true }, requests: togetherState().requests.filter((r) => r.peerId !== peerId) });
            const phase = togetherState().phase;
            if (phase.name === 'requesting' && phase.hostPeerId === `ble:${peerId}`) this.dispatch({ type: 'DISCONNECTED', peerId: `ble:${peerId}` });
          } else {
            setTogether({ rendezvous: null });
          }
          break;
        }
      }
    }
  }

  /** Android: makes a Wi-Fi network for the session (local-only hotspot). */
  async makeHotspot(): Promise<{ ssid: string; password: string } | null> {
    const n = this.native;
    if (!n?.startHotspot) return null;
    const h = await n.startHotspot();
    setTogether({ hotspot: h });
    if (this.room) void this.refreshHostFacts();
    return h;
  }

  stopHotspot(): void {
    this.native?.stopHotspot?.();
    setTogether({ hotspot: null });
  }

  openSettings(): void {
    this.native?.openSettings?.();
  }

  // ---- Ends ------------------------------------------------------------------------------

  /**
   * The guest's session is over (the host ended it, the link was lost, or the
   * media failed). A streamed file is gone with the host: the player stops and
   * closes. With its own download the guest keeps the player, paused at the
   * same position, and plays on alone. A guest with no account has no player
   * outside the session, so its player closes too.
   */
  private closeGuest(message: string): void {
    this.ev('close guest', { message });
    const source = togetherState().source;
    const kind = this.session?.kind ?? 'video';
    const keep = guestKeepsPlayer(source, !!useSessionStore.getState().session);
    if (keep) this.port?.pause();
    this.teardownGuest();
    this.port = null;
    this.closeLink();
    this.forget();
    toast(message, { icon: 'person.2.slash' });
    if (source !== null && !keep) {
      closeTogetherSheet();
      if (kind === 'video') {
        leavePlayer();
        void videoSession().stop();
      } else {
        void audioSession().stop();
      }
    }
    this.session = null;
    setTogether(noSession());
  }

  private teardownGuest(): void {
    this.loadToken++;
    this.loaded = false;
    this.welcomed = false;
    this.guestKey = null;
    this.unwatchGuest?.();
    this.unwatchGuest = null;
    playRouter.set(null);
    if (this.reconnect?.timer) clearTimeout(this.reconnect.timer);
    this.reconnect = null;
    if (this.gaplessTimer) clearTimeout(this.gaplessTimer);
    this.gaplessTimer = null;
    this.follower?.dispose();
    this.follower = null;
    this.hostPeer = null;
    this.hostTarget = null;
    this.lastAddress = null;
    this.mediaBase = null;
    this.codeFallback = null;
    controlGate.set(null);
    queueGate.set(null);
    audioSession().leaveShared();
    this.port?.dispose();
    syncLog.stop();
    this.stopBle();
    this.native?.stopRelay();
    this.native?.stopAll();
  }

  private stopBle(): void {
    for (const t of this.bleTimers.values()) clearTimeout(t);
    this.bleTimers.clear();
    this.bleAdvertising = false;
    this.lastBleInfo = null;
    this.bleCentrals.clear();
    this.ble.clear();
    this.bleInfo.clear();
    this.bleSubs.forEach((s) => s.remove());
    this.bleSubs = [];
    this.native?.bleStopAll?.();
  }

  /** Host: ends the session for everyone. Guest: leaves. */
  async stopAll(): Promise<void> {
    this.ev('stop all');
    const n = this.native;
    this.stopGate();
    this.advertKey = null;
    for (const t of this.lostTimers.values()) clearTimeout(t);
    this.lostTimers.clear();
    if (this.room) {
      this.room.end();
      this.room = null;
      this.unwatchHost?.();
      this.unwatchHost = null;
      this.clearEmptyTimer();
      this.hostKey = null;
      this.pendingPick = null;
      playRouter.set(null);
      this.stopDemoteWatch();
      // Let the end message leave before the link closes.
      await new Promise((r) => setTimeout(r, 300));
      n?.unshareAll();
      n?.stopAll();
      this.hostQueueBinding?.dispose();
      this.hostQueueBinding = null;
      this.shares = null;
      controlGate.set(null);
      this.port?.dispose();
      this.port = null;
      this.stopBle();
      syncLog.stop();
    } else if (this.follower) {
      const source = togetherState().source;
      const kind = this.session?.kind ?? 'video';
      // The guest's own download or server: it plays on alone. The host's file goes with the host.
      const close = source !== null && !guestKeepsPlayer(source, !!useSessionStore.getState().session);
      this.follower.leave();
      await new Promise((r) => setTimeout(r, 200));
      this.teardownGuest();
      this.port = null;
      // The host's file is not there without the session: close the player.
      if (close) {
        if (kind === 'video') {
          leavePlayer();
          void videoSession().stop();
        } else {
          void audioSession().stop();
        }
      }
    } else {
      this.stopBle();
      n?.stopAll();
    }
    this.session = null;
    this.closeLink();
    this.forget();
    setTogether({ ...noSession(), notice: togetherState().notice, rejoin: null });
  }

  /** Clears an ended session from the sheet. */
  dismiss(): void {
    if (this.room || this.follower) return;
    void this.stopAll();
  }

  mediaStats() {
    return this.native?.mediaStats() ?? null;
  }
}

let controller: NearbyController | null = null;

export function nearby(): NearbyController {
  controller ??= new NearbyController();
  return controller;
}
