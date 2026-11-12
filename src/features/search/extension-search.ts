/**
 * Extension results in the main Search tab: which search feeds of the
 * installed extensions run for a search, in what order, and when a search
 * runs at all.
 *
 * Rules:
 * - Only a `search` with `global: true` runs here: a page's own search, or
 *   a tab's search. Extensions that are turned off never search.
 * - Order: the extensions in the order of the account's list, then the
 *   pages in manifest order, then the page's search before its tabs'
 *   searches in tab order.
 * - One request per feed: a feed that two searches of one extension name
 *   runs once (the first one keeps its title and place).
 * - At most `MAX_GLOBAL_SEARCHES` feeds run, so many extensions cannot slow
 *   the screen or fill it.
 * - A section's title is the search's `title`, else the page title.
 * - The tiles take the shape of the first grid of the page (or the tab),
 *   else wide tiles, as the page's own search results do.
 * - A search runs only with 2 or more characters, online, with no genre,
 *   and with a filter chip that can hold films or shows (All, Movies,
 *   Shows). The text is sent as `normalizeQuery` makes it.
 *
 * Pure, so it is unit-tested.
 */
import { normalizeQuery } from '@/extensions/feeds/paging';
import { pagesOf, type PageSpec, type SearchSpec, type SectionSpec, type Shape } from '@/extensions/schema';
import type { InstalledExtension } from '@/extensions/types';

import type { SearchFilter } from './group-results';

/** The most extension searches the Search tab runs at once. */
export const MAX_GLOBAL_SEARCHES = 4;
/** The shortest text that runs extension searches (as for the server search). */
export const MIN_GLOBAL_QUERY = 2;
/** The filter chips under which extension results show. */
export const GLOBAL_SEARCH_FILTERS: readonly SearchFilter[] = ['all', 'movies', 'shows'];

/** One extension search feed that the Search tab runs. */
export interface GlobalSearch {
  /** Stable and unique: `<extId>:<feed>`. */
  key: string;
  extId: string;
  extensionName: string;
  feed: string;
  title: string;
  shape: Shape;
}

/** Search results use the shape of the first grid, else wide tiles (`page-screen.tsx`). */
function shapeOf(sections: readonly SectionSpec[]): Shape {
  return sections.find((s) => s.layout === 'grid')?.shape ?? 'thumb';
}

function searchesOfPage(page: PageSpec): { search: SearchSpec; sections: SectionSpec[] }[] {
  const out: { search: SearchSpec; sections: SectionSpec[] }[] = [];
  if (page.search) out.push({ search: page.search, sections: page.tabs?.find((t) => !t.search)?.sections ?? page.sections });
  for (const tab of page.tabs ?? []) if (tab.search) out.push({ search: tab.search, sections: tab.sections });
  return out;
}

/** The global search feeds of the enabled extensions, in order, at most `max`. */
export function globalSearches(list: readonly InstalledExtension[], max = MAX_GLOBAL_SEARCHES): GlobalSearch[] {
  const out: GlobalSearch[] = [];
  const seen = new Set<string>();
  for (const ext of list) {
    if (!ext.enabled) continue;
    const m = ext.manifest;
    for (const page of pagesOf(m)) {
      for (const { search, sections } of searchesOfPage(page)) {
        if (search.global !== true) continue;
        const key = `${m.id}:${search.feed}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, extId: m.id, extensionName: m.name, feed: search.feed, title: search.title?.trim() || page.title, shape: shapeOf(sections) });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * The text the extension searches get, or '' when they do not run (too
 * short, offline, a genre is chosen, or a filter such as Music or People).
 */
export function globalSearchQuery(term: string, opts: { offline: boolean; genre: string | null; filter: SearchFilter }): string {
  if (opts.offline || opts.genre || !GLOBAL_SEARCH_FILTERS.includes(opts.filter)) return '';
  const q = normalizeQuery(term);
  return q.length >= MIN_GLOBAL_QUERY ? q : '';
}

export type GlobalSectionView = 'hidden' | 'loading' | 'rows';

/**
 * What one extension section shows: a small loading line while its first
 * reply is out, its row when it has entries. Empty and failed replies take
 * no room: the Search tab stays quiet about an extension that is down.
 */
export function globalSectionView(state: { status: 'loading' | 'error' | 'ready'; count: number }): GlobalSectionView {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'ready' && state.count > 0) return 'rows';
  return 'hidden';
}
