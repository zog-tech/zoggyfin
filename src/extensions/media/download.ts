/**
 * The download description (`GET media.download`): the one file the app
 * saves for a media reference, or the choices the user picks from first.
 *
 * Rules:
 * - One progressive file only: the downloader cannot save HLS, so a URL
 *   whose path ends in `.m3u8` is left out.
 * - Every URL must be on the extension's origin; one on another origin is
 *   left out. Subtitles and options are read one by one.
 * - A reply with no file and no option left is refused. The error holds no
 *   URL.
 *
 * Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { ExtensionError } from '../http';
import { urlOnOrigin } from '../match';

export const MAX_DOWNLOAD_OPTIONS = 10;
export const MAX_DOWNLOAD_SUBTITLES = 50;

export interface DownloadSubtitle {
  label: string;
  language?: string;
  url: string;
}

export interface DownloadOption {
  id: string;
  label: string;
  /** Answers with another download description, for this choice. */
  download: string;
}

export interface DownloadDescription {
  /** The file, a full URL on the extension's origin. Not set when only `options` came. */
  url?: string;
  bytes?: number;
  container?: string;
  label?: string;
  subtitles: DownloadSubtitle[];
  imageUrl?: string;
  options: DownloadOption[];
}

const subtitleSchema = z.object({ label: z.string().min(1).max(80), language: z.string().max(20).optional(), url: z.string().min(1).max(2000) });
const optionSchema = z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(80), download: z.string().min(1).max(2000) });

function fileUrl(baseUrl: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  const url = urlOnOrigin(baseUrl, value);
  if (!url) return undefined;
  return /\.m3u8$/i.test(new URL(url).pathname) ? undefined : url;
}

function list(d: Record<string, unknown>, key: string, max: number): unknown[] {
  const v = d[key];
  return Array.isArray(v) ? v.slice(0, max) : [];
}

const refused = () => new ExtensionError('The extension sent no file the app can save.');

/** Reads a download description. Throws `ExtensionError` (with no URL) when there is nothing to save. */
export function parseDownloadDescription(data: unknown, baseUrl: string): DownloadDescription {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw refused();
  const d = data as Record<string, unknown>;
  const out: DownloadDescription = { subtitles: [], options: [] };

  const url = fileUrl(baseUrl, d.url);
  if (url) {
    out.url = url;
    if (typeof d.bytes === 'number' && Number.isInteger(d.bytes) && d.bytes > 0) out.bytes = d.bytes;
    if (typeof d.container === 'string' && /^[a-z0-9]{1,10}$/i.test(d.container)) out.container = d.container.toLowerCase();
    if (typeof d.label === 'string' && d.label && d.label.length <= 80) out.label = d.label;
    for (const raw of list(d, 'subtitles', MAX_DOWNLOAD_SUBTITLES)) {
      const s = subtitleSchema.safeParse(raw);
      const sUrl = s.success ? urlOnOrigin(baseUrl, s.data.url) : undefined;
      if (!s.success || !sUrl) continue;
      const sub: DownloadSubtitle = { label: s.data.label, url: sUrl };
      if (s.data.language) sub.language = s.data.language;
      out.subtitles.push(sub);
    }
  }
  const imageUrl = typeof d.image === 'string' && d.image.length <= 1000 ? urlOnOrigin(baseUrl, d.image) : undefined;
  if (imageUrl) out.imageUrl = imageUrl;

  for (const raw of list(d, 'options', MAX_DOWNLOAD_OPTIONS)) {
    const o = optionSchema.safeParse(raw);
    const download = o.success ? urlOnOrigin(baseUrl, o.data.download) : undefined;
    if (o.success && download && !out.options.some((x) => x.id === o.data.id)) out.options.push({ id: o.data.id, label: o.data.label, download });
  }

  if (!out.url && !out.options.length) throw refused();
  return out;
}
