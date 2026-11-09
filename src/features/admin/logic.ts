/**
 * Pure logic of the Admin panel: labels for sessions, the policy patch of a
 * user, the next run of a scheduled task, activity filters, log paging and
 * the set of actions in flight.
 * Nothing here calls the server or React, so all of it has unit tests.
 */
import type {
  ActivityLogEntry,
  PlayMethod,
  SessionInfoDto,
  SyncPlayUserAccessType,
  TaskInfo,
  TaskTriggerInfo,
  TranscodeReason,
  UserPolicy,
} from '@jellyfin/sdk/lib/generated-client/models';

// ---- Sessions ---------------------------------------------------------------------

const PLAY_METHOD_LABEL: Record<PlayMethod, string> = {
  DirectPlay: 'Direct Play',
  DirectStream: 'Direct Stream',
  Transcode: 'Transcode',
};

/** "Direct Play", "Direct Stream" or "Transcode". Null when nothing plays. */
export function playMethodLabel(method: PlayMethod | null | undefined): string | null {
  return method ? (PLAY_METHOD_LABEL[method] ?? method) : null;
}

const REASON_LABEL: Record<TranscodeReason, string> = {
  ContainerNotSupported: 'Container not supported',
  VideoCodecNotSupported: 'Video codec not supported',
  AudioCodecNotSupported: 'Audio codec not supported',
  SubtitleCodecNotSupported: 'Subtitle format not supported',
  AudioIsExternal: 'Audio is in a separate file',
  SecondaryAudioNotSupported: 'Second audio track not supported',
  VideoProfileNotSupported: 'Video profile not supported',
  VideoLevelNotSupported: 'Video level not supported',
  VideoResolutionNotSupported: 'Video resolution not supported',
  VideoBitDepthNotSupported: 'Video bit depth not supported',
  VideoFramerateNotSupported: 'Frame rate not supported',
  RefFramesNotSupported: 'Reference frames not supported',
  AnamorphicVideoNotSupported: 'Anamorphic video not supported',
  InterlacedVideoNotSupported: 'Interlaced video not supported',
  AudioChannelsNotSupported: 'Audio channels not supported',
  AudioProfileNotSupported: 'Audio profile not supported',
  AudioSampleRateNotSupported: 'Audio sample rate not supported',
  AudioBitDepthNotSupported: 'Audio bit depth not supported',
  ContainerBitrateExceedsLimit: 'Bitrate is above the limit',
  VideoBitrateNotSupported: 'Video bitrate not supported',
  AudioBitrateNotSupported: 'Audio bitrate not supported',
  UnknownVideoStreamInfo: 'Unknown video stream',
  UnknownAudioStreamInfo: 'Unknown audio stream',
  DirectPlayError: 'Direct Play failed',
  VideoRangeTypeNotSupported: 'HDR type not supported',
  VideoCodecTagNotSupported: 'Video codec tag not supported',
  StreamCountExceedsLimit: 'Too many streams',
  VideoRotationNotSupported: 'Video rotation not supported',
};

/** A plain label for one transcode reason. An unknown value shows as the server sends it. */
export function transcodeReasonLabel(reason: string): string {
  return REASON_LABEL[reason as TranscodeReason] ?? reason.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** All reasons as one line: "Video codec not supported, Bitrate is above the limit". */
export function transcodeReasonsText(reasons: readonly string[] | null | undefined): string | null {
  if (!reasons || reasons.length === 0) return null;
  return reasons.map(transcodeReasonLabel).join(', ');
}

/** "8.4 Mbps", "320 kbps". Null for no value. */
export function formatBitrate(bitsPerSecond: number | null | undefined): string | null {
  if (!bitsPerSecond || bitsPerSecond <= 0) return null;
  if (bitsPerSecond >= 1_000_000) {
    const m = bitsPerSecond / 1_000_000;
    return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')} Mbps`;
  }
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export interface SessionPlayInfo {
  /** "Direct Play", "Direct Stream" or "Transcode". */
  method: string | null;
  isTranscode: boolean;
  reasons: string | null;
  bitrate: string | null;
  /** 0–1, or null when the length is not known. */
  progress: number | null;
  paused: boolean;
  /** "H.264 → HEVC" style details of a transcode. */
  detail: string | null;
  /** Transcode progress of the job, 0–100. */
  transcodePercent: number | null;
}

/** The facts the Now playing screen shows for one session. */
export function sessionPlayInfo(s: SessionInfoDto): SessionPlayInfo {
  const ps = s.PlayState;
  const ti = s.TranscodingInfo;
  const methodRaw = ps?.PlayMethod ?? null;
  // A server can report a transcode job with no play method (for example while it starts).
  const isTranscode = methodRaw === 'Transcode' || (!methodRaw && !!ti && !(ti.IsVideoDirect && ti.IsAudioDirect));
  const method = playMethodLabel(methodRaw ?? (ti ? (isTranscode ? 'Transcode' : 'DirectStream') : null));
  const runtime = s.NowPlayingItem?.RunTimeTicks ?? 0;
  const pos = ps?.PositionTicks ?? 0;
  const progress = runtime > 0 ? Math.min(1, Math.max(0, pos / runtime)) : null;
  const sourceBitrate = s.NowPlayingItem?.MediaSources?.find((m) => m.Id === ps?.MediaSourceId)?.Bitrate ?? s.NowPlayingItem?.MediaSources?.[0]?.Bitrate;
  const bitrate = formatBitrate(ti?.Bitrate ?? sourceBitrate);
  let detail: string | null = null;
  if (ti && isTranscode) {
    const parts: string[] = [];
    if (ti.VideoCodec) parts.push(ti.IsVideoDirect ? `Video ${ti.VideoCodec.toUpperCase()} (direct)` : `Video → ${ti.VideoCodec.toUpperCase()}`);
    if (ti.AudioCodec) parts.push(ti.IsAudioDirect ? `Audio ${ti.AudioCodec.toUpperCase()} (direct)` : `Audio → ${ti.AudioCodec.toUpperCase()}`);
    if (ti.HardwareAccelerationType && ti.HardwareAccelerationType !== 'none') parts.push(`HW ${ti.HardwareAccelerationType}`);
    detail = parts.length ? parts.join(' · ') : null;
  }
  return {
    method,
    isTranscode,
    reasons: isTranscode ? transcodeReasonsText(ti?.TranscodeReasons) : null,
    bitrate,
    progress,
    paused: !!ps?.IsPaused,
    detail,
    transcodePercent: isTranscode && ti?.CompletionPercentage != null ? Math.round(ti.CompletionPercentage) : null,
  };
}

/** Sessions with something playing first, then the most recent activity. */
export function sortSessions(list: readonly SessionInfoDto[]): SessionInfoDto[] {
  return [...list].sort((a, b) => {
    const pa = a.NowPlayingItem ? 1 : 0;
    const pb = b.NowPlayingItem ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return Date.parse(b.LastActivityDate ?? '') - Date.parse(a.LastActivityDate ?? '') || 0;
  });
}

// ---- Live refresh -----------------------------------------------------------------

export const SESSION_REFRESH_MS = 5000;
export const TASK_REFRESH_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

/**
 * How long to wait before the next refresh of a live list, or false for no
 * refresh. The list refreshes only while its screen is open and the app is in
 * front. After failed requests the wait doubles, up to one minute.
 */
export function refreshDelay(opts: { focused: boolean; appActive: boolean; failures: number; base?: number }): number | false {
  if (!opts.focused || !opts.appActive) return false;
  const base = opts.base ?? SESSION_REFRESH_MS;
  if (opts.failures <= 0) return base;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(opts.failures, 6));
}

// ---- Users and policy -------------------------------------------------------------

/** The policy fields that the user screen can change. */
export interface PolicyEdits {
  EnableAllFolders?: boolean;
  EnabledFolders?: string[];
  EnableContentDownloading?: boolean;
  EnableRemoteAccess?: boolean;
  EnableVideoPlaybackTranscoding?: boolean;
  EnableAudioPlaybackTranscoding?: boolean;
  SyncPlayAccess?: SyncPlayUserAccessType;
  /** Bits per second; 0 is no limit. */
  RemoteClientBitrateLimit?: number;
  /** Null is no limit. */
  MaxParentalRating?: number | null;
  IsDisabled?: boolean;
}

export const EDITABLE_POLICY_KEYS: readonly (keyof PolicyEdits)[] = [
  'EnableAllFolders',
  'EnabledFolders',
  'EnableContentDownloading',
  'EnableRemoteAccess',
  'EnableVideoPlaybackTranscoding',
  'EnableAudioPlaybackTranscoding',
  'SyncPlayAccess',
  'RemoteClientBitrateLimit',
  'MaxParentalRating',
  'IsDisabled',
];

const POLICY_KEY_LABEL: Record<keyof PolicyEdits, string> = {
  EnableAllFolders: 'library access',
  EnabledFolders: 'library access',
  EnableContentDownloading: 'downloads',
  EnableRemoteAccess: 'remote access',
  EnableVideoPlaybackTranscoding: 'video transcoding',
  EnableAudioPlaybackTranscoding: 'audio transcoding',
  SyncPlayAccess: 'SyncPlay',
  RemoteClientBitrateLimit: 'bitrate limit',
  MaxParentalRating: 'parental rating',
  IsDisabled: 'account status',
};

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = [...((a as string[] | null | undefined) ?? [])].sort();
    const y = [...((b as string[] | null | undefined) ?? [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  // The server sends null or leaves out a field for "no value": treat both as the same.
  return (a ?? null) === (b ?? null);
}

/** The keys of `draft` that differ from the saved policy. */
export function policyDiff(saved: UserPolicy, draft: PolicyEdits): (keyof PolicyEdits)[] {
  return EDITABLE_POLICY_KEYS.filter((k) => k in draft && !sameValue(saved[k], draft[k]));
}

/** The changed fields as words, for the result toast: "downloads and bitrate limit". */
export function describeChanges(keys: readonly (keyof PolicyEdits)[]): string {
  const words = [...new Set(keys.map((k) => POLICY_KEY_LABEL[k]))];
  if (words.length <= 1) return words[0] ?? 'nothing';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The full policy to send. The server replaces the whole policy on update, so
 * the patch starts from the saved policy and changes only the edited fields.
 * Null when nothing changed.
 */
export function buildPolicyUpdate(saved: UserPolicy, draft: PolicyEdits): UserPolicy | null {
  const keys = policyDiff(saved, draft);
  if (keys.length === 0) return null;
  const next: UserPolicy = { ...saved };
  for (const k of keys) (next as unknown as Record<string, unknown>)[k] = draft[k];
  // With access to all libraries, the list of libraries has no use.
  if (next.EnableAllFolders) next.EnabledFolders = [];
  return next;
}

/** Turns access to one library on or off, from the current draft and the list of all libraries. */
export function toggleLibrary(draft: Pick<PolicyEdits, 'EnableAllFolders' | 'EnabledFolders'>, allIds: readonly string[], id: string, on: boolean): Pick<PolicyEdits, 'EnableAllFolders' | 'EnabledFolders'> {
  const current = draft.EnableAllFolders ? [...allIds] : [...(draft.EnabledFolders ?? [])];
  const set = new Set(current);
  if (on) set.add(id);
  else set.delete(id);
  const list = allIds.filter((x) => set.has(x));
  // Every library on: store it as "all libraries", so libraries added later are included.
  if (allIds.length > 0 && list.length === allIds.length) return { EnableAllFolders: true, EnabledFolders: [] };
  return { EnableAllFolders: false, EnabledFolders: list };
}

/** True when the user can open the library with this draft. */
export function hasLibrary(draft: Pick<PolicyEdits, 'EnableAllFolders' | 'EnabledFolders'>, id: string): boolean {
  return !!draft.EnableAllFolders || (draft.EnabledFolders ?? []).includes(id);
}

/** The editable fields of a saved policy, as the first draft. */
export function draftFrom(p: UserPolicy): PolicyEdits {
  return {
    EnableAllFolders: p.EnableAllFolders ?? false,
    EnabledFolders: [...(p.EnabledFolders ?? [])],
    EnableContentDownloading: p.EnableContentDownloading ?? false,
    EnableRemoteAccess: p.EnableRemoteAccess ?? false,
    EnableVideoPlaybackTranscoding: p.EnableVideoPlaybackTranscoding ?? false,
    EnableAudioPlaybackTranscoding: p.EnableAudioPlaybackTranscoding ?? false,
    SyncPlayAccess: p.SyncPlayAccess ?? 'None',
    RemoteClientBitrateLimit: p.RemoteClientBitrateLimit ?? 0,
    MaxParentalRating: p.MaxParentalRating ?? null,
    IsDisabled: p.IsDisabled ?? false,
  };
}

/** Bitrate limits in the picker (bits per second). 0 is no limit. */
export const BITRATE_LIMITS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'No limit' },
  ...[120, 80, 60, 40, 20, 15, 10, 8, 6, 4, 3, 2, 1].map((m) => ({ value: m * 1_000_000, label: `${m} Mbps` })),
  { value: 720_000, label: '720 kbps' },
  { value: 420_000, label: '420 kbps' },
];

export function bitrateLimitLabel(bps: number | null | undefined): string {
  if (!bps) return 'No limit';
  return BITRATE_LIMITS.find((b) => b.value === bps)?.label ?? formatBitrate(bps) ?? 'No limit';
}

export const SYNCPLAY_OPTIONS: readonly { value: SyncPlayUserAccessType; label: string }[] = [
  { value: 'CreateAndJoinGroups', label: 'Create and join groups' },
  { value: 'JoinGroups', label: 'Join groups only' },
  { value: 'None', label: 'Not allowed' },
];

export function syncPlayLabel(v: SyncPlayUserAccessType | null | undefined): string {
  return SYNCPLAY_OPTIONS.find((o) => o.value === (v ?? 'None'))?.label ?? 'Not allowed';
}

/** One entry per rating score: the server sends one entry per rating name (PG-13, 12, …). */
export function parentalRatingOptions(list: readonly { Name?: string | null; Value?: number | null }[]): { value: number | null; label: string }[] {
  const byValue = new Map<number, string[]>();
  for (const r of list) {
    if (r.Value == null || !r.Name) continue;
    const names = byValue.get(r.Value) ?? [];
    if (!names.includes(r.Name)) names.push(r.Name);
    byValue.set(r.Value, names);
  }
  const sorted = [...byValue.entries()].sort((a, b) => a[0] - b[0]);
  return [{ value: null, label: 'No limit' }, ...sorted.map(([value, names]) => ({ value, label: names.slice(0, 4).join(', ') }))];
}

// ---- Scheduled tasks ----------------------------------------------------------------

const TICKS_PER_MS = 10_000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * The next time a task runs, from its triggers. Startup triggers have no
 * time. Interval triggers count from the end of the last run (or now).
 * Times of day are local server times; the app uses the device clock, which
 * is correct when both are in the same time zone.
 */
export function nextRun(triggers: readonly TaskTriggerInfo[] | null | undefined, lastEnd: string | null | undefined, now: Date): Date | null {
  let best: number | null = null;
  const consider = (t: number) => {
    if (best === null || t < best) best = t;
  };
  for (const tr of triggers ?? []) {
    if (tr.Type === 'IntervalTrigger' && tr.IntervalTicks) {
      const every = tr.IntervalTicks / TICKS_PER_MS;
      const from = lastEnd ? Date.parse(lastEnd) : NaN;
      let at = Number.isFinite(from) ? from + every : now.getTime() + every;
      if (at < now.getTime()) at = now.getTime() + every - ((now.getTime() - at) % every);
      consider(at);
    } else if ((tr.Type === 'DailyTrigger' || tr.Type === 'WeeklyTrigger') && tr.TimeOfDayTicks != null) {
      const ms = tr.TimeOfDayTicks / TICKS_PER_MS;
      for (let add = 0; add <= 7; add++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, 0, 0, 0, 0);
        const at = d.getTime() + ms;
        if (at <= now.getTime()) continue;
        if (tr.Type === 'WeeklyTrigger' && DAYS[d.getDay()] !== tr.DayOfWeek) continue;
        consider(at);
        break;
      }
    }
  }
  return best === null ? null : new Date(best);
}

export type TaskTone = 'running' | 'ok' | 'failed' | 'cancelled' | 'never';

/** The state of a task for its badge and the result line. */
export function taskStatus(t: TaskInfo): { tone: TaskTone; label: string } {
  if (t.State === 'Running') return { tone: 'running', label: t.CurrentProgressPercentage != null ? `Running · ${Math.round(t.CurrentProgressPercentage)} %` : 'Running' };
  if (t.State === 'Cancelling') return { tone: 'running', label: 'Stopping' };
  const r = t.LastExecutionResult;
  if (!r?.Status) return { tone: 'never', label: 'Not run yet' };
  if (r.Status === 'Completed') return { tone: 'ok', label: 'Completed' };
  if (r.Status === 'Failed') return { tone: 'failed', label: 'Failed' };
  return { tone: 'cancelled', label: r.Status === 'Aborted' ? 'Aborted' : 'Cancelled' };
}

/** Visible tasks grouped by category, in name order. */
export function groupTasks(list: readonly TaskInfo[]): { category: string; tasks: TaskInfo[] }[] {
  const map = new Map<string, TaskInfo[]>();
  for (const t of list) {
    if (t.IsHidden) continue;
    const cat = t.Category || 'Other';
    map.set(cat, [...(map.get(cat) ?? []), t]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, tasks]) => ({ category, tasks: tasks.sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? '')) }));
}

/** The key of the "Scan media library" task that "Scan all libraries" starts. */
export const LIBRARY_SCAN_TASK_KEY = 'RefreshLibrary';

// ---- Activity log -----------------------------------------------------------------

export type ActivityFilter = 'all' | 'signins' | 'playback' | 'errors';

export const ACTIVITY_FILTERS: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'signins', label: 'Sign-ins' },
  { value: 'playback', label: 'Playback' },
  { value: 'errors', label: 'Errors' },
];

const SIGN_IN_TYPES = new Set(['AuthenticationSucceeded', 'AuthenticationFailed', 'SessionStarted', 'SessionEnded', 'UserLockedOut']);
const PLAYBACK_TYPES = new Set(['VideoPlayback', 'VideoPlaybackStopped', 'AudioPlayback', 'AudioPlaybackStopped']);
const ERROR_LEVELS = new Set(['Warning', 'Error', 'Critical']);

export function activityMatches(e: ActivityLogEntry, filter: ActivityFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'signins':
      return SIGN_IN_TYPES.has(e.Type ?? '');
    case 'playback':
      return PLAYBACK_TYPES.has(e.Type ?? '');
    case 'errors':
      return ERROR_LEVELS.has(e.Severity ?? '') || /Failed|Failure|LockedOut/.test(e.Type ?? '');
  }
}

export const ACTIVITY_PAGE_SIZE = 50;

/** The start index of the next page, or undefined at the end of the log. */
export function nextActivityStart(pages: readonly { startIndex: number; count: number; total: number }[]): number | undefined {
  const last = pages[pages.length - 1];
  if (!last) return 0;
  const next = last.startIndex + last.count;
  return last.count > 0 && next < last.total ? next : undefined;
}

// ---- Server log files -------------------------------------------------------------

export const LOG_CHUNK_BYTES = 256 * 1024;

/** Reads "bytes 0-1023/52000". Null when the header is missing or not valid. */
export function parseContentRange(header: string | null | undefined): { start: number; end: number; total: number | null } | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec((header ?? '').trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) };
}

/** The byte range of the next chunk, or null when the file is loaded. */
export function nextLogRange(loadedBytes: number, totalBytes: number | null, chunk = LOG_CHUNK_BYTES): { start: number; end: number } | null {
  if (totalBytes !== null && loadedBytes >= totalBytes) return null;
  const end = loadedBytes + chunk - 1;
  return { start: loadedBytes, end: totalBytes !== null ? Math.min(end, totalBytes - 1) : end };
}

/**
 * Adds a chunk of text to the lines that are loaded. A chunk can stop in the
 * middle of a line: that part stays in `carry` until the next chunk (or the
 * end of the file) completes it.
 */
export function appendLogChunk(state: { lines: string[]; carry: string }, text: string, done: boolean): { lines: string[]; carry: string } {
  const all = (state.carry + text).replace(/\r\n/g, '\n').split('\n');
  const carry = done ? '' : (all.pop() ?? '');
  const add = done && all.length > 0 && all[all.length - 1] === '' ? all.slice(0, -1) : all;
  return { lines: state.lines.concat(add), carry };
}

/** Line numbers (0-based) that contain the search text, ignoring case. */
export function searchLines(lines: readonly string[], query: string, max = 2000): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (lines[i].toLowerCase().includes(q)) out.push(i);
  }
  return out;
}

/** The severity of a Jellyfin log line ("[12:00:01] [ERR] …"), for its colour. */
export function logLineLevel(line: string): 'error' | 'warning' | null {
  if (/\[(ERR|FTL|CRT)\]/.test(line)) return 'error';
  if (/\[WRN\]/.test(line)) return 'warning';
  return null;
}

// ---- Dashboard --------------------------------------------------------------------

/** "3 h 12 min", "4 days". */
export function formatSince(fromIso: string | null | undefined, now: Date): string | null {
  const t = Date.parse(fromIso ?? '');
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  return new Date(t).toLocaleDateString();
}

/** "In 3 h", "In 12 min", "Tomorrow 03:00" style label for a future time. */
export function formatUntil(at: Date | null, now: Date): string | null {
  if (!at) return null;
  const s = Math.round((at.getTime() - now.getTime()) / 1000);
  if (s <= 60) return 'In less than a minute';
  const m = Math.round(s / 60);
  if (m < 60) return `In ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `In ${h} h`;
  const d = Math.round(h / 24);
  return `In ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Disk sizes: "966 GB", "8.1 TB". Decimal units, the same as `formatBytes`. */
export function formatDiskSize(bytes: number | null | undefined): string {
  const b = Math.max(0, bytes ?? 0);
  if (b >= 1e12) return `${(b / 1e12).toFixed(b < 1e13 ? 1 : 0)} TB`;
  if (b >= 1e9) return `${Math.round(b / 1e9)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

/** The share of a disk that is used, 0–1, or null when the server does not say. */
export function usedShare(used: number | null | undefined, free: number | null | undefined): number | null {
  if (used == null || free == null || used < 0 || free < 0 || used + free === 0) return null;
  return used / (used + free);
}

/** The web dashboard of a server, for the jobs that the app does not do. */
export function webDashboardUrl(serverUrl: string, page = 'dashboard'): string {
  return `${serverUrl.replace(/\/+$/, '')}/web/#/${page}`;
}

/**
 * The draft after the loaded policy changes (a refetch, the "Account enabled"
 * switch, a save). Unsaved edits stay: each field the user changed against the
 * policy loaded before keeps the user's value; every other field takes the new
 * loaded value. With no edits, or after the user's own save, the draft starts
 * again from the new policy. Null when no policy is loaded.
 */
export function rebaseDraft(before: UserPolicy | undefined, after: UserPolicy | undefined, draft: PolicyEdits | null, ownSave: boolean): PolicyEdits | null {
  if (!after) return null;
  const fresh = draftFrom(after);
  if (!before || !draft || ownSave) return fresh;
  const out: Record<string, unknown> = { ...fresh };
  for (const k of policyDiff(before, draft)) out[k] = draft[k];
  return out as PolicyEdits;
}

// ---- Actions in flight --------------------------------------------------------------

/**
 * Adds `id` to the actions in flight. Null when that action already runs, so a
 * second tap never runs it twice. Other ids run side by side.
 */
export function startAction(inFlight: ReadonlySet<string>, id: string): ReadonlySet<string> | null {
  if (inFlight.has(id)) return null;
  return new Set(inFlight).add(id);
}

/** Removes `id` when its action ends. The other actions keep their spinner. */
export function endAction(inFlight: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!inFlight.has(id)) return inFlight;
  const next = new Set(inFlight);
  next.delete(id);
  return next;
}
