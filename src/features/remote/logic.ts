/**
 * Remote control rules: which Jellyfin sessions this user can control, what
 * each one can do, and where its playback is now. "Play on…" and the Remote
 * screen use these. Pure, so it is unit-tested.
 *
 * Rules:
 * - A session is controllable when the server says it supports remote
 *   control, it has an Id, and it is not this device.
 * - A command shows only when the target supports it: playstate commands need
 *   something playing, seek needs `CanSeek`, volume and mute need the general
 *   command in `SupportedCommands`.
 * - The position moves on between polls while the target plays, so the bar
 *   does not jump every two seconds. It never passes the runtime.
 */

/** The session fields these rules read. `SessionInfoDto` from the SDK fits it. */
export interface RemoteSession {
  Id?: string | null;
  DeviceId?: string | null;
  DeviceName?: string | null;
  Client?: string | null;
  LastActivityDate?: string;
  SupportsRemoteControl?: boolean;
  SupportsMediaControl?: boolean;
  PlayableMediaTypes?: string[] | null;
  SupportedCommands?: string[] | null;
  NowPlayingItem?: {
    Id?: string | null;
    Name?: string | null;
    Type?: string | null;
    SeriesName?: string | null;
    RunTimeTicks?: number | null;
  } | null;
  NowPlayingQueue?: unknown[] | null;
  PlayState?: {
    PositionTicks?: number | null;
    CanSeek?: boolean;
    IsPaused?: boolean;
    IsMuted?: boolean;
    VolumeLevel?: number | null;
  } | null;
}

export const TICKS_PER_SECOND = 10_000_000;

/** Item types that "Play on…" offers. The target client expands a folder (a show, an album) itself. */
const REMOTE_PLAYABLE = new Set([
  'Movie',
  'Episode',
  'Video',
  'MusicVideo',
  'Audio',
  'AudioBook',
  'MusicAlbum',
  'MusicArtist',
  'Playlist',
  'Series',
  'Season',
  'BoxSet',
]);
const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);

export function canPlayRemotely(item: { Id?: string | null; Type?: string | null }): boolean {
  return !!item.Id && REMOTE_PLAYABLE.has(item.Type ?? '');
}

/** The media type the target must play for this item: "Audio" or "Video". */
export function mediaTypeOf(item: { Type?: string | null; MediaType?: string | null }): 'Audio' | 'Video' {
  if (item.MediaType === 'Audio' || item.MediaType === 'Video') return item.MediaType;
  return AUDIO_TYPES.has(item.Type ?? '') ? 'Audio' : 'Video';
}

function lastActive(s: RemoteSession): number {
  const t = s.LastActivityDate ? Date.parse(s.LastActivityDate) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * The sessions this device can control, with this device left out. A session
 * that plays something comes first, then the most recently active one.
 */
export function controllableSessions<T extends RemoteSession>(sessions: readonly T[], ownDeviceId: string | null): T[] {
  return sessions
    .filter((s) => !!s.Id && s.SupportsRemoteControl === true && (!ownDeviceId || s.DeviceId !== ownDeviceId))
    .sort((a, b) => Number(!!b.NowPlayingItem) - Number(!!a.NowPlayingItem) || lastActive(b) - lastActive(a));
}

/**
 * The sessions that can play this item. A session that lists no media types
 * gets the benefit of the doubt.
 */
export function sessionsFor<T extends RemoteSession>(sessions: readonly T[], item: { Type?: string | null; MediaType?: string | null }): T[] {
  const media = mediaTypeOf(item);
  return sessions.filter((s) => !s.PlayableMediaTypes?.length || s.PlayableMediaTypes.includes(media));
}

/** "Living room TV" and "Jellyfin Web · 10.11.0" style names for a session row. */
export function sessionName(s: RemoteSession): string {
  return s.DeviceName?.trim() || s.Client?.trim() || 'Unknown device';
}

const TV_HINT = /\b(tv|roku|kodi|fire ?tv|shield|chromecast|apple ?tv|tizen|webos)\b/i;

/** A TV-like target gets a TV icon, the others a device icon. */
export function deviceKind(s: RemoteSession): 'tv' | 'device' {
  return TV_HINT.test(`${s.DeviceName ?? ''} ${s.Client ?? ''}`) ? 'tv' : 'device';
}

/** What the session plays: "Playing Big Buck Bunny", "Paused …", or "Nothing playing". */
export function nowPlayingLine(s: RemoteSession): string {
  const it = s.NowPlayingItem;
  if (!it) return 'Nothing playing';
  const name = it.Type === 'Episode' && it.SeriesName ? `${it.SeriesName}: ${it.Name ?? ''}` : (it.Name ?? 'Unknown item');
  return `${s.PlayState?.IsPaused ? 'Paused' : 'Playing'} ${name}`;
}

/** The second line of a session row: the client and what it plays. */
export function sessionDetail(s: RemoteSession): string {
  const client = s.Client?.trim();
  const playing = nowPlayingLine(s);
  return client && client !== sessionName(s) ? `${client} · ${playing}` : playing;
}

export interface RemoteCommands {
  playPause: boolean;
  seek: boolean;
  /** Next and previous: the target has a queue of more than one item. */
  skip: boolean;
  stop: boolean;
  volume: boolean;
  mute: boolean;
}

function supports(s: RemoteSession, ...names: string[]): boolean {
  return names.some((n) => s.SupportedCommands?.includes(n) ?? false);
}

/** The controls to show for a session. */
export function remoteCommands(s: RemoteSession): RemoteCommands {
  const control = s.SupportsRemoteControl === true && s.SupportsMediaControl !== false;
  const playing = control && !!s.NowPlayingItem;
  return {
    playPause: playing,
    seek: playing && s.PlayState?.CanSeek === true && (s.NowPlayingItem?.RunTimeTicks ?? 0) > 0,
    skip: playing && (s.NowPlayingQueue?.length ?? 0) > 1,
    stop: playing,
    volume: control && supports(s, 'SetVolume'),
    mute: control && supports(s, 'ToggleMute', 'Mute', 'Unmute'),
  };
}

export interface Progress {
  /** Position now, in ticks. */
  positionTicks: number;
  /** Runtime in ticks, or 0 when not known (live TV). */
  runtimeTicks: number;
  /** 0..1, or null when the runtime is not known. */
  fraction: number | null;
}

/**
 * The position now. `fetchedAt` is when the session data arrived; while the
 * target plays, the time since then is added.
 */
export function progressAt(s: RemoteSession, fetchedAt: number, now: number): Progress {
  const runtime = Math.max(0, s.NowPlayingItem?.RunTimeTicks ?? 0);
  let pos = Math.max(0, s.PlayState?.PositionTicks ?? 0);
  if (s.NowPlayingItem && !s.PlayState?.IsPaused) pos += Math.max(0, now - fetchedAt) * (TICKS_PER_SECOND / 1000);
  if (runtime > 0) pos = Math.min(pos, runtime);
  return { positionTicks: Math.round(pos), runtimeTicks: runtime, fraction: runtime > 0 ? pos / runtime : null };
}

/** The seek target for a jump of `deltaSeconds` from `positionTicks`, kept inside the item. */
export function seekTarget(positionTicks: number, deltaSeconds: number, runtimeTicks: number): number {
  const next = positionTicks + deltaSeconds * TICKS_PER_SECOND;
  const max = runtimeTicks > 0 ? runtimeTicks : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(0, next)));
}

/** The seek target for a tap at `fraction` (0..1) of the bar. */
export function seekToFraction(fraction: number, runtimeTicks: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * Math.max(0, runtimeTicks));
}

/** The volume after a step, 0..100. An unknown volume starts at 50. */
export function volumeStep(level: number | null | undefined, delta: number): number {
  const base = typeof level === 'number' && Number.isFinite(level) ? level : 50;
  return Math.min(100, Math.max(0, Math.round(base + delta)));
}

/**
 * Where "Play on…" starts: the saved position of a film or episode that the
 * user has started, else the beginning (undefined).
 */
export function startTicksFor(item: { Type?: string | null; UserData?: { PlaybackPositionTicks?: number | null; Played?: boolean } | null }): number | undefined {
  if (item.Type !== 'Movie' && item.Type !== 'Episode' && item.Type !== 'Video') return undefined;
  const pos = item.UserData?.PlaybackPositionTicks ?? 0;
  return pos > 0 ? pos : undefined;
}
