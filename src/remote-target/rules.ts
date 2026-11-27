/**
 * Remote control target rules: this device as the one that is controlled.
 * Another client of the same user (Zoggyfin's "Play on…" and Remote screen,
 * or the Jellyfin web client) sends commands through the Jellyfin server,
 * and the server forwards them over the WebSocket as `Play`, `Playstate`
 * and `GeneralCommand` messages.
 *
 * Rules:
 * - Only devices with no touch screen are targets: TV, the Mac app and the
 *   web in a browser with a fine pointer (or the TV preview). Phones and
 *   tablets control; they are never controlled (`targetSupport`).
 * - The capabilities list only the general commands this device really
 *   handles. The volume commands need the app's own volume (the web and the
 *   Mac app); a TV uses the hardware volume, so it offers only mute.
 * - A command from another user is ignored: control stays within one user,
 *   also when an admin's server lists every session.
 * - An unknown or malformed message gives no action (`parseMessage` → null).
 *   It never throws.
 * - What a `Play` does is decided here (`playPlan`); the I/O side only
 *   fetches the items and calls the player.
 *
 * Pure, so it is unit-tested. No React, no SDK, no native imports.
 */

export const TICKS_PER_SECOND = 10_000_000;

/** Seconds that Rewind and Fast forward jump when the controller does not say. */
export const REWIND_SECONDS = 10;
export const FAST_FORWARD_SECONDS = 30;

/** What this device can do as a target. */
export interface TargetSupport {
  /** SetVolume, VolumeUp, VolumeDown: the app's own volume level. */
  volume: boolean;
  /** Mute, Unmute, ToggleMute. */
  mute: boolean;
}

export interface TargetEnv {
  /** A real TV build (Android TV, Fire TV, Apple TV). */
  nativeTV: boolean;
  /** The web build: a browser, the web TV preview or the Mac app. */
  web: boolean;
  /** The web TV preview (`?tv=1`). */
  tvPreview: boolean;
  /** The Mac app (Tauri). */
  desktop: boolean;
  /** The browser has no fine pointer (a phone or tablet browser). */
  touchOnly: boolean;
  /** The app has its own volume slider (`features.inAppVolume`). */
  inAppVolume: boolean;
}

/** Null when this device is never a target (a phone, a tablet, a touch browser). */
export function targetSupport(env: TargetEnv): TargetSupport | null {
  const target = env.nativeTV || env.desktop || (env.web && (env.tvPreview || !env.touchOnly));
  if (!target) return null;
  return { volume: env.inAppVolume, mute: true };
}

/** The general commands to list in the capabilities, in a fixed order. */
export function supportedCommands(s: TargetSupport): string[] {
  const out: string[] = [];
  if (s.volume) out.push('SetVolume', 'VolumeUp', 'VolumeDown');
  if (s.mute) out.push('Mute', 'Unmute', 'ToggleMute');
  out.push('SetAudioStreamIndex', 'SetSubtitleStreamIndex', 'DisplayMessage');
  return out;
}

/** The body of `POST /Sessions/Capabilities/Full`. */
export interface TargetCapabilities {
  PlayableMediaTypes: ('Video' | 'Audio')[];
  SupportedCommands: string[];
  SupportsMediaControl: true;
  SupportsPersistentIdentifier: boolean;
}

export function capabilitiesFor(s: TargetSupport, persistentId: boolean): TargetCapabilities {
  return {
    PlayableMediaTypes: ['Video', 'Audio'],
    SupportedCommands: supportedCommands(s),
    SupportsMediaControl: true,
    SupportsPersistentIdentifier: persistentId,
  };
}

// ---- Messages ----------------------------------------------------------------------

export type PlayCommand = 'PlayNow' | 'PlayNext' | 'PlayLast' | 'PlayInstantMix' | 'PlayShuffle';

export type RemoteAction =
  /** `startPositionTicks` 0 is the beginning, as on the Jellyfin clients: a resume sends its position. */
  | { kind: 'play'; command: PlayCommand; itemIds: string[]; startIndex: number; startPositionTicks: number }
  | { kind: 'stop' }
  | { kind: 'pause' }
  | { kind: 'unpause' }
  | { kind: 'playPause' }
  | { kind: 'seek'; positionTicks: number }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'skip'; seconds: number }
  | { kind: 'setVolume'; level: number }
  | { kind: 'volumeStep'; steps: number }
  | { kind: 'mute'; muted: boolean | 'toggle' }
  | { kind: 'audioTrack'; index: number }
  | { kind: 'subtitleTrack'; index: number | null }
  | { kind: 'message'; text: string };

/** The name of an action for the player log (a command name, never data). */
export function actionName(a: RemoteAction): string {
  return a.kind === 'play' ? a.command : a.kind;
}

/** The Jellyfin socket message, as far as these rules read it. */
export interface SocketMessage {
  MessageType?: string;
  Data?: unknown;
}

const PLAY_COMMANDS = new Set<string>(['PlayNow', 'PlayNext', 'PlayLast', 'PlayInstantMix', 'PlayShuffle']);

/** A Jellyfin Id with case and dashes removed, so "AbC-1" and "abc1" match. */
export function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * True when the controller is this user, or the server did not say who it is
 * (no Id, or the empty Id: `POST /Sessions/{id}/Message` sends all zeros).
 */
function fromSameUser(data: Record<string, unknown>, ownUserId: string): boolean {
  const by = data.ControllingUserId;
  if (typeof by !== 'string' || !by) return true;
  const id = normalizeId(by);
  if (/^0+$/.test(id)) return true;
  return id === normalizeId(ownUserId);
}

/** The action of one socket message, or null (another type, another user, bad data). */
export function parseMessage(msg: SocketMessage, ownUserId: string): RemoteAction | null {
  const data = record(msg.Data);
  if (!data || !fromSameUser(data, ownUserId)) return null;
  switch (msg.MessageType) {
    case 'Play':
      return parsePlay(data);
    case 'Playstate':
      return parsePlaystate(data);
    case 'GeneralCommand':
      return parseGeneral(data);
    default:
      return null;
  }
}

function parsePlay(d: Record<string, unknown>): RemoteAction | null {
  const ids = Array.isArray(d.ItemIds) ? d.ItemIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  if (!ids.length) return null;
  const command = typeof d.PlayCommand === 'string' && PLAY_COMMANDS.has(d.PlayCommand) ? (d.PlayCommand as PlayCommand) : 'PlayNow';
  const start = int(d.StartIndex);
  const ticks = int(d.StartPositionTicks);
  return {
    kind: 'play',
    command,
    itemIds: ids,
    startIndex: start !== null && start >= 0 && start < ids.length ? start : 0,
    startPositionTicks: ticks !== null && ticks > 0 ? ticks : 0,
  };
}

function parsePlaystate(d: Record<string, unknown>): RemoteAction | null {
  switch (d.Command) {
    case 'Stop':
      return { kind: 'stop' };
    case 'Pause':
      return { kind: 'pause' };
    case 'Unpause':
      return { kind: 'unpause' };
    case 'PlayPause':
      return { kind: 'playPause' };
    case 'Seek': {
      const t = int(d.SeekPositionTicks);
      return t === null ? null : { kind: 'seek', positionTicks: Math.max(0, t) };
    }
    case 'NextTrack':
      return { kind: 'next' };
    case 'PreviousTrack':
      return { kind: 'previous' };
    case 'Rewind':
      return { kind: 'skip', seconds: -REWIND_SECONDS };
    case 'FastForward':
      return { kind: 'skip', seconds: FAST_FORWARD_SECONDS };
    default:
      return null;
  }
}

function parseGeneral(d: Record<string, unknown>): RemoteAction | null {
  const args = record(d.Arguments) ?? {};
  switch (d.Name) {
    case 'SetVolume': {
      const v = int(args.Volume);
      return v === null ? null : { kind: 'setVolume', level: Math.min(100, Math.max(0, v)) / 100 };
    }
    case 'VolumeUp':
      return { kind: 'volumeStep', steps: 1 };
    case 'VolumeDown':
      return { kind: 'volumeStep', steps: -1 };
    case 'Mute':
      return { kind: 'mute', muted: true };
    case 'Unmute':
      return { kind: 'mute', muted: false };
    case 'ToggleMute':
      return { kind: 'mute', muted: 'toggle' };
    case 'SetAudioStreamIndex': {
      const i = int(args.Index);
      return i === null || i < 0 ? null : { kind: 'audioTrack', index: i };
    }
    case 'SetSubtitleStreamIndex': {
      const i = int(args.Index);
      return i === null ? null : { kind: 'subtitleTrack', index: i < 0 ? null : i };
    }
    case 'DisplayMessage': {
      const header = typeof args.Header === 'string' ? args.Header.trim() : '';
      const text = typeof args.Text === 'string' ? args.Text.trim() : '';
      const shown = header && text ? `${header}: ${text}` : header || text;
      return shown ? { kind: 'message', text: shown.slice(0, 200) } : null;
    }
    default:
      return null;
  }
}

/** True when the action is one this device listed in its capabilities (a Playstate or Play always is). */
export function allowedBy(s: TargetSupport, a: RemoteAction): boolean {
  if (a.kind === 'setVolume' || a.kind === 'volumeStep') return s.volume;
  if (a.kind === 'mute') return s.mute;
  return true;
}

// ---- Play ---------------------------------------------------------------------------

/** The item fields a play plan reads. `BaseItemDto` fits it. */
export interface PlanItem {
  Id?: string | null;
  Type?: string | null;
  MediaType?: string | null;
}

/** The items in the order of `ids`; ids the server did not return are left out. */
export function orderByIds<T extends PlanItem>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map<string, T>();
  for (const it of items) if (it.Id) byId.set(normalizeId(it.Id), it);
  const out: T[] = [];
  for (const id of ids) {
    const it = byId.get(normalizeId(id));
    if (it) out.push(it);
  }
  return out;
}

const CONTAINERS = new Set(['MusicAlbum', 'MusicArtist', 'MusicGenre', 'Playlist', 'Series', 'Season', 'BoxSet', 'Folder', 'CollectionFolder']);

export type PlayPlan<T> =
  | { kind: 'audio'; item: T; list: T[] | null; index: number; shuffle: boolean; startPositionTicks: number }
  | { kind: 'video'; item: T; queue: T[]; startPositionTicks: number }
  | { kind: 'queue'; how: 'next' | 'last'; items: T[] }
  | { kind: 'mix'; item: T }
  | { kind: 'refuse'; text: string }
  | { kind: 'none' };

/**
 * What a `Play` does with the fetched items (in `ItemIds` order, a missing
 * one left out, so `startId` finds the start). `nowKind` is what plays here
 * now. `isAudio` is the player's own rule (`isAudioItem`).
 *
 * - PlayNow, PlayShuffle: the start item plays, with the rest as its list
 *   (music) or queue (video). A container (album, show) expands in the player.
 * - PlayNext, PlayLast: music goes into the queue that plays. With nothing
 *   playing they play now. Video has no queue here: the device says so.
 * - PlayInstantMix: a mix from the start item.
 */
export function playPlan<T extends PlanItem>(
  action: Extract<RemoteAction, { kind: 'play' }>,
  items: readonly T[],
  nowKind: 'audio' | 'video' | null,
  isAudio: (item: T) => boolean,
): PlayPlan<T> {
  if (!items.length) return { kind: 'none' };
  const startId = action.itemIds[action.startIndex];
  const found = startId ? items.findIndex((i) => !!i.Id && normalizeId(i.Id) === normalizeId(startId)) : -1;
  const index = found >= 0 ? found : 0;
  const item = items[index] as T;
  const audio = isAudio(item);
  const command = action.command;

  if (command === 'PlayInstantMix') return { kind: 'mix', item };

  if (command === 'PlayNext' || command === 'PlayLast') {
    if (nowKind === null) return playNow(items, index, audio, false, 0);
    if (nowKind === 'audio' && audio) return { kind: 'queue', how: command === 'PlayNext' ? 'next' : 'last', items: items.filter((i) => isAudio(i)) };
    return { kind: 'refuse', text: 'This device can add only music to the queue that plays.' };
  }

  return playNow(items, index, audio, command === 'PlayShuffle', action.startPositionTicks);
}

function playNow<T extends PlanItem>(items: readonly T[], index: number, audio: boolean, shuffle: boolean, ticks: number): PlayPlan<T> {
  const item = items[index] as T;
  if (audio) {
    // A list of songs: Previous and the queue know what came before. A container expands in the player.
    const songs = items.length > 1 && items.every((i) => !CONTAINERS.has(i.Type ?? ''));
    return { kind: 'audio', item, list: songs ? [...items] : null, index: songs ? index : 0, shuffle, startPositionTicks: ticks };
  }
  return { kind: 'video', item, queue: items.slice(index + 1), startPositionTicks: ticks };
}
