/**
 * The tabs of an extension page (`tabs` in the manifest).
 *
 * Rules:
 * - The page opens on the tab the user chose last on this page in this
 *   session (memory only), else on the first tab. A remembered tab that the
 *   page no longer has gives the first tab.
 * - A tab uses its own `search`, else the page's `search`, else none.
 * - The pager mounts a tab on its first visit and keeps it mounted, so each
 *   tab keeps its scroll position and its loaded feeds while the user
 *   switches (TV shows the selected tab only: its feeds come from the cache).
 *
 * Pure, so it is unit-tested.
 */
import type { PageSpec, SearchSpec, TabSpec } from '@/extensions/schema';

const lastTab = new Map<string, string>();

function pageKey(extId: string, pageId: string): string {
  return `${extId}\u0000${pageId}`;
}

/** Remembers the tab the user chose on a page, for this session. */
export function rememberTab(extId: string, pageId: string, tabId: string): void {
  lastTab.set(pageKey(extId, pageId), tabId);
}

/** The index of the tab a page opens on. */
export function initialTabIndex(tabs: readonly Pick<TabSpec, 'id'>[], extId: string, pageId: string): number {
  const id = lastTab.get(pageKey(extId, pageId));
  return Math.max(0, tabs.findIndex((t) => t.id === id));
}

/** The search of a tab: its own, else the page's. */
export function tabSearch(tab: Pick<TabSpec, 'search'>, page: Pick<PageSpec, 'search'>): SearchSpec | undefined {
  return tab.search ?? page.search;
}

type TabListener = (extId: string, pageId: string, tabId: string) => void;
const listeners = new Set<TabListener>();

/**
 * Asks a page to show a tab (a panel's `openPage` with `tab`): remembers it,
 * so a page that opens next starts there, and tells the open pages.
 */
export function requestTab(extId: string, pageId: string, tabId: string): void {
  rememberTab(extId, pageId, tabId);
  listeners.forEach((fn) => fn(extId, pageId, tabId));
}

/** Calls `fn` for each tab request. Returns a stop function. */
export function onTabRequest(fn: TabListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For tests: forgets every remembered tab. */
export function resetRememberedTabs(): void {
  lastTab.clear();
}
