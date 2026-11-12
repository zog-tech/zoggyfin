/**
 * The nearby "Watch together" wire protocol. Every message is one JSON object
 * with a version field `v`. A receiver drops a message with an unknown
 * version or a bad shape; it never throws.
 *
 * Times are milliseconds on the sender's monotonic clock unless the field
 * name says "host": the host is the clock of the session.
 * Positions are seconds in the media.
 */

export const PROTOCOL_VERSION = 1;
// Version 1 also covers the fields and messages that came with audio queues,
// reconnects and the host election: they are optional, and an older receiver
// ignores them. The transport changed from Multipeer to TCP (link.ts), so a
// build with Multipeer does not see a build with TCP at all.
//
// Rooms (also version 1): a session no longer depends on one item. A guest
// that sends `hello.rooms` can get a welcome with no item (`item: null`) and
// `media` messages when the host plays something else; it can send `pick`.
// A guest with no `rooms` (an older build) joins only a room that has an
// item, and the host removes it, with a reason, when the item changes.
//
// "Sound plays on" (also version 1): `welcome.speaker` and the `speaker`
// message name the one device that plays the sound (speaker.ts). An older
// guest drops the unknown message and ignores the field: it keeps its sound.

export type MediaKind = 'video' | 'audio';

/** The slim item facts a guest needs to show and match the item. */
export interface SharedItem {
  id: string;
  /** The Jellyfin server of the host's download, when known. */
  serverId?: string | null;
  name: string;
  type: string;
  seriesName?: string | null;
  runTimeTicks?: number | null;
  mediaSourceId?: string | null;
  /** File extension of the host's file ("mp4"), for the stream URL. */
  container?: string | null;
  /** Audio: the album and the artists line. */
  album?: string | null;
  artist?: string | null;
  /** The URL path of the host's file on the session port ("/<token>/3.m4a"), or null when the host has no file. */
  path?: string | null;
  /** The URL path of the cover image on the session port, or null. */
  art?: string | null;
}

/** One entry of a shared audio queue. `key` is the host's queue entry key. */
export interface SharedEntry {
  key: string;
  item: SharedItem;
}

/** The host's audio queue: the order, the current entry and the play modes. */
export interface SharedQueue {
  entries: SharedEntry[];
  index: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** Long-form audio (audiobooks, recitations): speed and skip controls. */
  longForm: boolean;
}

/** At most this many queue entries go to the guests (around the current entry). */
export const MAX_SHARED_ENTRIES = 300;

/**
 * The playback state of the group. The expected position at host time T is
 * `position + (playing ? (T - hostTime) / 1000 * rate : 0)`.
 */
export interface Anchor {
  playing: boolean;
  rate: number;
  /** Host monotonic time of the anchor, ms. */
  hostTime: number;
  /** Media position at `hostTime`, seconds. */
  position: number;
}

/** Where a guest reads the host's file: a Bonjour service and a URL path on it. */
export interface StreamRef {
  service: string;
  path: string;
}

export interface Member {
  id: string;
  name: string;
  /** The member plays its own downloaded copy (else it streams from the host). */
  local: boolean;
  /**
   * The member loads or stalls. Only the host knows it: the members that go
   * to the guests leave it out (a list for an older guest says false).
   */
  buffering?: boolean;
  /** Host clock (ms) of the first join, for the host election (earliest first). */
  joinedAt?: number;
  /** The member has all the media of the session (its own downloads): it can become the host. */
  canHost?: boolean;
  /** The link to the member is lost; it can come back with the session key. */
  away?: boolean;
  /** The member can make a Wi-Fi network (an Android local-only hotspot). */
  maker?: boolean;
  /** The member streams from the item's Jellyfin server (not from the host). */
  server?: boolean;
  /** The member cannot play the current item (no copy, no server, no host file), or closed its player. */
  noMedia?: boolean;
}

/** An item that a guest picks, as slim as the host needs to play it. */
export interface PickItem {
  id: string;
  name: string;
  type: string;
  serverId?: string | null;
  mediaType?: string | null;
}

/** A guest's pick: the same facts as a play request on the guest (see `PlayRequest`). */
export interface PickRequest {
  item: PickItem;
  /** Video: the items after it (next episodes). */
  queue?: PickItem[];
  /** Audio: the whole list, with `index` at `item`. */
  list?: PickItem[];
  index?: number;
  /** Audio: the album or playlist of the list. */
  context?: PickItem;
  shuffle?: boolean;
  /** Ticks; left out: from the saved position. */
  start?: number;
}

/** At most this many items in a pick's list or queue. */
export const MAX_PICK_ITEMS = 300;

export type ControlAction =
  | { action: 'play'; position?: number }
  | { action: 'pause'; position?: number }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number }
  // Audio queues only.
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'jump'; key: string }
  | { action: 'shuffle'; on: boolean }
  | { action: 'repeat'; mode: 'off' | 'all' | 'one' };

export type Message =
  /** Guest to host, right after the link opens. */
  | {
      t: 'hello';
      name: string;
      have: string[];
      /** A stable id of the guest for this session (it keeps it when it reconnects). */
      memberId?: string;
      /** The guest has all the media of the session. */
      canHost?: boolean;
      /** The guest can make a Wi-Fi network (Android). */
      maker?: boolean;
      /** The guest understands `memberDelta` and `welcome.members` (else it gets full `members` lists). */
      deltas?: boolean;
      /** The guest understands rooms: a welcome with no item, `media` and `pick`. */
      rooms?: boolean;
    }
  /** Host to a guest that joined. */
  | {
      t: 'welcome';
      sessionId: string;
      /** Null: the room has no item yet (only to a guest that sent `rooms`). */
      item: SharedItem | null;
      /** The host's media stream, or null when no stream is offered. */
      stream: StreamRef | null;
      onlyHostControls: boolean;
      anchor: Anchor;
      /** The guest's member id, so it can leave itself out of the members list. */
      you?: string;
      kind?: MediaKind;
      /** Audio: the shared queue. The anchor applies to `track`. */
      queue?: SharedQueue;
      track?: string;
      /** The session key: a member that reconnects, or that joins a new host, sends it. */
      key?: string;
      /** Grows by one each time a new host takes over the session. */
      epoch?: number;
      /** The host's member id (stable across reconnects). */
      hostId?: string;
      /** The members now (for a guest that sent `deltas`; later changes come as `memberDelta`). */
      members?: Member[];
      /** Rooms: the number of the room's current item. It grows with each `media`. */
      media?: number;
      /** The member id of the one device that plays the sound; left out or null: every device. */
      speaker?: string | null;
    }
  /** Clock sync: the guest sends t0 (its clock); the host answers with t1 (receive) and t2 (send), host clock. */
  | { t: 'ping'; id: number; t0: number }
  | { t: 'pong'; id: number; t0: number; t1: number; t2: number }
  /** Host to all: the new group state. `seq` grows with each change. */
  | { t: 'state'; seq: number; anchor: Anchor; waiting: boolean; /** Audio: the queue entry key that the anchor applies to. */ track?: string }
  /** Host to all (audio): the queue changed. `by`: the member id of a guest that picked a new queue. */
  | { t: 'queue'; seq: number; queue: SharedQueue; by?: string }
  /**
   * Host to the guests that sent `rooms`: the room plays another item, or
   * none (`item: null`). The anchor applies to the new item. `by`: the member
   * id of a guest that picked it (the others see a short note).
   */
  | {
      t: 'media';
      seq: number;
      media: number;
      kind: MediaKind;
      item: SharedItem | null;
      stream: StreamRef | null;
      anchor: Anchor;
      queue?: SharedQueue;
      track?: string;
      by?: string;
    }
  /** Guest to host (rooms): play this for everyone. */
  | { t: 'pick'; pick: PickRequest }
  /** Guest to host: a control request. */
  | ({ t: 'control' } & ControlAction)
  /** Guest to host: the guest buffers (true) or is ready (false). */
  | {
      t: 'buffering';
      buffering: boolean;
      local: boolean;
      /** The guest has all the media now (audio: known after the welcome). */
      canHost?: boolean;
      /** The guest streams from the item's Jellyfin server, not from the host. */
      server?: boolean;
      /** Rooms: the number of the item that this state is for (a host drops a state for an older item). */
      media?: number;
      /** Rooms: the guest cannot play the item; the group does not wait for it. */
      noMedia?: boolean;
    }
  /** Host to the guests that did not send `deltas`: the whole list. */
  | { t: 'members'; members: Member[]; onlyHostControls: boolean }
  /**
   * Host to the guests that sent `deltas`: the members that are new or
   * changed (`upsert`, by id) and the ids that left (`gone`). The host sends
   * at most one in 250 ms. Applying one twice changes nothing.
   */
  | { t: 'memberDelta'; upsert: Member[]; gone: string[]; onlyHostControls: boolean }
  /**
   * Host to all: the device that plays the sound now (`target`, a member id),
   * or null for every device. The others keep playing in sync with no sound.
   * `fallback`: the chosen device left, so the host plays the sound now.
   */
  | { t: 'speaker'; target: string | null; fallback?: boolean }
  /** Host to a guest: you may not control playback. */
  | { t: 'denied'; reason: string }
  /** Host to a guest: the host removed you (or removed and blocked you). Do not reconnect. */
  | { t: 'removed'; reason: string }
  /** Host to all: the session is over. Guest to host: I leave. */
  | { t: 'end' }
  | { t: 'leave' };

export type MessageType = Message['t'];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === 'string';
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const optNum = (x: unknown) => x === undefined || num(x);

function isAnchor(x: unknown): x is Anchor {
  return isObj(x) && bool(x.playing) && num(x.rate) && x.rate > 0 && num(x.hostTime) && num(x.position);
}

function isItem(x: unknown): x is SharedItem {
  return isObj(x) && str(x.id) && x.id.length > 0 && str(x.name) && str(x.type);
}

const optStr = (x: unknown) => x === undefined || x === null || str(x);
const optBool = (x: unknown) => x === undefined || bool(x);
const isRepeat = (x: unknown): x is 'off' | 'all' | 'one' => x === 'off' || x === 'all' || x === 'one';

function isMember(x: unknown): x is Member {
  return (
    isObj(x) &&
    str(x.id) &&
    str(x.name) &&
    bool(x.local) &&
    optBool(x.buffering) &&
    optNum(x.joinedAt) &&
    optBool(x.canHost) &&
    optBool(x.away) &&
    optBool(x.maker) &&
    optBool(x.server) &&
    optBool(x.noMedia)
  );
}

function isPickItem(x: unknown): x is PickItem {
  return isObj(x) && str(x.id) && x.id.length > 0 && x.id.length <= 64 && str(x.name) && str(x.type) && optStr(x.serverId) && optStr(x.mediaType);
}

const optPickList = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= MAX_PICK_ITEMS && x.every(isPickItem));

export function isPick(x: unknown): x is PickRequest {
  if (!isObj(x) || !isPickItem(x.item) || !optPickList(x.queue) || !optPickList(x.list)) return false;
  if (x.context !== undefined && !isPickItem(x.context)) return false;
  if (x.index !== undefined && !(num(x.index) && Number.isInteger(x.index) && x.index >= 0)) return false;
  return optBool(x.shuffle) && (x.start === undefined || (num(x.start) && x.start >= 0));
}

const isStream = (x: unknown) => x === null || (isObj(x) && str(x.service) && str(x.path));

function isFullItem(x: unknown): x is SharedItem {
  return isItem(x) && optStr(x.path) && optStr(x.art) && optStr(x.album) && optStr(x.artist);
}

export function isQueue(x: unknown): x is SharedQueue {
  if (!isObj(x) || !Array.isArray(x.entries) || x.entries.length > MAX_SHARED_ENTRIES || !num(x.index)) return false;
  if (!bool(x.shuffle) || !isRepeat(x.repeat) || !bool(x.longForm)) return false;
  if (!x.entries.every((e) => isObj(e) && str(e.key) && e.key.length > 0 && isFullItem(e.item))) return false;
  return x.entries.length === 0 ? x.index === -1 || x.index === 0 : x.index >= 0 && x.index < x.entries.length;
}

/** True when `x` has the shape of the message type it names. */
function valid(x: Record<string, unknown>): boolean {
  switch (x.t) {
    case 'hello':
      return (
        str(x.name) && Array.isArray(x.have) && x.have.every(str) && optStr(x.memberId) && optBool(x.canHost) && optBool(x.maker) && optBool(x.deltas) && optBool(x.rooms)
      );
    case 'welcome':
      return (
        str(x.sessionId) &&
        (x.item === null || isItem(x.item)) &&
        isStream(x.stream) &&
        bool(x.onlyHostControls) &&
        isAnchor(x.anchor) &&
        (x.you === undefined || str(x.you)) &&
        (x.kind === undefined || x.kind === 'video' || x.kind === 'audio') &&
        (x.queue === undefined || isQueue(x.queue)) &&
        optStr(x.track) &&
        optStr(x.key) &&
        optNum(x.epoch) &&
        optStr(x.hostId) &&
        (x.members === undefined || (Array.isArray(x.members) && x.members.every(isMember))) &&
        optNum(x.media) &&
        optStr(x.speaker)
      );
    case 'ping':
      return num(x.id) && num(x.t0);
    case 'pong':
      return num(x.id) && num(x.t0) && num(x.t1) && num(x.t2);
    case 'state':
      return num(x.seq) && isAnchor(x.anchor) && bool(x.waiting) && optStr(x.track);
    case 'queue':
      return num(x.seq) && isQueue(x.queue) && optStr(x.by);
    case 'media':
      return (
        num(x.seq) &&
        num(x.media) &&
        (x.kind === 'video' || x.kind === 'audio') &&
        (x.item === null || isFullItem(x.item)) &&
        isStream(x.stream) &&
        isAnchor(x.anchor) &&
        (x.queue === undefined || isQueue(x.queue)) &&
        optStr(x.track) &&
        optStr(x.by)
      );
    case 'pick':
      return isPick(x.pick);
    case 'control':
      switch (x.action) {
        case 'play':
        case 'pause':
          return optNum(x.position);
        case 'seek':
          return num(x.position) && x.position >= 0;
        case 'rate':
          return num(x.rate) && x.rate >= 0.25 && x.rate <= 4;
        case 'next':
        case 'previous':
          return true;
        case 'jump':
          return str(x.key) && x.key.length > 0;
        case 'shuffle':
          return bool(x.on);
        case 'repeat':
          return isRepeat(x.mode);
        default:
          return false;
      }
    case 'buffering':
      return bool(x.buffering) && bool(x.local) && optBool(x.canHost) && optBool(x.server) && optNum(x.media) && optBool(x.noMedia);
    case 'members':
      return Array.isArray(x.members) && x.members.every(isMember) && bool(x.onlyHostControls);
    case 'memberDelta':
      return Array.isArray(x.upsert) && x.upsert.every(isMember) && Array.isArray(x.gone) && x.gone.every(str) && bool(x.onlyHostControls);
    case 'speaker':
      return (x.target === null || (str(x.target) && x.target.length > 0)) && optBool(x.fallback);
    case 'denied':
    case 'removed':
      return str(x.reason);
    case 'end':
    case 'leave':
      return true;
    default:
      return false;
  }
}

export function encode(message: Message): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}

/** The message, or null for text that is not a valid message of this version. */
export function decode(text: string): Message | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || !str(raw.t)) return null;
  if (!valid(raw)) return null;
  const { v: _v, ...rest } = raw;
  return rest as unknown as Message;
}

/** The context a guest sends with its join request. */
export interface JoinContext {
  v: number;
  name: string;
  /** The guest has the item downloaded. */
  have: boolean;
  /**
   * The session key (a member that comes back, or that follows a new host) or
   * the key of a join code. A correct full key lets the guest in with no new
   * approval; a code key only tells the host that the guest has its code.
   */
  key?: string;
  memberId?: string;
  /** The guest's device key for this session (device-key.ts): a block holds after a restart. */
  device?: string;
}

/** The longest device key a host takes. */
const MAX_DEVICE = 64;

export function encodeJoinContext(ctx: Omit<JoinContext, 'v'>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...ctx });
}

export function decodeJoinContext(text: string | null | undefined): JoinContext | null {
  if (!text) return null;
  try {
    const x: unknown = JSON.parse(text);
    if (isObj(x) && x.v === PROTOCOL_VERSION && str(x.name) && bool(x.have) && (x.key === undefined || str(x.key)) && (x.memberId === undefined || str(x.memberId))) {
      const device = str(x.device) && x.device.length > 0 && x.device.length <= MAX_DEVICE ? x.device : null;
      return {
        v: PROTOCOL_VERSION,
        name: x.name,
        have: x.have,
        ...(str(x.key) ? { key: x.key } : {}),
        ...(str(x.memberId) ? { memberId: x.memberId } : {}),
        ...(device ? { device } : {}),
      };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/**
 * The link handshake on a control socket (link.ts), before the session
 * messages: the guest sends `join`; the host answers `accept` or `decline`.
 */
export type LinkMessage = { t: 'join'; ctx: JoinContext } | { t: 'accept' } | { t: 'decline'; reason: string };

export function encodeLink(m: LinkMessage): string {
  if (m.t === 'join') {
    const { v: _v, ...ctx } = m.ctx;
    return JSON.stringify({ v: PROTOCOL_VERSION, l: 'join', ...ctx });
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, l: m.t, ...(m.t === 'decline' ? { reason: m.reason } : {}) });
}

/** A link message, or null (then the text can be a session message). */
export function decodeLink(text: string): LinkMessage | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(x) || x.v !== PROTOCOL_VERSION || !str(x.l)) return null;
  switch (x.l) {
    case 'join': {
      const ctx = decodeJoinContext(text);
      return ctx ? { t: 'join', ctx } : null;
    }
    case 'accept':
      return { t: 'accept' };
    case 'decline':
      return { t: 'decline', reason: str(x.reason) ? x.reason : 'The host did not let you join.' };
    default:
      return null;
  }
}

/**
 * What the host advertises (Bonjour TXT record through Multipeer). Keys and
 * values stay short: the whole record must stay under about 400 bytes.
 */
export interface Advert {
  sessionId: string;
  hostName: string;
  itemId: string;
  itemName: string;
  /** The server of the shared download, or null. */
  serverId: string | null;
  kind?: MediaKind;
  /** The host election count (0 for the first host). */
  epoch?: number;
}

/**
 * The advert of a room now. A room with an item names it; an empty room has
 * the item id "room" and no title, and the nearby list says the host picks
 * something. The host sends a new advert each time the room's item changes.
 */
export function roomAdvert(r: {
  sessionId: string;
  hostName: string;
  epoch: number;
  kind: MediaKind;
  /** The room's item, or null for an empty room. */
  itemId: string | null;
  title: string;
  serverId: string | null;
}): Advert {
  return {
    sessionId: r.sessionId,
    hostName: r.hostName,
    itemId: r.itemId || 'room',
    itemName: r.itemId ? r.title : '',
    serverId: r.serverId,
    kind: r.kind,
    epoch: r.epoch,
  };
}

/**
 * A host found over Bluetooth, as an advert for the nearby list. The INFO
 * has no item id: an empty title is an empty room.
 */
export function bleAdvert(info: { session: string; host: string; title: string; kind: MediaKind }): Advert {
  return { sessionId: info.session, hostName: info.host, itemId: info.title ? '' : 'room', itemName: info.title, serverId: null, kind: info.kind };
}

const MAX_ADVERT_VALUE = 60;

export function encodeAdvert(a: Advert): Record<string, string> {
  return {
    v: String(PROTOCOL_VERSION),
    s: a.sessionId.slice(0, 36),
    h: a.hostName.slice(0, MAX_ADVERT_VALUE),
    i: a.itemId.slice(0, 64),
    n: a.itemName.slice(0, MAX_ADVERT_VALUE),
    ...(a.serverId ? { sv: a.serverId.slice(0, 64) } : {}),
    ...(a.kind === 'audio' ? { k: 'a' } : {}),
    ...(a.epoch ? { e: String(a.epoch) } : {}),
  };
}

export function decodeAdvert(info: Record<string, string> | null | undefined): Advert | null {
  if (!info || info.v !== String(PROTOCOL_VERSION) || !info.s || !info.i) return null;
  const epoch = Number(info.e ?? '0');
  return {
    sessionId: info.s,
    hostName: info.h ?? 'Nearby device',
    itemId: info.i,
    itemName: info.n ?? '',
    serverId: info.sv ?? null,
    kind: info.k === 'a' ? 'audio' : 'video',
    epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0,
  };
}
