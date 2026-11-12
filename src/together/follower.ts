/**
 * The guest side of a nearby session. The follower keeps the clock offset
 * to the host (ping/pong), follows the group state through an
 * AnchorFollower, and sends the guest's controls and buffering to the host.
 */
import { AnchorFollower, type SyncSample } from './anchor-follower';
import { ClockSync, type ClockEstimate } from './clock';
import { DEFAULT_DRIFT, type DriftOptions } from './drift';
import type { Anchor, ControlAction, MediaKind, Member, Message, PickRequest, SharedQueue } from './protocol';
import { PlayIntent } from './play-intent';
import type { PlayerPort, Timers } from './player-port';
import { ONLY_HOST_PICKS_TEXT } from './room-route';

export type { SyncSample } from './anchor-follower';

export interface FollowerDeps {
  send(message: Message): void;
  /** Local monotonic clock, ms. */
  now(): number;
  timers: Timers;
  onChange?(): void;
  /** The host said no to a control. */
  onDenied?(reason: string): void;
  /** Called on each drift check, for measurements. */
  onSample?(sample: SyncSample): void;
  /** Audio: the host's queue (from the welcome, and after each change). */
  onQueue?(queue: SharedQueue): void;
  /** Audio: the player is on another queue entry than the group. */
  onTrackMismatch?(track: string, anchor: Anchor): void;
  /** Rooms: the host plays another item, or none. The player is let go: load the new item, then `attach`. */
  onMedia?(media: Extract<Message, { t: 'media' }>): void;
  /** "Sound plays on" changed (speaker.ts). `fallback`: the chosen device left, the host plays the sound now. */
  onSpeaker?(target: string | null, fallback: boolean): void;
}

/** What the host told this guest about the session (for reconnects and the election). */
export interface SessionFacts {
  sessionId: string;
  key: string | null;
  epoch: number;
  hostId: string | null;
  kind: MediaKind;
  selfId: string | null;
}

export interface FollowerStats {
  clock: ClockEstimate | null;
  /** The last measured drift, seconds (positive: this device is behind). */
  drift: number | null;
  corrections: { rate: number; seek: number };
}

const BURST = 8;
const BURST_GAP = 120;
/** Pings until the clock converges, and after a jump, ms. */
export const PING_FAST = 2000;
/** Pings once the clock converged, ms (each ping wakes the host's radio). */
export const PING_SLOW = 10_000;
/** After a jump (a relink, or a round trip far above the lowest), this many pings go at the fast pace. */
const FAST_AFTER_JUMP = 8;
const TICK = 500;

export class Follower {
  private clock = new ClockSync();
  private anchors: AnchorFollower;
  private waiting = false;
  private seq = -1;
  private pingId = 0;
  private pending = new Set<number>();
  private timers: unknown[] = [];
  private pingTimer: unknown = null;
  /** Pings left at the fast pace (after a jump). */
  private fastLeft = 0;
  private unsubBuffering: (() => void) | null = null;
  /** The other guests (this guest is left out). */
  members: Member[] = [];
  /** Every guest, this guest too (for the host election). */
  allMembers: Member[] = [];
  facts: SessionFacts | null = null;
  queue: SharedQueue | null = null;
  private selfId: string | null = null;
  onlyHostControls = false;
  private local = false;
  private server = false;
  /** The device that plays the sound (a member id), or null for every device (speaker.ts). */
  speaker: string | null = null;
  /** Rooms: the number of the room's current item (null: a host of an older build). */
  media: number | null = null;
  /** This device cannot play the current item (or closed its player). */
  private noMedia = false;
  /** What the play button shows: the group state, or this guest's play or pause until the host agrees. */
  private intent: PlayIntent;
  private hello: { name: string; have: string[]; extra: { memberId?: string; canHost?: boolean; maker?: boolean } } | null = null;

  constructor(
    private readonly deps: FollowerDeps,
    drift: DriftOptions = DEFAULT_DRIFT,
  ) {
    this.anchors = new AnchorFollower(
      {
        now: deps.now,
        remoteNow: () => this.hostNow(),
        timers: deps.timers,
        onSample: deps.onSample,
        onTrackMismatch: deps.onTrackMismatch,
        held: () => this.intent.holdsPause,
      },
      drift,
    );
    this.intent = new PlayIntent(deps.now);
  }

  /**
   * True: the group plays (or waits for a member to play); false: it is
   * paused; null before the first state. A play or pause that this guest
   * sent counts until the host's state agrees (`play-intent.ts`).
   */
  get wantsPlay(): boolean | null {
    return this.intent.value(this.groupPlays());
  }

  private groupPlays(): boolean | null {
    const a = this.anchors.current;
    return a ? a.playing || this.waiting : null;
  }

  /** A new group state: a sent control that it agrees with is done. */
  private noteGroup(): void {
    const g = this.groupPlays();
    if (g !== null) this.intent.group(g);
  }

  /** Sends hello and starts the clock sync. */
  start(name: string, have: string[], extra: { memberId?: string; canHost?: boolean; maker?: boolean } = {}): void {
    this.hello = { name, have, extra };
    this.deps.send({ t: 'hello', name, have, ...extra, deltas: true, rooms: true });
    for (let i = 0; i < BURST; i++) this.timers.push(this.deps.timers.setTimeout(() => this.ping(), i * BURST_GAP));
    this.schedulePing();
    this.timers.push(this.deps.timers.setInterval(() => this.anchors.follow(false), TICK));
  }

  /** The player is loaded and ready to follow. `local`: it plays its own copy. */
  private player: PlayerPort | null = null;

  /** `server`: the player streams from the item's Jellyfin server (the host counts who streams from it). */
  attach(player: PlayerPort, local: boolean, server = false): void {
    this.unsubBuffering?.();
    this.player = player;
    this.local = local;
    this.server = server;
    this.noMedia = false;
    this.unsubBuffering = player.onBuffering((b) => this.deps.send(this.bufferingMessage(b)));
    this.deps.send(this.bufferingMessage(player.isBuffering()));
    this.anchors.attach(player);
  }

  private bufferingMessage(buffering: boolean): Message {
    return {
      t: 'buffering',
      buffering,
      local: this.local,
      server: this.server,
      ...(this.media !== null ? { media: this.media } : {}),
      ...(this.noMedia ? { noMedia: true } : {}),
    };
  }

  /** Lets the player go (a new item loads, or the player closed). The group anchor stays. */
  detachPlayer(): void {
    this.unsubBuffering?.();
    this.unsubBuffering = null;
    this.player = null;
    this.anchors.detach();
  }

  /** This device cannot play the room's item, or closed its player: the group does not wait for it. */
  cannotPlay(): void {
    this.detachPlayer();
    this.noMedia = true;
    this.local = false;
    this.server = false;
    this.deps.send(this.bufferingMessage(false));
  }

  /** Rooms: asks the host to play something for everyone. False when only the host picks. */
  pick(p: PickRequest): boolean {
    if (this.onlyHostControls) {
      this.deps.onDenied?.(ONLY_HOST_PICKS_TEXT);
      return false;
    }
    this.deps.send({ t: 'pick', pick: p });
    return true;
  }

  get stats(): FollowerStats {
    return { clock: this.clock.estimate(), drift: this.anchors.lastDrift, corrections: { ...this.anchors.corrections } };
  }

  get groupAnchor(): Anchor | null {
    return this.anchors.current;
  }

  get groupTrack(): string | null {
    return this.anchors.currentTrack;
  }

  /** The offset to the host clock (host minus local, ms), or null. */
  get offset(): number | null {
    return this.clock.estimate()?.offset ?? null;
  }

  /**
   * The link to the host is back (the same host), or a new host took over.
   * Sends hello again on the new link. With a new host the clock starts
   * again: until the first pongs the player plays on as it is.
   */
  relink(send: (m: Message) => void, newHost: boolean, extra?: { canHost?: boolean }): void {
    this.deps.send = send;
    this.seq = -1;
    this.pending.clear();
    if (newHost) this.clock = new ClockSync();
    if (this.hello) this.deps.send({ t: 'hello', name: this.hello.name, have: this.hello.have, ...this.hello.extra, ...extra, deltas: true, rooms: true });
    // The player plays already: tell the host at once, so the group does not wait for this device.
    if (this.player) this.deps.send({ ...this.bufferingMessage(this.player.isBuffering()), ...(extra?.canHost !== undefined ? { canHost: extra.canHost } : {}) } as Message);
    for (let i = 0; i < BURST; i++) this.timers.push(this.deps.timers.setTimeout(() => this.ping(), i * BURST_GAP));
    this.jumped();
  }

  /** The player state now changes only with local controls (this device is the new host). Keeps the player. */
  release(): PlayerPort | null {
    const p = this.player;
    this.dispose();
    return p;
  }

  get isWaiting(): boolean {
    return this.waiting;
  }

  /** Host clock now, or null before the first pong. */
  hostNow(): number | null {
    const e = this.clock.estimate();
    return e ? this.deps.now() + e.offset : null;
  }

  receive(message: Message, receivedAt: number): void {
    switch (message.t) {
      case 'pong': {
        if (!this.pending.delete(message.id)) return;
        const before = this.converged() ? this.clock.estimate() : null;
        const m = this.clock.add({ t0: message.t0, t1: message.t1, t2: message.t2, t3: receivedAt });
        // The round trip jumped (another path, or a busy link): measure at the fast pace again.
        if (m && before && m.rtt > before.minRtt * 2 + 20) this.jumped();
        if (this.clock.count === 3) this.anchors.follow(true);
        this.deps.onChange?.();
        return;
      }
      case 'welcome':
        this.selfId = message.you ?? null;
        this.onlyHostControls = message.onlyHostControls;
        this.facts = {
          sessionId: message.sessionId,
          key: message.key ?? null,
          epoch: message.epoch ?? 0,
          hostId: message.hostId ?? null,
          kind: message.kind ?? 'video',
          selfId: this.selfId,
        };
        this.media = message.media ?? null;
        if (message.queue) {
          this.queue = message.queue;
          this.deps.onQueue?.(message.queue);
        }
        if (message.members) this.setMembers(message.members);
        // A host of an older build sends no speaker: every device plays the sound.
        this.setSpeaker(message.speaker ?? null, false);
        this.anchors.setAnchor(message.anchor, message.track ?? null);
        this.noteGroup();
        this.deps.onChange?.();
        return;
      case 'state':
        if (message.seq <= this.seq) return;
        this.seq = message.seq;
        this.waiting = message.waiting;
        this.anchors.setAnchor(message.anchor, message.track ?? (this.queue ? this.anchors.currentTrack : null));
        this.noteGroup();
        this.deps.onChange?.();
        return;
      case 'media':
        // Each item has a new number; an old or repeated message changes nothing.
        if (this.media !== null && message.media <= this.media) return;
        if (message.seq > this.seq) this.seq = message.seq;
        this.media = message.media;
        this.waiting = false;
        if (this.facts) this.facts = { ...this.facts, kind: message.kind };
        this.queue = message.queue ?? null;
        this.detachPlayer();
        this.anchors.setAnchor(message.anchor, message.track ?? null);
        this.intent.clear();
        this.deps.onMedia?.(message);
        this.deps.onChange?.();
        return;
      case 'queue':
        if (message.seq <= this.seq) return;
        this.seq = message.seq;
        this.queue = message.queue;
        this.deps.onQueue?.(message.queue);
        this.deps.onChange?.();
        return;
      case 'members':
        this.setMembers(message.members);
        this.onlyHostControls = message.onlyHostControls;
        this.deps.onChange?.();
        return;
      case 'memberDelta': {
        const gone = new Set(message.gone);
        const byId = new Map(this.allMembers.filter((m) => !gone.has(m.id)).map((m) => [m.id, m] as const));
        for (const m of message.upsert) byId.set(m.id, m);
        this.setMembers([...byId.values()]);
        this.onlyHostControls = message.onlyHostControls;
        this.deps.onChange?.();
        return;
      }
      case 'speaker':
        this.setSpeaker(message.target, !!message.fallback);
        this.deps.onChange?.();
        return;
      case 'denied':
        this.deps.onDenied?.(message.reason);
        return;
      default:
        return;
    }
  }

  private setSpeaker(target: string | null, fallback: boolean): void {
    if (target === this.speaker) return;
    this.speaker = target;
    this.deps.onSpeaker?.(target, fallback);
  }

  private setMembers(list: Member[]): void {
    this.allMembers = list;
    this.members = list.filter((m) => m.id !== this.selfId);
  }

  /** A control from this guest's own player UI. False when the host does not allow it. */
  request(c: ControlAction): boolean {
    if (this.onlyHostControls) {
      this.deps.onDenied?.('Only the host controls playback.');
      return false;
    }
    if (c.action === 'play' || c.action === 'pause') this.intent.sent(c.action === 'play');
    this.deps.send({ t: 'control', ...c });
    // A pause holds the player at once; the host's state confirms it a round trip later.
    if (c.action === 'pause') this.anchors.follow(false);
    this.deps.onChange?.();
    return true;
  }

  leave(): void {
    this.deps.send({ t: 'leave' });
    this.dispose();
  }

  dispose(): void {
    for (const t of this.timers) {
      this.deps.timers.clearTimeout(t);
      this.deps.timers.clearInterval(t);
    }
    this.timers = [];
    if (this.pingTimer !== null) this.deps.timers.clearTimeout(this.pingTimer);
    this.pingTimer = null;
    this.anchors.detach();
    this.unsubBuffering?.();
    this.unsubBuffering = null;
  }

  /** The clock has enough quiet samples that agree: ping at the slow pace. */
  private converged(): boolean {
    const e = this.clock.estimate();
    return !!e && e.samples >= 12 && e.used >= 6 && e.spread < 5;
  }

  /** The time to the next ping, ms. */
  get pingEvery(): number {
    return this.fastLeft > 0 || !this.converged() ? PING_FAST : PING_SLOW;
  }

  private schedulePing(): void {
    if (this.pingTimer !== null) this.deps.timers.clearTimeout(this.pingTimer);
    this.pingTimer = this.deps.timers.setTimeout(() => {
      this.pingTimer = null;
      this.ping();
      if (this.fastLeft > 0) this.fastLeft -= 1;
      this.schedulePing();
    }, this.pingEvery);
  }

  /** A relink or a round trip jump: the next pings go at the fast pace. */
  private jumped(): void {
    const slow = this.pingEvery === PING_SLOW;
    this.fastLeft = FAST_AFTER_JUMP;
    if (slow || this.pingTimer === null) this.schedulePing();
  }

  private ping(): void {
    const id = ++this.pingId;
    this.pending.add(id);
    if (this.pending.size > 32) this.pending.delete(this.pending.values().next().value as number);
    this.deps.send({ t: 'ping', id, t0: this.deps.now() });
  }
}
