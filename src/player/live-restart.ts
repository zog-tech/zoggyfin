/**
 * When a live channel that already played fails (the provider sends broken or
 * late data, and the player stops with "stuck playing" or a decoder error),
 * the session starts the channel again by itself. It gives up after a few
 * restarts in a short time, so a channel that is really down shows its
 * message instead of looping.
 *
 * Pure, so it is unit-tested.
 */

/**
 * Restarts allowed within `LIVE_RESTART_WINDOW_MS` before the error shows.
 * The window is long because a panel that cuts the stream for another device
 * lets each new start play for a few seconds: the restarts come about 40 s
 * apart, and the user should then see the provider's reason, not a loop.
 */
export const LIVE_RESTART_LIMIT = 3;
export const LIVE_RESTART_WINDOW_MS = 300_000;

/**
 * A live stream that played and then waits for data this long counts as
 * failed. On iOS a provider that cuts the stream (an Xtream panel that answers
 * 509 when another device takes the account's only stream) leaves AVPlayer
 * paused with an empty buffer and no error: without this wait, the player
 * shows "buffering" for good.
 */
export const LIVE_STALL_MS = 15_000;

export interface LiveRestarts {
  /** The channel the restarts belong to. */
  key: string;
  /** The times of the recent restarts (ms). */
  times: readonly number[];
}

/**
 * Decides on a restart for a failed channel. Returns the new record when the
 * channel may restart, or null when the error must show.
 */
export function nextLiveRestart(prev: LiveRestarts | null, key: string, now: number): LiveRestarts | null {
  const recent = prev && prev.key === key ? prev.times.filter((t) => now - t < LIVE_RESTART_WINDOW_MS) : [];
  if (recent.length >= LIVE_RESTART_LIMIT) return null;
  return { key, times: [...recent, now] };
}
