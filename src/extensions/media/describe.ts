/**
 * The stream description (`GET media.playback`): what the player plays for
 * one media reference, and what it shows around it.
 *
 * Rules:
 * - `stream` then `alternatives` give the URLs to try, in order. Each one
 *   must be on the extension's origin; one on another origin is left out.
 *   When none is left, the reply is refused. The error holds no URL.
 * - `type` is `hls` or `file`. With no type, a URL whose path ends in
 *   `.m3u8` is `hls`, any other is `file`.
 * - `live: true` is a live stream: `duration` and `resume` are ignored.
 * - Qualities, subtitles, segments and chapters are read one by one; a bad
 *   one, or one on another origin, is left out. An id used twice keeps the
 *   first.
 * - Segment labels are free text (for example `intro`, `promo`). The
 *   manifest's `skipLabels` say what the player does with each one.
 *
 * Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { type FeedEntry, readEntry } from '../feeds/entry';
import { ExtensionError } from '../http';
import { urlOnOrigin } from '../match';

export const MAX_QUALITIES = 20;
export const MAX_SUBTITLES = 50;
export const MAX_SEGMENTS = 100;
export const MAX_CHAPTERS = 200;
export const MAX_ALTERNATIVES = 5;
export const REPORT_INTERVAL_DEFAULT = 10;

export type StreamType = 'hls' | 'file';

export interface StreamSource {
  /** A full URL on the extension's origin. */
  url: string;
  type: StreamType;
}

export interface StreamQuality {
  id: string;
  label: string;
  url: string;
}

export interface StreamSubtitle {
  id: string;
  label: string;
  language?: string;
  /** A WebVTT file on the extension's origin. */
  url: string;
}

export interface StreamSegment {
  label: string;
  /** Seconds. */
  start: number;
  end: number;
}

export interface StreamChapter {
  title: string;
  start: number;
}

export interface StreamReport {
  /** Where the app POSTs progress reports (`media/report.ts`). */
  url: string;
  intervalSeconds: number;
}

export interface StreamDescription {
  /** `streams[0]` is `stream`; the rest are the alternatives, in order. */
  streams: StreamSource[];
  live: boolean;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  /** Seconds. Never set for a live stream. */
  duration?: number;
  /** The position to start at, in seconds. Never set for a live stream. */
  resume?: number;
  qualities: StreamQuality[];
  subtitles: StreamSubtitle[];
  segments: StreamSegment[];
  chapters: StreamChapter[];
  /** The entry to play next. It always has `media.playback`. */
  next?: FeedEntry;
  report?: StreamReport;
}

const sourceSchema = z.object({ url: z.string().min(1).max(2000), type: z.enum(['hls', 'file']).optional() });
const qualitySchema = z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(80), url: z.string().min(1).max(2000) });
const subtitleSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  label: z.string().min(1).max(80),
  language: z.string().max(20).optional(),
  url: z.string().min(1).max(2000),
});
const segmentSchema = z
  .object({ label: z.string().trim().min(1).max(40), start: z.number().min(0), end: z.number().min(0) })
  .refine((s) => s.end > s.start, 'A segment ends after it starts');
const chapterSchema = z.object({ title: z.string().min(1).max(200), start: z.number().min(0) });
const reportSchema = z.object({ path: z.string().min(1).max(1000), intervalSeconds: z.number().min(5).max(300).optional() });

const shortText = z.string().min(1).max(200);
const imagePath = z.string().min(1).max(1000);
const seconds = z.number().min(0).max(1e7);

/** The value when it fits the schema, else undefined: one bad field never hides the rest. */
function pick<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const r = schema.safeParse(value);
  return r.success ? r.data : undefined;
}

function list(data: Record<string, unknown>, key: string, max: number): unknown[] {
  const v = data[key];
  return Array.isArray(v) ? v.slice(0, max) : [];
}

function guessType(url: string): StreamType {
  try {
    return /\.m3u8$/i.test(new URL(url).pathname) ? 'hls' : 'file';
  } catch {
    return 'file';
  }
}

function readSource(raw: unknown, baseUrl: string): StreamSource | null {
  const r = sourceSchema.safeParse(raw);
  if (!r.success) return null;
  const url = urlOnOrigin(baseUrl, r.data.url);
  return url ? { url, type: r.data.type ?? guessType(url) } : null;
}

const refused = () => new ExtensionError('The extension sent no stream the app can play.');

/** Reads a stream description. Throws `ExtensionError` (with no URL) when nothing is playable. */
export function parseStreamDescription(data: unknown, baseUrl: string): StreamDescription {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw refused();
  const d = data as Record<string, unknown>;

  const streams: StreamSource[] = [];
  for (const raw of [d.stream, ...list(d, 'alternatives', MAX_ALTERNATIVES)]) {
    const s = readSource(raw, baseUrl);
    if (s && !streams.some((x) => x.url === s.url)) streams.push(s);
  }
  if (!streams.length) throw refused();

  const live = d.live === true;
  const out: StreamDescription = { streams, live, qualities: [], subtitles: [], segments: [], chapters: [] };
  const title = pick(shortText, d.title);
  if (title) out.title = title;
  const subtitle = pick(shortText, d.subtitle);
  if (subtitle) out.subtitle = subtitle;
  const imageUrl = urlOnOrigin(baseUrl, pick(imagePath, d.image));
  if (imageUrl) out.imageUrl = imageUrl;
  const duration = pick(seconds, d.duration);
  if (!live && duration) out.duration = duration;
  // A resume point at or past the end would start on the last frame: start from the beginning.
  const resume = pick(seconds, d.resume);
  if (!live && resume !== undefined && (out.duration === undefined || resume < out.duration)) out.resume = resume;

  for (const raw of list(d, 'qualities', MAX_QUALITIES)) {
    const q = qualitySchema.safeParse(raw);
    const url = q.success ? urlOnOrigin(baseUrl, q.data.url) : undefined;
    if (q.success && url && !out.qualities.some((x) => x.id === q.data.id)) out.qualities.push({ id: q.data.id, label: q.data.label, url });
  }

  for (const [i, raw] of list(d, 'subtitles', MAX_SUBTITLES).entries()) {
    const s = subtitleSchema.safeParse(raw);
    const url = s.success ? urlOnOrigin(baseUrl, s.data.url) : undefined;
    if (!s.success || !url) continue;
    const sid = s.data.id ?? `${i}`;
    if (out.subtitles.some((x) => x.id === sid)) continue;
    const sub: StreamSubtitle = { id: sid, label: s.data.label, url };
    if (s.data.language) sub.language = s.data.language;
    out.subtitles.push(sub);
  }

  for (const raw of list(d, 'segments', MAX_SEGMENTS)) {
    const s = segmentSchema.safeParse(raw);
    if (s.success) out.segments.push(s.data);
  }
  out.segments.sort((a, b) => a.start - b.start);

  for (const raw of list(d, 'chapters', MAX_CHAPTERS)) {
    const c = chapterSchema.safeParse(raw);
    if (c.success) out.chapters.push(c.data);
  }
  out.chapters.sort((a, b) => a.start - b.start);

  if (d.next !== undefined) {
    const next = readEntry(d.next, 0, baseUrl);
    if (next?.media?.playback) out.next = next;
  }

  const report = reportSchema.safeParse(d.report);
  const reportUrl = report.success ? urlOnOrigin(baseUrl, report.data.path) : undefined;
  if (report.success && reportUrl) out.report = { url: reportUrl, intervalSeconds: report.data.intervalSeconds ?? REPORT_INTERVAL_DEFAULT };

  return out;
}
