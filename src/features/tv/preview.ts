/**
 * TV Home previews: what to play when the focus rests on a title, like the
 * streaming apps. A preview is the title itself from a point past its
 * opening, played from the original file. Pure, so it is unit-tested; the
 * billboard (billboard.tsx) plays it.
 */
import type { BaseItemDto } from '@/api/types';

const TICKS_PER_SECOND = 10_000_000;

/** How long the focus rests on a title before its preview starts (after the billboard shows it). */
export const PREVIEW_DELAY_MS = 2000;
/** A preview plays this long, then the art comes back. */
export const PREVIEW_LENGTH_MS = 40_000;

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

/**
 * Where a preview starts, in seconds, or null when the item has none (not a
 * video, unknown or short length). 12 % in, past the opening titles, but at
 * least 1 and at most 15 minutes in.
 */
export function previewStart(item: Pick<BaseItemDto, 'Type' | 'RunTimeTicks'>): number | null {
  if (!item.Type || !PLAYABLE.has(item.Type)) return null;
  const length = (item.RunTimeTicks ?? 0) / TICKS_PER_SECOND;
  if (length < 5 * 60) return null;
  return Math.round(Math.min(15 * 60, Math.max(60, length * 0.12)));
}

/**
 * The address of a preview: the original file, as the server keeps it (no transcode, so the
 * server does no work and nothing has to be stopped after). The player seeks to the start point
 * itself with range requests. An HLS transcode started at the point made the server start over
 * while the player asked for the first segments, and the preview stalled.
 */
export function previewUrl(opts: { baseUrl: string; itemId: string; token: string }): string {
  const q = new URLSearchParams({ static: 'true', MediaSourceId: opts.itemId, ApiKey: opts.token });
  return `${opts.baseUrl.replace(/\/+$/, '')}/Videos/${encodeURIComponent(opts.itemId)}/stream?${q.toString()}`;
}
