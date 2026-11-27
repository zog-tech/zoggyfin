/**
 * A start that the app asked for and that has given no sound yet.
 *
 * A catalog song (`catalog.ts`) is not on the server's disk: its first
 * request waits while the server fetches the file. On iOS the player can sit
 * paused with the track ready once the answer comes, so the song did not
 * start until the user pressed play. The engine watches each start: when the
 * track is ready but neither plays nor buffers, it plays again, a few times
 * at most. A track that played once is no longer watched, so a later pause
 * (a call, the lock screen) is never undone.
 *
 * A ready track that stays "buffering" counts as stalled after
 * `START_STALL_KICK_MS`. The app sends play before the track is ready; on iOS
 * the AVQueuePlayer can then wait to play for a long time once the item is
 * ready (worse on a weak connection), and expo-audio sends no status while it
 * waits: its statuses come from the item turning ready and from a time
 * observer that runs only while the time moves. The last status said
 * "loaded, buffering", so the old rule waited for good, and the song started
 * only when the user pressed play again. The engine now checks on a timer
 * (`startCheckIn`) and plays again, as the user did. Pure, so it is unit-tested.
 */

/** How long a ready, silent track waits before the engine plays it again. */
export const START_KICK_DELAY_MS = 800;
/** Plays again at most this often per start. */
export const START_MAX_KICKS = 3;
/** A start that never gave sound is no longer watched after this. */
export const START_WATCH_MS = 3 * 60_000;
/** A ready track that still buffers with no sound is played again after this. */
export const START_STALL_KICK_MS = 3000;

export interface StartWatch {
  /** The engine load the start belongs to. */
  token: number;
  /** Plays sent again so far. */
  kicks: number;
  /** When the app asked to play (ms). */
  since: number;
  /** When the track was first seen ready, or when it was last played again (ms); null before. */
  readyAt?: number | null;
}

export interface StartStatus {
  playing: boolean;
  buffering: boolean;
  loaded: boolean;
  /** The last track ended. */
  finished: boolean;
}

/**
 * - `started`: sound came; stop watching.
 * - `give-up`: too many plays sent, too old, or the track ended; stop watching.
 * - `kick`: the track is ready and silent, or ready and still buffering for
 *   `START_STALL_KICK_MS`; play again after `START_KICK_DELAY_MS`.
 * - `wait`: still loading or buffering.
 */
export type StartVerdict = 'started' | 'give-up' | 'kick' | 'wait';

export function startVerdict(w: StartWatch, s: StartStatus, now: number): StartVerdict {
  if (s.playing && !s.buffering) return 'started';
  if (s.finished || w.kicks >= START_MAX_KICKS || now - w.since > START_WATCH_MS) return 'give-up';
  if (s.loaded && !s.playing && !s.buffering) return 'kick';
  if (stalled(w, s, now)) return 'kick';
  return 'wait';
}

function stalled(w: StartWatch, s: StartStatus, now: number): boolean {
  return s.loaded && s.buffering && !s.playing && w.readyAt != null && now - w.readyAt >= START_STALL_KICK_MS;
}

/**
 * When the engine should look at the start again (ms from now), or null when
 * nothing is due: it started, gave up, or still loads (the ready status will
 * come). A ready track that buffers gets a check when it would count as
 * stalled, because no status may come before then.
 */
export function startCheckIn(w: StartWatch, s: StartStatus, now: number): number | null {
  const verdict = startVerdict(w, s, now);
  if (verdict === 'kick') return START_KICK_DELAY_MS;
  if (verdict === 'wait' && s.loaded && s.buffering && !s.playing && w.readyAt != null) return Math.max(0, w.readyAt + START_STALL_KICK_MS - now);
  return null;
}
