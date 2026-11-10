/**
 * Rules of the external path of the video session: titles from outside
 * Jellyfin (IPTV films and episodes, extension media). The session does the
 * I/O; this file decides the item it shows, the stream forms to try, where a
 * reload starts, which subtitle loader runs and what a progress report says.
 *
 * Rules:
 * - Error text never holds a URL: the engine's own text can hold the stream
 *   URL and the credentials in it.
 * - A quality choice tries its URL first, then the other stream forms.
 * - Subtitles of an external title never load through the Jellyfin client.
 *
 * Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

import type { PlaybackReport, ProgressEvent, ProgressTransport } from './progress-reporter';
import { secondsToTicks, ticksToSecondsExact } from './progress-reporter';
import type { SubtitleOption } from './stream';
import type { ExternalProgress, ExternalRef, ExternalReportEvent, ExternalSource, ExternalStream, ExternalSubtitle, LiveStreamChoice } from './types';

/** The id of the player's item for an external title. */
export function externalItemId(ref: ExternalRef, source: ExternalSource): string {
  return source.itemId?.(ref) ?? `iptv-vod:${source.providerId}:${ref.kind}:${ref.id}`;
}

/** The item the player screen, the mini player and the next-up card show for an external title. */
export function externalItem(ref: ExternalRef, source: ExternalSource): BaseItemDto {
  const item: BaseItemDto = { Id: externalItemId(ref, source), Name: ref.title, Type: ref.kind === 'episode' ? 'Episode' : 'Movie' };
  if (ref.kind === 'episode') {
    item.SeriesName = ref.seriesName;
    item.ParentIndexNumber = ref.season;
    item.IndexNumber = ref.episode;
  } else if (ref.year) item.ProductionYear = ref.year;
  if (ref.duration) item.RunTimeTicks = secondsToTicks(ref.duration);
  return item;
}

/** The line under the title on the lock screen: series and episode, the year, or the ref's own line. */
export function externalSubtitleLine(ref: ExternalRef): string | undefined {
  if (ref.kind === 'episode') {
    const se = ref.season !== undefined && ref.episode !== undefined ? `S${ref.season} E${ref.episode}` : null;
    return [ref.seriesName, se].filter(Boolean).join(' · ') || undefined;
  }
  if (ref.year) return String(ref.year);
  return ref.subtitle || undefined;
}

/** The ref with the better facts of the resolved stream (title, line, poster, duration). */
export function withStreamFacts(ref: ExternalRef, stream: ExternalStream): ExternalRef {
  const out: ExternalRef = { ...ref };
  if (stream.title) out.title = stream.title;
  if (stream.subtitle) out.subtitle = stream.subtitle;
  if (stream.artwork) out.poster = stream.artwork;
  if (stream.live) delete out.duration;
  else if (stream.duration) out.duration = stream.duration;
  return out;
}

/** The engine's error text when it holds no URL, else null. */
export function cleanStreamError(error: string | undefined | null): string | null {
  return error && !/https?:|\/\//i.test(error) ? error : null;
}

/**
 * The text after every stream form failed. A form that never started: the
 * source's reason (the format) comes first. One that played and stopped: the
 * player's reason. Never a URL.
 */
export function externalFailureText(input: { played: boolean; unsupported: string | null; error: string | undefined }): string {
  const clean = cleanStreamError(input.error);
  return (input.played ? clean : (input.unsupported ?? clean)) ?? 'This title could not be played.';
}

/**
 * The stream forms to try for a quality choice: the chosen URL first, then
 * the source's own forms (so a broken variant still plays). Null or an
 * unknown id: the source's forms as they are.
 */
export function qualityCandidates(stream: Pick<ExternalStream, 'candidates' | 'qualities'>, qualityId: string | null): LiveStreamChoice[] {
  const q = qualityId === null ? undefined : stream.qualities?.find((x) => x.id === qualityId);
  if (!q) return stream.candidates;
  return [{ url: q.url, isHls: q.isHls }, ...stream.candidates.filter((c) => c.url !== q.url)];
}

/**
 * Where a reload (another quality, the next stream form, Try again) starts:
 * where the title is now once it played, else where the load wanted to start.
 * A live stream always starts at the live edge.
 */
export function reloadPosition(input: { live: boolean; played: boolean; enginePosition: number; statePosition: number; attemptStart: number | null }): number {
  if (input.live) return 0;
  if (input.played) return Math.max(0, input.enginePosition || input.statePosition);
  return Math.max(0, input.attemptStart ?? input.statePosition);
}

/** The quality whose URL is the first stream form (the source's own "Auto" entry), or null. */
export function mainQualityId(stream: Pick<ExternalStream, 'candidates' | 'qualities'>): string | null {
  const first = stream.candidates[0]?.url;
  return (first && stream.qualities?.find((q) => q.url === first)?.id) || null;
}

/** Where the title starts: the request's position, else the stream's resume point, else 0. Live: 0. */
export function externalStart(requested: number | undefined, stream: Pick<ExternalStream, 'live' | 'resume'>): number {
  if (stream.live) return 0;
  return Math.max(0, requested ?? stream.resume ?? 0);
}

/** The subtitle choices of the player for an external title's WebVTT files. Index = position in the list. */
export function externalSubtitleOptions(subtitles: readonly ExternalSubtitle[] | undefined): SubtitleOption[] {
  return (subtitles ?? []).map((s, index) => ({
    index,
    label: s.label,
    language: s.language,
    isDefault: false,
    isForced: false,
    isText: true,
    url: s.url,
    isExternal: true,
  }));
}

/**
 * Which loader reads a subtitle file: a file on the device, the external
 * title's source (its own headers, never the Jellyfin token), or the
 * Jellyfin client for a Jellyfin item.
 */
export type SubtitleLoader = 'local' | 'source' | 'jellyfin';

export function subtitleLoader(url: string, external: boolean): SubtitleLoader {
  if (/^(file|asset):/.test(url)) return 'local';
  return external ? 'source' : 'jellyfin';
}

const EVENT: Record<ProgressEvent, ExternalReportEvent> = {
  TimeUpdate: 'progress',
  Pause: 'pause',
  Unpause: 'resume',
  Seek: 'seek',
  AudioTrackChange: 'progress',
  SubtitleTrackChange: 'progress',
  Background: 'progress',
};

/**
 * The `ProgressReporter` transport of an external title: it turns the
 * reporter's calls into the source's report events. The stop of a title
 * that played to the end is `finished`; `resume` follows only a `pause`.
 */
export function externalTransport(progress: ExternalProgress, facts: { duration: () => number; quality: () => string | null; ended: () => boolean }): ProgressTransport {
  const snap = (r: PlaybackReport) => ({
    position: ticksToSecondsExact(r.positionTicks),
    duration: facts.duration(),
    rate: r.playbackRate,
    quality: facts.quality(),
  });
  // The first "playing" after the start is not a resume: only a play after a pause is.
  let paused = false;
  return {
    start: (r) => {
      paused = false;
      return progress.send('start', snap(r));
    },
    progress: (r, event) => {
      if (event === 'Unpause' && !paused) return Promise.resolve();
      if (event === 'Pause') paused = true;
      if (event === 'Unpause') paused = false;
      return progress.send(EVENT[event], snap(r));
    },
    stopped: (r) => progress.send(facts.ended() ? 'finished' : 'stop', snap(r)),
  };
}
