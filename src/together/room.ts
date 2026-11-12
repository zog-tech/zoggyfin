/**
 * The host side of a nearby session. The host is the clock and the only
 * authority: guests send requests, the host decides, changes its own player
 * and sends the new group state to everyone.
 *
 * A play starts `startLead` ms in the future, so every device can start at
 * the same moment. While any member buffers, the group waits (the host
 * pauses) and plays again when everyone is ready. A member that joins or
 * comes back while the group plays catches up instead: the group does not
 * wait for it.
 *
 * A room: the session does not depend on one item. The room can have no
 * item (`setMedia(null)`), and the host can play another item at any time
 * (`setMedia`): every guest that understands rooms gets a `media` message,
 * loads the item, and the group starts when everyone is ready (or after
 * `LOAD_LIMIT`). A guest of an older build gets a clear `removed` instead.
 *
 * Members: a guest that sent `deltas` gets the whole list in its welcome,
 * then only the changes (`memberDelta`), at most one in `MEMBERS_EVERY` ms.
 * An older guest gets the whole list, at the same pace. Buffering is not
 * part of the list that goes out (it changes often, and only the host needs it).
 *
 * "Sound plays on" (speaker.ts): the room keeps the host's choice and sends
 * the device that plays the sound now with each change (`speaker`).
 */
import { positionAt } from './drift';
import type { Anchor, ControlAction, MediaKind, Member, Message, PickRequest, SharedItem, SharedQueue, StreamRef } from './protocol';
import type { PlayerPort, Timers } from './player-port';
import { ONLY_HOST_PICKS_TEXT } from './room-route';
import { keepChoice, soundDevice, type SpeakerChoice, validChoice } from './speaker';

/** The queue actions of an audio session. */
export type QueueAction = Extract<ControlAction, { action: 'next' | 'previous' | 'jump' | 'shuffle' | 'repeat' }>;

/** The host's audio queue, for an audio session (`audio-binding.ts`). */
export interface RoomQueue {
  snapshot(): SharedQueue;
  /** The key of the current queue entry. */
  track(): string | null;
  /** The player moved to another entry (the end of a track, or a queue action). */
  onTrack(listener: (key: string) => void): () => void;
  /** The order, the entries or the play modes changed. */
  onQueue(listener: () => void): () => void;
  /** `playing`: the group plays, so a new track starts; else it loads paused. */
  apply(c: QueueAction, playing: boolean): void;
}

export function isQueueAction(c: ControlAction): c is QueueAction {
  return c.action === 'next' || c.action === 'previous' || c.action === 'jump' || c.action === 'shuffle' || c.action === 'repeat';
}

/** A member that is away is removed after this long, ms. */
export const AWAY_LIMIT = 120_000;

/** Member changes within this long go out as one message, ms. */
export const MEMBERS_EVERY = 250;

/** After a new item, the group waits at most this long for a member that loads, ms. */
export const LOAD_LIMIT = 20_000;

/** What an older guest reads when it cannot follow the room. */
export const UPDATE_TEXT = {
  empty: 'This session has nothing playing yet. Update Zoggyfin to join it.',
  changed: 'The host picked something new. Update Zoggyfin to follow the session.',
} as const;

/** The text for a guest's pick when only the host picks. */
export const ONLY_HOST_PICKS = ONLY_HOST_PICKS_TEXT;

/** The media of the room: the item, how guests read it, the audio queue, and the host's player for it. */
export interface RoomMedia {
  kind: MediaKind;
  item: SharedItem;
  stream: StreamRef | null;
  queue?: RoomQueue;
  player: PlayerPort;
}

/** The player of a room with no item: it stays at 0 and paused. */
export const IDLE_PORT: PlayerPort = {
  position: () => 0,
  isPlaying: () => false,
  isBuffering: () => false,
  play: () => undefined,
  pause: () => undefined,
  seek: () => undefined,
  setRate: () => undefined,
  onBuffering: () => () => undefined,
};

export interface RoomDeps {
  send(message: Message, to?: string[]): void;
  /** Host monotonic clock, ms. */
  now(): number;
  player: PlayerPort;
  timers: Timers;
  /** Called after every change of members, policy or state (for the UI). */
  onChange?(): void;
  /** A guest asked for something it may not do. */
  onDenied?(peerId: string): void;
  /** Answers a ping with `t2` stamped as late as it can be (link.ts `sendPong`). Unset: `send` with `now()`. */
  pong?(peerId: string, id: number, t0: number, t1: number): void;
  /** A guest picked something for everyone (the host allows it). `memberId` and `name` are the guest's. */
  onPick?(memberId: string, name: string, pick: PickRequest): void;
  /** Close this socket (a guest that the room removed). */
  drop?(peerId: string): void;
  /** The sound device changed (`fallback`: the chosen device left, the host plays the sound now). */
  onSpeaker?(target: SpeakerChoice, fallback: boolean): void;
}

/** A member as the room keeps it: the public facts and the socket it uses now. */
interface RoomMember extends Member {
  peerId: string | null;
  awayTimer: unknown;
  /** A member that joined or came back while the group plays: it catches up, the group does not wait for it. */
  catchingUp?: boolean;
  /** The guest takes `memberDelta` (else full `members` lists). */
  deltas?: boolean;
  /** The guest understands rooms (`media`, `pick`, a welcome with no item). */
  rooms?: boolean;
  /** The member loads this item number: a buffering report for an older item does not count. */
  loading?: number;
}

export interface RoomOptions {
  sessionId: string;
  /** Null: the room starts with no item (`deps.player` is then not used). */
  item: SharedItem | null;
  /** The host's stream, or null. */
  stream: StreamRef | null;
  onlyHostControls: boolean;
  startLead?: number;
  heartbeatMs?: number;
  kind?: MediaKind;
  /** Audio: the host's queue. */
  queue?: RoomQueue;
  /** The session key that members use to come back (link.ts). */
  key?: string;
  epoch?: number;
  /** The host's own member id. */
  hostId?: string;
  /** A new host: the anchor to start from (from its own player), and the members it takes over (all away until they come back). */
  anchor?: Anchor;
  members?: Member[];
  /** A new host: the item number of the room so far (it goes on from there). */
  media?: number;
  /** A new host: the sound device of the session so far (speaker.ts). */
  speaker?: SpeakerChoice;
}

export class HostRoom {
  private anchor: Anchor;
  private seq = 0;
  /** The group wants to play; it may still wait for a member that buffers. */
  private wantPlaying: boolean;
  private waiting = false;
  /** By member id. */
  private readonly members = new Map<string, RoomMember>();
  private readonly peerToMember = new Map<string, string>();
  private unsubQueue: (() => void)[] = [];
  private player: PlayerPort;
  /** The number of the current item; it grows with each `setMedia`. */
  private mediaSeq: number;
  private loadTimer: unknown = null;
  /** The members as the guests know them (the last list or delta that went out), by id. */
  private sentMembers = new Map<string, string>();
  private sentOnlyHostControls: boolean | null = null;
  private membersTimer: unknown = null;
  kind: MediaKind;
  readonly key: string | null;
  readonly epoch: number;
  readonly hostId: string | null;
  private queue: RoomQueue | null;
  private hostBuffering = false;
  private startTimer: unknown = null;
  private heartbeat: unknown = null;
  private unsubBuffering: () => void = () => undefined;
  onlyHostControls: boolean;
  readonly sessionId: string;
  item: SharedItem | null;
  private stream: StreamRef | null;
  private readonly startLead: number;
  /** "Sound plays on": the host's choice, and the sound device that the guests know now. */
  private speakerChoice: SpeakerChoice = null;
  private speakerSent: SpeakerChoice = null;

  constructor(
    private readonly deps: RoomDeps,
    opts: RoomOptions,
  ) {
    this.sessionId = opts.sessionId;
    this.item = opts.item;
    this.stream = opts.stream;
    this.onlyHostControls = opts.onlyHostControls;
    this.startLead = opts.startLead ?? 300;
    this.kind = opts.kind ?? 'video';
    this.queue = opts.queue ?? null;
    this.key = opts.key ?? null;
    this.epoch = opts.epoch ?? 0;
    this.hostId = opts.hostId ?? null;
    this.mediaSeq = opts.media ?? 0;
    const p = opts.item ? deps.player : IDLE_PORT;
    this.player = p;
    this.wantPlaying = opts.anchor ? opts.anchor.playing : p.isPlaying();
    this.anchor = opts.anchor ?? { playing: p.isPlaying(), rate: 1, hostTime: deps.now(), position: p.position() };
    for (const m of opts.members ?? []) {
      this.members.set(m.id, { ...m, buffering: false, away: true, peerId: null, awayTimer: deps.timers.setTimeout(() => this.forget(m.id), AWAY_LIMIT) });
    }
    if (!opts.item) this.queue = null;
    this.speakerChoice = keepChoice(opts.speaker ?? null, this.memberList, this.hostId);
    this.speakerSent = soundDevice(this.speakerChoice, this.memberList, this.hostId);
    this.listen();
    this.heartbeat = deps.timers.setInterval(() => this.beat(), opts.heartbeatMs ?? 2000);
  }

  /** Listens to the player's buffering and the queue of the current item. */
  private listen(): void {
    this.unsubBuffering();
    this.unsubQueue.forEach((u) => u());
    this.unsubQueue = [];
    if (this.queue) {
      const q = this.queue;
      this.unsubQueue = [q.onTrack(() => this.trackChanged()), q.onQueue(() => this.broadcastQueue())];
    }
    this.hostBuffering = this.player.isBuffering();
    this.unsubBuffering = this.player.onBuffering((b) => {
      this.hostBuffering = b;
      this.updateWaiting();
    });
  }

  /** The number of the current item. */
  get media(): number {
    return this.mediaSeq;
  }

  /** True while the room has an item. */
  get hasMedia(): boolean {
    return this.item !== null;
  }

  /**
   * The host plays another item (or none: `media` null). Every guest that
   * understands rooms gets it; a guest of an older build is removed with a
   * reason (returned: its sockets, which the room already told).
   *
   * `keep`: the player plays already (a room that starts with what plays
   * now): the group takes its play state. Else the group starts the new item
   * together once every member has loaded it (or after `LOAD_LIMIT`).
   * `by`: the member id of a guest that picked it.
   */
  setMedia(media: RoomMedia | null, opts: { keep?: boolean; by?: string } = {}): string[] {
    this.cancelStart();
    this.clearLoadTimer();
    this.mediaSeq += 1;
    this.item = media?.item ?? null;
    this.stream = media?.stream ?? null;
    this.queue = media?.queue ?? null;
    if (media) this.kind = media.kind;
    this.player = media?.player ?? IDLE_PORT;
    this.listen();
    // An older guest cannot load another item: tell it why, and let it go.
    const dropped: string[] = [];
    for (const m of [...this.members.values()]) {
      if (m.rooms || !m.peerId) continue;
      this.deps.send({ t: 'removed', reason: UPDATE_TEXT.changed }, [m.peerId]);
      dropped.push(m.peerId);
      this.forget(m.id);
    }
    const loads = !!media && !opts.keep;
    for (const [id, { noMedia: _n, ...m }] of this.members) {
      this.members.set(id, { ...m, buffering: loads && !m.away, catchingUp: false, loading: loads ? this.mediaSeq : undefined });
    }
    const p = this.player;
    const now = this.deps.now();
    const playing = !!media && !!opts.keep && p.isPlaying();
    this.wantPlaying = playing;
    this.waiting = false;
    this.anchor = { playing, rate: this.anchor.rate > 0 ? this.anchor.rate : 1, hostTime: now, position: media ? p.position() : 0 };
    this.seq += 1;
    const track = this.queue?.track() ?? undefined;
    const message: Message = {
      t: 'media',
      seq: this.seq,
      media: this.mediaSeq,
      kind: this.kind,
      item: this.item,
      stream: this.stream,
      anchor: this.anchor,
      ...(this.queue ? { queue: this.queue.snapshot() } : {}),
      ...(track ? { track } : {}),
      ...(opts.by ? { by: opts.by } : {}),
    };
    if (this.peers.length) this.deps.send(message, this.peers);
    for (const peer of dropped) this.deps.drop?.(peer);
    this.broadcastMembers();
    if (loads) {
      this.loadTimer = this.deps.timers.setTimeout(() => this.loadTimedOut(), LOAD_LIMIT);
      this.apply({ action: 'play' });
    } else {
      this.deps.onChange?.();
    }
    return dropped;
  }

  /** The rate of the group (a new item keeps it, as the players do). */
  setGroupRate(rate: number): void {
    if (rate > 0) this.anchor = { ...this.anchor, rate };
  }

  /**
   * The host's player loads something new: the group pauses where it is
   * until `setMedia` brings the new item. The old player is let go.
   */
  suspend(): void {
    if (this.player === IDLE_PORT) return;
    const position = this.currentAnchor().position;
    this.cancelStart();
    this.clearLoadTimer();
    this.player = IDLE_PORT;
    this.queue = null;
    this.listen();
    this.waiting = false;
    this.anchor = { ...this.anchor, playing: false, hostTime: this.deps.now(), position };
    this.broadcastState();
  }

  /** The members that still load the new item stop holding the group: they catch up. */
  private loadTimedOut(): void {
    this.loadTimer = null;
    for (const [id, m] of this.members) {
      if (m.loading === this.mediaSeq && m.buffering) this.members.set(id, { ...m, catchingUp: true });
    }
    this.updateWaiting();
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) this.deps.timers.clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  /** Every member, with its buffering state (for the host's own UI). */
  get memberList(): Member[] {
    return [...this.members.values()].map(({ peerId: _p, awayTimer: _t, catchingUp: _c, deltas: _d, rooms: _r, loading: _l, ...m }) => m);
  }

  /** The members as they go to the guests: no buffering. */
  private get wireMembers(): Member[] {
    return this.memberList.map(({ buffering: _b, ...m }) => m);
  }

  /** The socket of a member, or null. */
  peerOf(memberId: string): string | null {
    return this.members.get(memberId)?.peerId ?? null;
  }

  /** The member id of a socket, or null. */
  memberOf(peerId: string): string | null {
    return this.peerToMember.get(peerId) ?? null;
  }

  get state(): { anchor: Anchor; waiting: boolean; wantPlaying: boolean } {
    return { anchor: this.anchor, waiting: this.waiting, wantPlaying: this.wantPlaying };
  }

  /** A message from a connected guest. `receivedAt` is the host clock when it arrived. */
  receive(peerId: string, message: Message, receivedAt: number): void {
    switch (message.t) {
      case 'ping':
        if (this.deps.pong) this.deps.pong(peerId, message.id, message.t0, receivedAt);
        else this.deps.send({ t: 'pong', id: message.id, t0: message.t0, t1: receivedAt, t2: this.deps.now() }, [peerId]);
        return;
      case 'hello': {
        if (!this.item && !message.rooms) {
          // An older build cannot wait in a room with no item.
          this.deps.send({ t: 'removed', reason: UPDATE_TEXT.empty }, [peerId]);
          this.deps.drop?.(peerId);
          return;
        }
        const local = !!this.item && message.have.includes(this.item.id);
        const id = message.memberId || peerId;
        const old = this.members.get(id);
        if (old) {
          this.deps.timers.clearTimeout(old.awayTimer);
          if (old.peerId && old.peerId !== peerId) this.peerToMember.delete(old.peerId);
        }
        // A member that comes back keeps its place (and its join time) for the host election.
        this.members.set(id, {
          id,
          name: message.name || 'Guest',
          local,
          // With no item there is nothing to load.
          buffering: !!this.item,
          joinedAt: old?.joinedAt ?? this.deps.now(),
          canHost: message.canHost ?? false,
          maker: message.maker ?? false,
          away: false,
          peerId,
          awayTimer: null,
          // Nobody pauses for a member that joins or comes back while the group plays: it catches up.
          catchingUp: this.wantPlaying,
          deltas: message.deltas ?? false,
          rooms: message.rooms ?? false,
          loading: this.item ? this.mediaSeq : undefined,
        });
        this.peerToMember.set(peerId, id);
        this.deps.send(
          {
            t: 'welcome',
            sessionId: this.sessionId,
            item: this.item,
            stream: this.stream,
            onlyHostControls: this.onlyHostControls,
            anchor: this.currentAnchor(),
            you: id,
            kind: this.kind,
            ...(this.queue ? { queue: this.queue.snapshot(), track: this.queue.track() ?? undefined } : {}),
            ...(this.key ? { key: this.key } : {}),
            epoch: this.epoch,
            ...(this.hostId ? { hostId: this.hostId } : {}),
            ...(message.deltas ? { members: this.wireMembers } : {}),
            ...(message.rooms ? { media: this.mediaSeq } : {}),
            ...(this.speakerNow !== null ? { speaker: this.speakerNow } : {}),
          },
          [peerId],
        );
        this.broadcastMembers();
        // A new member loads the media. A paused group waits for it on the next play; a playing group goes on.
        this.updateWaiting();
        return;
      }
      case 'control':
        if (!this.peerToMember.has(peerId)) return;
        if (this.onlyHostControls) {
          this.deps.send({ t: 'denied', reason: 'Only the host controls playback.' }, [peerId]);
          this.deps.onDenied?.(peerId);
          return;
        }
        if (!this.item) return;
        this.apply(message);
        return;
      case 'pick': {
        const id = this.peerToMember.get(peerId);
        const m = id ? this.members.get(id) : undefined;
        if (!id || !m) return;
        if (this.onlyHostControls) {
          this.deps.send({ t: 'denied', reason: ONLY_HOST_PICKS }, [peerId]);
          this.deps.onDenied?.(peerId);
          return;
        }
        this.deps.onPick?.(id, m.name, message.pick);
        return;
      }
      case 'buffering': {
        const id = this.peerToMember.get(peerId);
        const m = id ? this.members.get(id) : undefined;
        if (!id || !m) return;
        // A report for an item before the current one (the guest had not loaded the new one yet).
        if (message.media !== undefined && message.media < this.mediaSeq) return;
        const { noMedia: _n, ...rest } = m;
        this.members.set(id, {
          ...rest,
          buffering: message.buffering && !message.noMedia,
          local: message.local,
          server: message.server ?? m.server,
          canHost: message.canHost ?? m.canHost,
          catchingUp: message.buffering ? m.catchingUp : false,
          ...(message.noMedia ? { noMedia: true } : {}),
          loading: message.buffering ? m.loading : undefined,
        });
        this.broadcastMembers();
        this.updateWaiting();
        return;
      }
      case 'leave': {
        const id = this.peerToMember.get(peerId);
        this.peerToMember.delete(peerId);
        if (id) this.forget(id);
        return;
      }
      default:
        return;
    }
  }

  /**
   * The link to a guest closed. The member stays in the list as away (the
   * group does not wait for it) and can come back with the session key.
   * After `AWAY_LIMIT` it is removed.
   */
  removeMember(peerId: string): void {
    const id = this.peerToMember.get(peerId);
    this.peerToMember.delete(peerId);
    const m = id ? this.members.get(id) : undefined;
    if (!id || !m || m.peerId !== peerId) return;
    this.members.set(id, { ...m, away: true, buffering: false, peerId: null, awayTimer: this.deps.timers.setTimeout(() => this.forget(id), AWAY_LIMIT) });
    this.broadcastMembers();
    this.updateWaiting();
  }

  /**
   * The host removes a member: it is told why, it leaves the list at once
   * and keeps no place. Returns the peer id of its socket (to close), or null.
   */
  expel(memberId: string, reason: string): string | null {
    const m = this.members.get(memberId);
    if (!m) return null;
    const peer = m.peerId;
    if (peer) this.deps.send({ t: 'removed', reason }, [peer]);
    this.forget(memberId);
    return peer;
  }

  private forget(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    this.deps.timers.clearTimeout(m.awayTimer);
    if (m.peerId) this.peerToMember.delete(m.peerId);
    this.members.delete(id);
    this.broadcastMembers();
    this.updateWaiting();
  }

  /** The sockets of the members that are connected now. */
  private get peers(): string[] {
    return [...this.members.values()].map((m) => m.peerId).filter((p): p is string => p !== null);
  }

  /** A control from the host's own player. */
  apply(c: ControlAction): void {
    if (!this.item) return;
    const p = this.player;
    const now = this.deps.now();
    if (isQueueAction(c)) {
      const q = this.queue;
      if (!q) return;
      // The queue changes the player; the track and queue listeners tell the group.
      const before = q.track();
      q.apply(c, this.wantPlaying);
      // "Previous" late in a track (or on the first track) goes back to its start: a seek for the group.
      if (c.action === 'previous' && q.track() === before) this.apply({ action: 'seek', position: 0 });
      return;
    }
    switch (c.action) {
      case 'play':
        // The group plays already: a second play (a double tap, a late
        // report) only repeats the state. A new start would pause every
        // player for the start lead, then play on.
        if (c.position === undefined && this.wantPlaying && !this.waiting && (this.startTimer !== null || (this.anchor.playing && p.isPlaying()))) {
          if (this.startTimer === null) this.anchor = this.currentAnchor();
          this.broadcastState();
          return;
        }
        this.wantPlaying = true;
        if (c.position !== undefined) p.seek(c.position);
        if (this.blocked()) {
          this.waiting = true;
          this.anchor = { ...this.anchor, playing: false, hostTime: now, position: c.position ?? p.position() };
          this.broadcastState();
          return;
        }
        this.scheduleStart(c.position ?? p.position());
        return;
      case 'pause': {
        this.wantPlaying = false;
        this.cancelStart();
        p.pause();
        const position = c.position ?? p.position();
        if (c.position !== undefined) p.seek(position);
        this.anchor = { ...this.anchor, playing: false, hostTime: now, position };
        this.waiting = false;
        this.broadcastState();
        return;
      }
      case 'seek': {
        const playing = this.anchor.playing || this.startTimer !== null;
        this.cancelStart();
        p.seek(c.position);
        if (playing && !this.blocked()) {
          this.scheduleStart(c.position);
          return;
        }
        this.anchor = { ...this.anchor, playing: false, hostTime: now, position: c.position };
        this.broadcastState();
        return;
      }
      case 'rate': {
        const position = this.currentAnchor().position;
        p.setRate(c.rate);
        this.anchor = { ...this.anchor, rate: c.rate, hostTime: now, position };
        this.broadcastState();
        return;
      }
    }
  }

  /** The sound device now (null: every device). */
  get speaker(): { choice: SpeakerChoice; target: SpeakerChoice } {
    return { choice: this.speakerChoice, target: this.speakerSent };
  }

  /** The sound device for the current members (it can differ from the one sent until `updateSpeaker` runs). */
  private get speakerNow(): SpeakerChoice {
    return soundDevice(this.speakerChoice, this.memberList, this.hostId);
  }

  /** The host picks where the sound plays: null (every device), its own id, or a member that is here. False: not a valid choice. */
  setSpeaker(choice: SpeakerChoice): boolean {
    if (!validChoice(choice, this.memberList, this.hostId)) return false;
    this.speakerChoice = choice;
    this.updateSpeaker(false);
    this.deps.onChange?.();
    return true;
  }

  /**
   * Sends the sound device when it changed. A chosen member that left gives
   * way to the host (`fallback` unless the host chose it). Called after each
   * member change.
   */
  private updateSpeaker(memberChange = true): void {
    const before = this.speakerChoice;
    this.speakerChoice = keepChoice(before, this.memberList, this.hostId);
    const target = this.speakerNow;
    if (target === this.speakerSent) return;
    this.speakerSent = target;
    const fallback = memberChange && before !== null && before !== this.hostId && target === this.hostId;
    if (this.peers.length) this.deps.send({ t: 'speaker', target, ...(fallback ? { fallback: true } : {}) }, this.peers);
    this.deps.onSpeaker?.(target, fallback);
  }

  setOnlyHostControls(value: boolean): void {
    this.onlyHostControls = value;
    this.broadcastMembers();
  }

  /** Ends the session for everyone. */
  end(): void {
    this.deps.send({ t: 'end' });
    this.dispose();
  }

  dispose(): void {
    this.cancelStart();
    this.clearLoadTimer();
    if (this.membersTimer !== null) this.deps.timers.clearTimeout(this.membersTimer);
    this.membersTimer = null;
    this.deps.timers.clearInterval(this.heartbeat);
    this.unsubBuffering();
    this.unsubQueue.forEach((u) => u());
    this.unsubQueue = [];
    for (const m of this.members.values()) this.deps.timers.clearTimeout(m.awayTimer);
  }

  /** Members that are away, or that came back and catch up, do not hold the group. */
  private blocked(): boolean {
    return this.hostBuffering || [...this.members.values()].some((m) => m.buffering && !m.away && !m.catchingUp);
  }

  /** Audio: the host's player moved to another queue entry. The new track starts at 0 now. */
  private trackChanged(): void {
    if (this.startTimer !== null) {
      // A planned start was for the track before: plan it again at the start of this one.
      this.scheduleStart(0);
      return;
    }
    this.anchor = { ...this.anchor, hostTime: this.deps.now(), position: 0 };
    this.broadcastState();
  }

  private broadcastQueue(): void {
    if (!this.queue) return;
    this.seq += 1;
    const by = this.queueBy;
    this.queueBy = null;
    if (this.peers.length) this.deps.send({ t: 'queue', seq: this.seq, queue: this.queue.snapshot(), ...(by ? { by } : {}) }, this.peers);
    this.deps.onChange?.();
  }

  /** The guest that picked the next queue change (for its note on the other guests). */
  private queueBy: string | null = null;

  /** A guest picked a new queue for the audio item that plays: the next queue message names it. */
  markQueuePick(memberId: string): void {
    this.queueBy = memberId;
  }

  private scheduleStart(position: number): void {
    const p = this.player;
    const at = this.deps.now() + this.startLead;
    this.waiting = false;
    p.pause();
    p.seek(position);
    this.anchor = { ...this.anchor, playing: true, hostTime: at, position };
    this.broadcastState();
    this.cancelStart();
    this.startTimer = this.deps.timers.setTimeout(() => {
      this.startTimer = null;
      p.play();
    }, this.startLead);
  }

  private cancelStart(): void {
    if (this.startTimer !== null) this.deps.timers.clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private updateWaiting(): void {
    const blocked = this.blocked();
    if (blocked && this.wantPlaying && !this.waiting) {
      // Everyone waits for the member that buffers.
      this.cancelStart();
      const p = this.player;
      p.pause();
      this.waiting = true;
      this.anchor = { ...this.anchor, playing: false, hostTime: this.deps.now(), position: p.position() };
      this.broadcastState();
    } else if (!blocked && this.waiting) {
      this.waiting = false;
      if (this.wantPlaying) this.scheduleStart(this.anchor.position);
      else this.broadcastState();
    } else {
      this.deps.onChange?.();
    }
  }

  /** The anchor at the host player's real position (it can drift from the plan). */
  private currentAnchor(): Anchor {
    const now = this.deps.now();
    if (this.anchor.playing && now >= this.anchor.hostTime && this.player.isPlaying()) {
      return { ...this.anchor, hostTime: now, position: this.player.position() };
    }
    return this.anchor.playing && now >= this.anchor.hostTime ? { ...this.anchor, hostTime: now, position: positionAt(this.anchor, now) } : this.anchor;
  }

  /** Re-anchors to the host player and repeats the state, so late or lost messages heal. */
  private beat(): void {
    if (this.startTimer !== null || !this.item) return;
    this.anchor = this.currentAnchor();
    if (this.peers.length) this.broadcastState();
  }

  private broadcastState(): void {
    this.seq += 1;
    const track = this.queue?.track() ?? undefined;
    if (this.peers.length) this.deps.send({ t: 'state', seq: this.seq, anchor: this.anchor, waiting: this.waiting, ...(track ? { track } : {}) }, this.peers);
    this.deps.onChange?.();
  }

  /** A member changed: the guests hear of it with the other changes of the next `MEMBERS_EVERY` ms. */
  private broadcastMembers(): void {
    this.updateSpeaker();
    if (this.membersTimer === null) {
      this.membersTimer = this.deps.timers.setTimeout(() => {
        this.membersTimer = null;
        this.flushMembers();
      }, MEMBERS_EVERY);
    }
    this.deps.onChange?.();
  }

  /** Sends what changed since the last list or delta: a delta to the guests that take one, the whole list to the others. */
  private flushMembers(): void {
    const wire = this.wireMembers;
    const now = new Map(wire.map((m) => [m.id, JSON.stringify(m)] as const));
    const upsert = wire.filter((m) => this.sentMembers.get(m.id) !== now.get(m.id));
    const gone = [...this.sentMembers.keys()].filter((id) => !now.has(id));
    const flag = this.sentOnlyHostControls !== this.onlyHostControls;
    this.sentMembers = now;
    this.sentOnlyHostControls = this.onlyHostControls;
    if (!upsert.length && !gone.length && !flag) return;
    const connected = [...this.members.values()].filter((m) => m.peerId !== null);
    const delta = connected.filter((m) => m.deltas).map((m) => m.peerId!);
    const full = connected.filter((m) => !m.deltas).map((m) => m.peerId!);
    if (delta.length) this.deps.send({ t: 'memberDelta', upsert, gone, onlyHostControls: this.onlyHostControls }, delta);
    // An older guest needs `buffering` in each member.
    if (full.length) this.deps.send({ t: 'members', members: wire.map((m) => ({ ...m, buffering: false })), onlyHostControls: this.onlyHostControls }, full);
  }
}
