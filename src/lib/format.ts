import type { BaseItemDto } from '@/api/types';

const TICKS_PER_SECOND = 10_000_000;

export function ticksToSeconds(ticks: number | null | undefined): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0;
}

/** "2 h 8 min", "42 min" or "35 s" (brand voice: numbers, short units). */
export function formatDuration(ticks: number | null | undefined): string | null {
  const total = Math.round(ticksToSeconds(ticks));
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${total} s`;
}

/** "58 min left" for an item with a saved position, else null. */
export function remainingLabel(item: BaseItemDto): string | null {
  const pos = item.UserData?.PlaybackPositionTicks;
  const run = item.RunTimeTicks;
  if (!pos || !run || pos >= run) return null;
  const left = formatDuration(run - pos);
  return left ? `${left} left` : null;
}

/** "3:07" or "1:02:09", for track lengths. */
export function formatClock(ticks: number | null | undefined): string | null {
  const total = Math.round(ticksToSeconds(ticks));
  if (total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "12:34" or "1:02:03" from seconds (the length pill on a video tile). Null for no length. */
export function formatClockSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return formatClock(seconds * TICKS_PER_SECOND);
}

/** "12 min long", for a screen reader next to the length pill. Null for no length. */
export function lengthLabel(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const d = formatDuration(seconds * TICKS_PER_SECOND);
  return d ? `${d} long` : null;
}

/** "S1 · E4" style label for an episode, or null. */
export function episodeLabel(item: BaseItemDto): string | null {
  const s = item.ParentIndexNumber;
  const e = item.IndexNumber;
  if (s == null && e == null) return null;
  if (s == null) return `E${e}`;
  if (e == null) return `S${s}`;
  return `S${s} · E${e}`;
}

/** Played fraction 0..1 for a progress bar, or null when there is no progress. */
export function playedFraction(item: BaseItemDto): number | null {
  const pct = item.UserData?.PlayedPercentage;
  if (typeof pct === 'number' && pct > 0 && pct < 100) return pct / 100;
  const pos = item.UserData?.PlaybackPositionTicks;
  const run = item.RunTimeTicks;
  if (pos && run && pos > 0 && pos < run) return pos / run;
  return null;
}

/** A short line under a tile title: year, series name or artist. */
export function subtitleFor(item: BaseItemDto): string | null {
  switch (item.Type) {
    case 'Episode': {
      const label = episodeLabel(item);
      return [item.SeriesName, label].filter(Boolean).join(' · ') || null;
    }
    case 'Audio':
    case 'MusicAlbum':
      return item.AlbumArtist ?? item.Artists?.[0] ?? null;
    case 'Season':
      return item.SeriesName ?? null;
    case 'Series': {
      if (!item.ProductionYear) return null;
      const end = item.EndDate ? new Date(item.EndDate).getFullYear() : null;
      if (item.Status === 'Continuing') return `${item.ProductionYear} –`;
      return end && end !== item.ProductionYear ? `${item.ProductionYear} – ${end}` : String(item.ProductionYear);
    }
    default:
      return item.ProductionYear ? String(item.ProductionYear) : null;
  }
}

/** "812 MB", "1.4 GB", "640 KB" (brand voice: exact numbers, short units; 1 KB = 1000 bytes like iOS). */
export function formatBytes(bytes: number | null | undefined): string {
  const b = Math.max(0, bytes ?? 0);
  if (b < 1000) return `${Math.round(b)} B`;
  if (b < 1e6) return `${Math.round(b / 1e3)} KB`;
  if (b < 1e9) return `${b < 1e7 ? (b / 1e6).toFixed(1) : Math.round(b / 1e6)} MB`;
  return `${(b / 1e9).toFixed(b < 1e11 ? 1 : 0)} GB`;
}

/** "8.6 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** "1 min left", "2 h 5 min left", "a few seconds left". */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 45) return 'a few seconds left';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min left` : `${h} h left`;
}
