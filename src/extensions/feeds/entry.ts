/**
 * One feed entry. An entry is a Jellyfin item (`itemId`) or a plain card
 * (title, subtitle, image, progress). A card opens, in this order: a
 * `detail` page, else plays `media`, else a `panel`, else a `link`.
 *
 * Rules:
 * - An entry whose v1 fields are not valid is left out; the other entries stay.
 * - A v2 field (`badge`, `detail`, `media`) that is not valid is left out on
 *   its own, so a v1 feed that carried another value under one of these
 *   names shows as it did before.
 * - Every URL must be on the extension's origin. A value on another origin
 *   is left out (the entry stays). `media` with no playback and no download
 *   URL left is left out.
 * - `link` is the one exception: an http(s) page that opens in the browser.
 *
 * Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { urlOnOrigin } from '../match';

export const MEDIA_KINDS = ['video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Something the app can play or save, as an extension writes it. */
export const mediaRefSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(MEDIA_KINDS).default('video'),
  /** Seconds. */
  duration: z.number().min(0).max(1e7).optional(),
  /** Answers with a stream description (`media/describe.ts`). */
  playback: z.string().min(1).max(1000).optional(),
  /** Answers with a download description (`media/download.ts`). */
  download: z.string().min(1).max(1000).optional(),
});

/** A media reference after the origin check: `playback` and `download` are full URLs on the origin. */
export interface MediaRef {
  id: string;
  kind: MediaKind;
  duration?: number;
  playback?: string;
  download?: string;
}

export const entrySchema = z
  .object({
    id: z.string().max(200).optional(),
    itemId: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(200).optional(),
    image: z.string().max(1000).optional(),
    /** 0 to 1: a bar on the card. */
    progress: z.number().min(0).max(1).optional(),
    /** An http(s) page to open in the browser. */
    link: z.string().max(1000).optional(),
    /** The id of one of the extension's panels to open. */
    panel: z.string().max(64).optional(),
  })
  .refine((e) => !!e.itemId || !!e.title, 'An entry needs an itemId or a title');

/** A short label on the card, for example "New". */
const badgeSchema = z.string().min(1).max(40);
/** Answers with a detail description (`feeds/detail.ts`). */
const detailSchema = z.string().min(1).max(1000);

/**
 * A feed entry after the checks. `image` is the value as sent; `imageUrl`,
 * `detail` and the `media` URLs are full URLs on the extension's origin.
 */
export type FeedEntry = z.infer<typeof entrySchema> & { key: string; imageUrl?: string; badge?: string; detail?: string; media?: MediaRef };

/** Reads a media reference and applies the origin rule. Null when nothing playable or savable is left. */
export function readMediaRef(raw: unknown, baseUrl: string): MediaRef | null {
  const r = mediaRefSchema.safeParse(raw);
  if (!r.success) return null;
  const playback = urlOnOrigin(baseUrl, r.data.playback);
  const download = urlOnOrigin(baseUrl, r.data.download);
  if (!playback && !download) return null;
  const out: MediaRef = { id: r.data.id, kind: r.data.kind };
  if (r.data.duration !== undefined) out.duration = r.data.duration;
  if (playback) out.playback = playback;
  if (download) out.download = download;
  return out;
}

/** Reads one entry. `index` is the key of an entry with no id. Null when the entry is not valid. */
export function readEntry(raw: unknown, index: number, baseUrl: string): FeedEntry | null {
  const e = entrySchema.safeParse(raw);
  if (!e.success) return null;
  const link = e.data.link && /^https?:\/\//i.test(e.data.link) ? e.data.link : undefined;
  const out: FeedEntry = { ...e.data, link, imageUrl: urlOnOrigin(baseUrl, e.data.image), key: e.data.id ?? e.data.itemId ?? `${index}` };
  const extra = raw as { badge?: unknown; detail?: unknown; media?: unknown };
  const badge = badgeSchema.safeParse(extra.badge);
  if (badge.success) out.badge = badge.data;
  const detailPath = detailSchema.safeParse(extra.detail);
  const detail = detailPath.success ? urlOnOrigin(baseUrl, detailPath.data) : undefined;
  if (detail) out.detail = detail;
  if (extra.media !== undefined) {
    const media = readMediaRef(extra.media, baseUrl);
    if (media) out.media = media;
  }
  return out;
}
