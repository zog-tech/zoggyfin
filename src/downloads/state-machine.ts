/**
 * The download state machine. Pure: it takes a record and an event and
 * returns the next record. An event that does not apply to the current
 * state returns the same record object, so callers can test `next === prev`.
 *
 *   queued ──start──▶ downloading ──complete──▶ completed
 *     ▲  │              │   │
 *     │  └──pause──▶ paused ◀──pause──┘   │
 *     │                 │                  └──fail──▶ failed
 *     └────resume───────┘                              │
 *     └────────────retry / autoRetry───────────────────┘
 *   cancel: any state but completed ──▶ cancelled
 *   missing: completed, but the file is gone ──▶ failed (no automatic retry;
 *            a retry downloads it again)
 *
 * Extension media whose file the extension makes first:
 *   downloading / queued ──prepare──▶ preparing ──poll (at retryAt)──▶ queued
 *   preparing ──pause──▶ paused;  prepare after PREPARE_LIMIT_MS ──▶ failed
 *   (no automatic retry). `prepare.since` stays until the file is named or a
 *   retry by hand, so the limit counts the whole wait.
 */
import type { DownloadRecord, DownloadState } from './types';

/** The longest wait for an extension that prepares a file. */
export const PREPARE_LIMIT_MS = 30 * 60_000;

/** The shortest and the longest time between two asks while the extension prepares (seconds). */
export const PREPARE_RETRY_MIN_S = 2;
export const PREPARE_RETRY_MAX_S = 60;

/** The error when the extension prepares for longer than `PREPARE_LIMIT_MS`. */
export const PREPARE_TOO_LONG = 'The server took too long to prepare this file. Try again later';

export type DownloadEvent =
  | { type: 'start'; now: number }
  | { type: 'progress'; bytesDone: number; bytesTotal: number | null; now: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'complete'; bytes: number; now: number }
  | { type: 'fail'; error: string; now: number }
  | { type: 'retry' }
  | { type: 'autoRetry'; now: number }
  | { type: 'cancel' }
  | { type: 'missing' }
  /** The extension makes the file first: ask again after `retryAfter` seconds. */
  | { type: 'prepare'; progress: number | null; retryAfter: number; now: number }
  /** A preparing record's time to ask again has come. */
  | { type: 'poll'; now: number };

/** The error of a completed download whose file is gone. */
export const FILE_MISSING = 'The downloaded file is missing';

/** True for a record that was downloaded, but its file is gone. */
export function isFileMissing(r: Pick<DownloadRecord, 'state' | 'error'>): boolean {
  return r.state === 'failed' && r.error === FILE_MISSING;
}

/** Automatic retries after a failure. After that, the user retries by hand. */
export const MAX_AUTO_RETRIES = 4;

/** 15 s, 1 min, 4 min, 16 min: four times longer each time, at most 30 min. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(30 * 60_000, 15_000 * 4 ** (n - 1));
}

/** Weight of the newest sample in the speed average. */
const SPEED_WEIGHT = 0.3;

export function transition(r: DownloadRecord, e: DownloadEvent): DownloadRecord {
  switch (e.type) {
    case 'start':
      if (r.state !== 'queued') return r;
      return { ...r, state: 'downloading', error: null, retryAt: null, progressAt: e.now, speed: 0 };
    case 'progress': {
      if (r.state !== 'downloading') return r;
      const dt = r.progressAt !== null ? (e.now - r.progressAt) / 1000 : 0;
      const delta = e.bytesDone - r.bytesDone;
      let speed = r.speed;
      if (dt > 0.2 && delta >= 0) {
        const sample = delta / dt;
        speed = r.speed > 0 ? r.speed * (1 - SPEED_WEIGHT) + sample * SPEED_WEIGHT : sample;
      }
      const total = e.bytesTotal && e.bytesTotal > 0 ? e.bytesTotal : r.bytesTotal;
      return { ...r, bytesDone: Math.max(0, e.bytesDone), bytesTotal: total, speed, progressAt: e.now };
    }
    case 'pause': {
      if (r.state !== 'queued' && r.state !== 'downloading' && r.state !== 'preparing') return r;
      // A resume starts a new wait for the extension.
      const { prepare: _p, ...rest } = r;
      return { ...rest, state: 'paused', speed: 0, retryAt: null };
    }
    case 'resume':
      if (r.state !== 'paused') return r;
      return { ...r, state: 'queued' };
    case 'complete':
      if (r.state !== 'downloading' && r.state !== 'queued' && r.state !== 'paused') return r;
      return {
        ...r,
        state: 'completed',
        bytesDone: e.bytes,
        bytesTotal: e.bytes,
        speed: 0,
        attempts: 0,
        retryAt: null,
        error: null,
        completedAt: e.now,
      };
    case 'fail': {
      if (r.state !== 'downloading' && r.state !== 'queued') return r;
      const attempts = r.attempts + 1;
      return {
        ...r,
        state: 'failed',
        attempts,
        error: e.error,
        speed: 0,
        retryAt: attempts <= MAX_AUTO_RETRIES ? e.now + retryDelayMs(attempts) : null,
      };
    }
    case 'retry': {
      if (r.state !== 'failed') return r;
      const { prepare: _p, ...rest } = r;
      return { ...rest, state: 'queued', attempts: 0, retryAt: null, error: null };
    }
    case 'autoRetry':
      if (r.state !== 'failed' || r.retryAt === null || r.retryAt > e.now) return r;
      return { ...r, state: 'queued', retryAt: null };
    case 'cancel':
      if (r.state === 'completed' || r.state === 'cancelled') return r;
      return { ...r, state: 'cancelled', speed: 0 };
    case 'missing':
      if (r.state !== 'completed') return r;
      return { ...r, state: 'failed', error: FILE_MISSING, bytesDone: 0, speed: 0, attempts: 0, retryAt: null, completedAt: null, validator: null };
    case 'prepare': {
      if (r.state !== 'downloading' && r.state !== 'queued') return r;
      const since = r.prepare?.since ?? e.now;
      if (e.now - since >= PREPARE_LIMIT_MS) {
        const { prepare: _p, ...rest } = r;
        return { ...rest, state: 'failed', attempts: r.attempts + 1, error: PREPARE_TOO_LONG, speed: 0, retryAt: null };
      }
      const progress = e.progress === null ? null : Math.max(0, Math.min(1, e.progress));
      return { ...r, state: 'preparing', speed: 0, error: null, retryAt: e.now + clampRetryAfter(e.retryAfter) * 1000, prepare: { since, progress } };
    }
    case 'poll':
      if (r.state !== 'preparing' || (r.retryAt !== null && r.retryAt > e.now)) return r;
      return { ...r, state: 'queued', retryAt: null };
  }
}

/** Seconds until the next ask, kept between `PREPARE_RETRY_MIN_S` and `PREPARE_RETRY_MAX_S`. */
export function clampRetryAfter(seconds: number): number {
  if (!Number.isFinite(seconds)) return PREPARE_RETRY_MIN_S * 2;
  return Math.max(PREPARE_RETRY_MIN_S, Math.min(PREPARE_RETRY_MAX_S, seconds));
}

/** Preparing records whose time to ask again has come. */
export function dueForPoll(records: readonly DownloadRecord[], now: number): DownloadRecord[] {
  return records.filter((r) => r.state === 'preparing' && (r.retryAt === null || r.retryAt <= now));
}

/** States that still need work. */
export function isActive(state: DownloadState): boolean {
  return state === 'queued' || state === 'preparing' || state === 'downloading' || state === 'paused' || state === 'failed';
}

/**
 * Which queued records to start now: the oldest in queue order, until
 * `limit` records download at the same time.
 */
export function pickToStart(records: readonly DownloadRecord[], limit: number): DownloadRecord[] {
  const running = records.filter((r) => r.state === 'downloading').length;
  const free = Math.max(0, limit - running);
  if (!free) return [];
  return records
    .filter((r) => r.state === 'queued')
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .slice(0, free);
}

/** Failed records whose backoff has passed. */
export function dueForRetry(records: readonly DownloadRecord[], now: number): DownloadRecord[] {
  return records.filter((r) => r.state === 'failed' && r.retryAt !== null && r.retryAt <= now);
}

/** 0..1, or 0 when the size is not known yet. */
export function fraction(r: Pick<DownloadRecord, 'bytesDone' | 'bytesTotal' | 'state'>): number {
  if (r.state === 'completed') return 1;
  if (!r.bytesTotal || r.bytesTotal <= 0) return 0;
  return Math.max(0, Math.min(1, r.bytesDone / r.bytesTotal));
}

/** Seconds left at the current speed, or null when it cannot be known. */
export function etaSeconds(r: Pick<DownloadRecord, 'bytesDone' | 'bytesTotal' | 'speed'>): number | null {
  if (!r.bytesTotal || r.speed <= 0) return null;
  const left = r.bytesTotal - r.bytesDone;
  return left > 0 ? Math.round(left / r.speed) : 0;
}

/** Moves a record in the queue: `toIndex` in the list of active records ordered by `order`. */
export function reorder(records: readonly DownloadRecord[], itemId: string, toIndex: number): Record<string, number> {
  const active = records.filter((r) => isActive(r.state)).sort((a, b) => a.order - b.order);
  const from = active.findIndex((r) => r.itemId === itemId);
  if (from < 0) return {};
  const list = [...active];
  const [moved] = list.splice(from, 1);
  if (!moved) return {};
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, moved);
  const out: Record<string, number> = {};
  list.forEach((r, i) => {
    if (r.order !== i) out[r.itemId] = i;
  });
  return out;
}
