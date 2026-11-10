/**
 * Paging rules for feeds: the request of one page, the cursor of the next,
 * the cap on loaded pages, the query keys and the latest-wins guard of a
 * search.
 *
 * Rules:
 * - The cursor and the search text are set on the URL after the request is
 *   built, so they are never read as templates (`{{...}}` in a cursor stays
 *   text) and never change the origin.
 * - A grid or a list loads at most `MAX_FEED_PAGES` pages (`MAX_FEED_PAGES`
 *   × 100 entries). Then the feed ends with a note, so a long feed cannot
 *   fill the memory.
 * - A cursor that the feed sent before ends the feed: a server that sends
 *   the same cursor again would make the app load pages for ever.
 * - Entries with a key seen on an earlier page are left out, so a feed that
 *   moved while the user scrolled does not show an entry twice.
 * - Query keys sit under the session scope (`['jf', serverId, userId]`), so
 *   two accounts never share feed data. A Home row and a page section with
 *   the same feed share one cache entry.
 *
 * Pure, so it is unit-tested.
 */
import { scopeKey, type SessionScope } from '@/api/query-keys';
import type { Gate } from '@/lib/async-gate';

import type { BuiltRequest } from '../http';
import type { FeedEntry } from './entry';

/** The most pages a grid or a list loads. */
export const MAX_FEED_PAGES = 20;
/** Wait this long after the last key press before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 300;
export const MAX_QUERY_LENGTH = 200;

export interface FeedParams {
  /** The cursor of the page; null or absent for the first page. */
  cursor?: string | null;
  /** The search text (search feeds only). */
  query?: string;
}

/** Adds `cursor` and `query` to a built feed request. Returns a new request. */
export function withFeedParams(req: BuiltRequest, params: FeedParams): BuiltRequest {
  const url = new URL(req.url);
  if (params.query !== undefined) url.searchParams.set('query', params.query);
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  return { ...req, url: url.toString() };
}

/** A loaded page with the cursor it was loaded with. */
export interface LoadedPage<T = FeedEntry> {
  entries: T[];
  next: string | null;
  /** The cursor this page was loaded with; null for the first page. */
  cursor: string | null;
}

/**
 * The cursor of the page after the last one, or undefined when the feed
 * ends: no `next`, the page cap, or a cursor the feed sent before.
 */
export function nextCursor(pages: readonly Pick<LoadedPage<unknown>, 'next' | 'cursor'>[]): string | undefined {
  const last = pages[pages.length - 1];
  if (!last?.next) return undefined;
  if (pages.length >= MAX_FEED_PAGES) return undefined;
  if (pages.some((p) => p.cursor === last.next)) return undefined;
  return last.next;
}

/** True when the feed has more pages that the cap does not load. */
export function isCapped(pages: readonly Pick<LoadedPage<unknown>, 'next' | 'cursor'>[]): boolean {
  return pages.length >= MAX_FEED_PAGES && !!pages[pages.length - 1]?.next;
}

/** All entries of the loaded pages in order, each key once (the first wins). */
export function flattenPages<T extends { entry: Pick<FeedEntry, 'key'> }>(pages: readonly { entries: readonly T[] }[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of pages) {
    for (const e of p.entries) {
      if (seen.has(e.entry.key)) continue;
      seen.add(e.entry.key);
      out.push(e);
    }
  }
  return out;
}

/** The key of all feeds of one extension (pull to refresh of its page). */
export function extensionFeedsKey(scope: SessionScope, extId: string) {
  return [...scopeKey(scope), 'ext-feed', extId] as const;
}

/**
 * The key of an entry's detail. Not under `extensionFeedsKey`: a reply's
 * `refresh: "page"` reloads the feeds, `"entry"` this key.
 */
export function entryDetailKey(scope: SessionScope, extId: string, detail: string) {
  return [...scopeKey(scope), 'ext-detail', extId, detail] as const;
}

/** The key of one feed, and of one search text for a search feed. */
export function feedQueryKey(scope: SessionScope, extId: string, feed: string, query?: string) {
  return [...extensionFeedsKey(scope, extId), feed, query ?? null] as const;
}

/** The search text as it is sent: trimmed and cut to the limit. Empty means no search. */
export function normalizeQuery(text: string): string {
  return text.trim().slice(0, MAX_QUERY_LENGTH);
}

/** A search reply that came after a newer search started. It is never shown. */
export class StaleSearchError extends Error {
  constructor() {
    super('A newer search replaced this one.');
    this.name = 'StaleSearchError';
  }
}

/**
 * Runs one search request under a latest-wins gate. The token is taken
 * before the request; when a newer search (or a clear) took a token while
 * it ran, the reply is dropped with `StaleSearchError`.
 */
export async function latestOnly<T>(gate: Gate, work: () => Promise<T>): Promise<T> {
  const token = gate.begin();
  const out = await work();
  if (!gate.current(token)) throw new StaleSearchError();
  return out;
}
