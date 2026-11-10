/**
 * One page of a feed: `{ "items": [...], "next": "<cursor>" }`.
 *
 * Rules:
 * - `next` is an opaque cursor, not a URL, so it needs no origin check. The
 *   app sends it back as `?cursor=`. No `next` (a v1 feed), null, an empty
 *   string or a value that is not a string means this is the last page.
 * - At most 100 entries per page. A reply with more, or with no `items`
 *   list, is not a feed and throws.
 * - Bad entries are left out one by one (`entry.ts`).
 *
 * Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { type FeedEntry, readEntry } from './entry';

export const MAX_FEED_ITEMS = 100;
export const MAX_CURSOR_LENGTH = 1000;

export const feedSchema = z.object({ items: z.array(z.unknown()).max(MAX_FEED_ITEMS) });

export interface FeedPage {
  entries: FeedEntry[];
  /** The cursor of the next page, or null on the last page. */
  next: string | null;
}

function readCursor(data: unknown): string | null {
  const next = (data as { next?: unknown }).next;
  return typeof next === 'string' && next.length > 0 && next.length <= MAX_CURSOR_LENGTH ? next : null;
}

/** Reads a feed page. Throws when the reply is not a feed; the error holds no URL. */
export function parseFeedPage(data: unknown, baseUrl: string): FeedPage {
  const r = feedSchema.safeParse(data);
  if (!r.success) throw new Error('The feed is not in the expected format.');
  const entries: FeedEntry[] = [];
  r.data.items.forEach((raw, i) => {
    const e = readEntry(raw, i, baseUrl);
    if (e) entries.push(e);
  });
  return { entries, next: readCursor(data) };
}

/**
 * Reads a feed as one list (a Home row). Entries that are not valid are left
 * out (one bad entry does not hide the row). Card images must be on the
 * extension's origin.
 */
export function parseFeed(data: unknown, baseUrl: string): FeedEntry[] {
  return parseFeedPage(data, baseUrl).entries;
}
