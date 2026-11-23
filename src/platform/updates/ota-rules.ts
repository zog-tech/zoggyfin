/**
 * The rules of over-the-air updates around the state machine (pure, so it is
 * unit-tested; no expo-updates, no React):
 *
 * - When to check: once a short time after start, when the app comes back to
 *   the foreground (at most every 30 minutes), and when the user asks.
 * - Which card shows: a new app (the TV APK updater, the desktop updater)
 *   includes every JavaScript update, so its card wins and the OTA card stays
 *   hidden while that app update is known.
 * - Playback: the OTA card stays quiet while video or audio plays or a player
 *   fills the screen, unless the user opened it. "Restart now" asks first
 *   while something plays.
 * - The message: the text the maintainer gave the update, shortened, with no
 *   links. It comes from the update manifest (see `otaMessage`).
 */
import type { UpdateState } from './machine';

/** The first automatic check waits this long after start (the first screen loads first). */
export const OTA_FIRST_CHECK_MS = 5_000;
/** A check on return to the foreground waits at least this long after the last check. */
export const OTA_FOREGROUND_GAP_MS = 30 * 60 * 1000;
/** TV: "Snooze" hides the ready popup for this long; then it shows again. */
export const OTA_SNOOZE_MS = 60 * 60 * 1000;
/** The card shows at most this many characters of the update message. */
export const OTA_MESSAGE_MAX = 120;

export type OtaCheckReason = 'start' | 'foreground' | 'manual';

/**
 * True when a check may start now. `lastCheckAt`: the start time of the last
 * check (ms since 1970), or null. A manual check and the start check always run.
 */
export function shouldCheckOta(reason: OtaCheckReason, lastCheckAt: number | null, now: number): boolean {
  if (reason !== 'foreground') return true;
  if (lastCheckAt === null) return true;
  return now - lastCheckAt >= OTA_FOREGROUND_GAP_MS;
}

export interface Playback {
  /** Video or audio plays now. */
  playing: boolean;
  /** The full-screen video player or the music player is open. */
  playerOpen: boolean;
}

/** True when playback must not be disturbed: something plays, or a player fills the screen. */
export const playbackActive = (p: Playback): boolean => p.playing || p.playerOpen;

export type UpdateCardChoice = 'app' | 'ota' | null;

/**
 * The one card that shows. `app` and `ota` are null where that kind of update
 * does not work (web, development builds and so on).
 */
export function chooseUpdateCard(app: UpdateState | null, ota: UpdateState | null, playback: Playback): UpdateCardChoice {
  if (app?.open) return 'app';
  if (!ota?.open) return null;
  // A new app is known: it includes this update. One card only.
  if (app?.offer) return null;
  if (!ota.manual && playbackActive(playback)) return null;
  return 'ota';
}

/** True when a new app is known: the OTA card and the OTA row stay hidden. */
export function otaShadowed(app: UpdateState | null): boolean {
  return app?.offer != null;
}

/** "Restart now" asks first when something plays. */
export const restartNeedsConfirm = (playback: Playback): boolean => playback.playing;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

/** One short plain line from a free text: no Markdown marks, no links, at most `max` characters. */
export function shortMessage(text: unknown, max: number = OTA_MESSAGE_MAX): string | null {
  if (typeof text !== 'string') return null;
  let line = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(URL_RE, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  line = line.replace(/^[-–•\s:,;]+|[\s:,;(–-]+$/g, '').trim();
  if (!line) return null;
  if (line.length > max) line = `${line.slice(0, max - 1).trimEnd()}…`;
  return line;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The message of an update, from its manifest. EAS does not put the
 * `eas update --message` text in the manifest, so the publish sets it in the
 * app config too: `ZOGGYFIN_UPDATE_MESSAGE` becomes `extra.updateMessage`
 * (app.config.ts), which the manifest carries in `extra.expoClient.extra`.
 * A self-hosted update server can put `message` in `metadata`.
 */
export function otaMessage(manifest: unknown): string | null {
  const m = record(manifest);
  if (!m) return null;
  const metadata = record(m.metadata);
  const fromMetadata = shortMessage(metadata?.message) ?? shortMessage(metadata?.updateMessage);
  if (fromMetadata) return fromMetadata;
  const client = record(record(m.extra)?.expoClient);
  return shortMessage(record(client?.extra)?.updateMessage);
}

/** The ID and the date of an update, from its manifest. */
export function otaManifestInfo(manifest: unknown): { id: string | null; date: string | null } {
  const m = record(manifest);
  const id = typeof m?.id === 'string' && m.id ? m.id : null;
  const date = typeof m?.createdAt === 'string' ? m.createdAt : null;
  return { id, date };
}
