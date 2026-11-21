/**
 * A start that the app asked for and that has given no sound yet.
 *
 * A catalog song (`catalog.ts`) is not on the server's disk: its first
 * request waits while the server fetches the file. On iOS the player can sit
 * paused with the track ready once the answer comes, so the song did not
 * start until the user pressed play. The engine watches each start: when the
 * track is ready but neither plays nor buffers, it plays again, a few times
 * at most. A track that played once is no longer watched, so a later pause
 * (a call, the lock screen) is never undone. Pure, so it is unit-tested.
 */

/** How long a ready, silent track waits before the engine plays it again. */
export const START_KICK_DELAY_MS = 800;
/** Plays again at most this often per start. */
export const START_MAX_KICKS = 3;
/** A start that never gave sound is no longer watched after this. */
export const START_WATCH_MS = 3 * 60_000;

export interface StartWatch {
  /** The engine load the start belongs to. */
  token: number;
  /** Plays sent again so far. */
  kicks: number;
  /** When the app asked to play (ms). */
  since: number;
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
 * - `kick`: the track is ready and silent; play again after `START_KICK_DELAY_MS`.
 * - `wait`: still loading or buffering.
 */
export type StartVerdict = 'started' | 'give-up' | 'kick' | 'wait';

export function startVerdict(w: StartWatch, s: StartStatus, now: number): StartVerdict {
  if (s.playing && !s.buffering) return 'started';
  if (s.finished || w.kicks >= START_MAX_KICKS || now - w.since > START_WATCH_MS) return 'give-up';
  if (s.loaded && !s.playing && !s.buffering) return 'kick';
  return 'wait';
}
