/**
 * What to do with a running download that gets no bytes. Pure, so it is
 * unit-tested; the manager runs it at each tick.
 *
 * - After 15 s without progress the row stops showing the last speed and
 *   the time left: the download waits, it does not run at that speed.
 * - iOS retries a lost connection by itself, but it waits longer after each
 *   failed try (30 minutes after a long outage), also when the server answers
 *   again. After 60 s without bytes, with the app in front and the server
 *   reachable, the manager asks the engine to continue the task from its
 *   resume data now ("nudge"). At most once in 3 minutes per download, and
 *   only after bytes arrived (with none there is nothing to continue).
 */
import type { DownloadRecord } from './types';

export const QUIET_AFTER_MS = 15_000;
export const NUDGE_AFTER_MS = 60_000;
export const NUDGE_GAP_MS = 180_000;

export type StallAction = 'none' | 'quiet' | 'nudge';

export function stallAction(
  r: Pick<DownloadRecord, 'state' | 'progressAt' | 'speed' | 'bytesDone'>,
  now: number,
  opts: { canNudge: boolean; lastNudge?: number },
): StallAction {
  if (r.state !== 'downloading' || r.progressAt === null) return 'none';
  const idle = now - r.progressAt;
  const gapOk = opts.lastNudge === undefined || now - opts.lastNudge >= NUDGE_GAP_MS;
  if (opts.canNudge && r.bytesDone > 0 && idle >= NUDGE_AFTER_MS && gapOk) return 'nudge';
  if (idle >= QUIET_AFTER_MS && r.speed > 0) return 'quiet';
  return 'none';
}
