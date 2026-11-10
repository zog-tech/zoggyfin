/**
 * Feed hooks for extension sections and searches. One `useInfiniteQuery`
 * per feed, keyed under the session scope (`feeds/paging.ts`).
 *
 * - A row shows the first page only. A grid and a list call `loadMore`
 *   near their end, up to the page cap.
 * - `refreshSeconds` loads the feed again on that interval.
 * - Entries with a Jellyfin `itemId` are resolved to items in one request
 *   per page, as the Home row did. An item that does not load leaves the
 *   entry as a plain card when it has a title, else it is left out.
 * - A feed's `message` and `action` (why it is empty, and a button that
 *   opens a panel of the same extension) come from its first page. An
 *   action whose panel the manifest does not have is left out.
 * - A search waits `SEARCH_DEBOUNCE_MS` after the last key press and runs
 *   under a latest-wins gate: a late reply of an older search is dropped
 *   and never shown.
 */
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { createGate } from '@/lib/async-gate';
import { useDebounced } from '@/lib/use-debounced';

import { type FeedAction, type FeedEntry, feedQueryKey, fetchFeedPage, flattenPages, isCapped, latestOnly, type LoadedPage, nextCursor, normalizeQuery, SEARCH_DEBOUNCE_MS, StaleSearchError } from '../feeds';
import { buildRequest } from '../http';
import { currentAccount, templateContext } from '../runtime';
import { getExtension, useExtensions } from '../store';

/** One entry of a section, with its Jellyfin item when it names one. */
export interface FeedRow {
  entry: FeedEntry;
  item?: BaseItemDto;
}

type RowsPage = LoadedPage<FeedRow> & { message?: string; action?: FeedAction };

export type FeedStatus = 'loading' | 'error' | 'ready';

export interface FeedState {
  rows: FeedRow[];
  status: FeedStatus;
  error: unknown;
  /** More pages exist and the cap is not reached. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The page cap ended the feed early. */
  capped: boolean;
  /** Loads the next page (grids and lists). Does nothing when there is none or one loads. */
  loadMore: () => void;
  /** Loads the feed again. */
  refresh: () => Promise<unknown>;
  refreshing: boolean;
  /** The feed's own words for an empty feed (first page only). */
  message?: string;
  /** A button under `message` that opens a panel of the extension. */
  action?: FeedAction;
}

function rowsOf(entries: FeedEntry[], items: BaseItemDto[]): FeedRow[] {
  return entries
    .map((entry) => ({ entry, item: entry.itemId ? items.find((i) => i.Id === entry.itemId) : undefined }))
    .filter((r) => !!r.item || !!r.entry.title);
}

/** The feed source: the extension and its feed path. */
export interface FeedSource {
  extId: string;
  feed: string;
  refreshSeconds?: number;
}

function useFeedQuery(source: FeedSource | undefined, query: string | undefined, enabled: boolean, guard?: <T>(work: () => Promise<T>) => Promise<T>) {
  const { api, userId, scope } = useApi();
  const extEnabled = useExtensions((st) => !!source && !!st.list.find((e) => e.manifest.id === source.extId)?.enabled);
  return useInfiniteQuery<RowsPage, Error, InfiniteData<RowsPage, string | null>, readonly unknown[], string | null>({
    queryKey: feedQueryKey(scope, source?.extId ?? '', source?.feed ?? '', query),
    enabled: enabled && extEnabled && !!source,
    initialPageParam: null,
    getNextPageParam: (_last, all) => nextCursor(all),
    refetchInterval: source?.refreshSeconds ? source.refreshSeconds * 1000 : false,
    retry: (count, err) => !(err instanceof StaleSearchError) && count < 1,
    queryFn: async ({ pageParam }): Promise<RowsPage> => {
      const ext = source ? getExtension(source.extId) : undefined;
      if (!ext || !source) return { entries: [], next: null, cursor: pageParam };
      const load = async () => {
        const page = await fetchFeedPage(
          () => buildRequest(ext.manifest, { method: 'GET', path: source.feed }, templateContext(ext), ext.grants, currentAccount()),
          ext.manifest.baseUrl,
          { cursor: pageParam, query },
        );
        const ids = page.entries.map((e) => e.itemId).filter((x): x is string => !!x);
        let items: BaseItemDto[] = [];
        if (ids.length) {
          try {
            const res = await getLibraryApi(api).getItems({ userId, ids, fields: ['PrimaryImageAspectRatio'], enableImageTypes: ['Primary', 'Thumb', 'Backdrop'] });
            items = res.data.Items ?? [];
          } catch {
            items = [];
          }
        }
        const out: RowsPage = { entries: rowsOf(page.entries, items), next: page.next, cursor: pageParam };
        if (page.message) out.message = page.message;
        if (page.action && (ext.manifest.contributes.panels ?? []).some((p) => p.id === page.action?.panel)) out.action = page.action;
        return out;
      };
      return guard ? guard(load) : load();
    },
  });
}

function stateOf(q: ReturnType<typeof useFeedQuery>, paged: boolean): FeedState {
  const pages = q.data?.pages ?? [];
  const rows = flattenPages(paged ? pages : pages.slice(0, 1));
  const hasMore = paged && !!q.hasNextPage;
  const first = pages[0];
  return {
    ...(first?.message && !rows.length ? { message: first.message } : null),
    ...(first?.action && !rows.length ? { action: first.action } : null),
    rows,
    status: q.data ? 'ready' : q.error ? 'error' : 'loading',
    error: q.error,
    hasMore,
    loadingMore: q.isFetchingNextPage,
    capped: paged && isCapped(pages),
    loadMore: () => {
      if (hasMore && !q.isFetching) void q.fetchNextPage();
    },
    refresh: () => q.refetch(),
    refreshing: q.isRefetching && !q.isFetchingNextPage,
  };
}

/**
 * The entries of one section. `paged`: a grid or a list that loads more
 * pages; a row loads one page.
 */
export function useFeedSection(source: FeedSource | undefined, opts: { paged?: boolean; enabled?: boolean } = {}): FeedState {
  const q = useFeedQuery(source, undefined, opts.enabled ?? true);
  return stateOf(q, !!opts.paged);
}

/**
 * A search of a page's search feed. `text` is what the user typed; the
 * search starts after a pause. With no text, `query` is empty and nothing
 * loads.
 */
export function useFeedSearch(source: FeedSource | undefined, text: string): FeedState & { query: string } {
  const typed = normalizeQuery(text);
  const debounced = useDebounced(typed, SEARCH_DEBOUNCE_MS);
  // A cleared field ends the search at once; only new text waits.
  const query = typed ? debounced : '';
  const [gate] = useState(createGate);
  // A cleared search or a closed page: a reply still in flight is dropped.
  useEffect(() => {
    if (!query) gate.cancel();
  }, [gate, query]);
  useEffect(() => () => gate.cancel(), [gate]);
  const q = useFeedQuery(source, query, !!query, (work) => latestOnly(gate, work));
  return { ...stateOf(q, true), query };
}
