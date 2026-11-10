/**
 * Where a tab's screens live when an extension page takes the place of
 * that tab on a phone (`features/extensions/placement.ts`, "On this phone").
 *
 * - A replaced tab's trigger is hidden, so nothing may navigate into its
 *   stack. Its root screen opens in another stack instead:
 *   Music, Downloads and Search in the Library stack (`(library)/more/`,
 *   behind a tile in the Library grid), and the Library grid in the Home
 *   stack (`(home)/more/library`, behind a button in the Home header).
 *   Home can never be replaced, so the Library grid always has a home.
 * - The shared detail routes (`item/[id]` and the others) of a replaced tab
 *   open in that same other stack.
 * - With no replaced tab every answer is the tab's own route, as before.
 *
 * Every navigation to a tab root or into a tab's stack by name goes through
 * these functions (the I/O wrapper is `features/extensions/tab-nav.ts`).
 *
 * Pure, so it is unit-tested.
 */
import type { IconName } from '@/components/icon-names';

import type { TabGroup } from './navigation';

/** The phone tabs an extension page can take the place of. Home never. */
export type ReplaceableTab = '(library)' | '(music)' | '(saved)' | '(search)';

export const REPLACEABLE_TABS: readonly ReplaceableTab[] = ['(music)', '(saved)', '(search)', '(library)'];

export function isReplaceableTab(v: unknown): v is ReplaceableTab {
  return typeof v === 'string' && (REPLACEABLE_TABS as readonly string[]).includes(v);
}

/** A tab's first screen, by what it is. */
export type TabDestination = 'library' | 'music' | 'downloads' | 'search';

const GROUP_OF: Record<TabDestination, ReplaceableTab> = { library: '(library)', music: '(music)', downloads: '(saved)', search: '(search)' };
const ROOT_OF: Record<TabDestination, string> = { library: 'libraries', music: 'music', downloads: 'downloads', search: 'search' };
const DEST_OF: Record<ReplaceableTab, TabDestination> = { '(library)': 'library', '(music)': 'music', '(saved)': 'downloads', '(search)': 'search' };

/** The name and the icon of a tab (the tile or button that stands in for it). */
export const TAB_INFO: Record<ReplaceableTab, { title: string; icon: IconName }> = {
  '(library)': { title: 'Library', icon: 'square.stack' },
  '(music)': { title: 'Music', icon: 'music.note' },
  '(saved)': { title: 'Downloads', icon: 'arrow.down.circle' },
  '(search)': { title: 'Search', icon: 'magnifyingglass' },
};

export function destinationOf(tab: ReplaceableTab): TabDestination {
  return DEST_OF[tab];
}

/** The stack that holds the screens of a replaced tab: Library for Music, Downloads and Search; Home for Library. */
export function hostOf(tab: ReplaceableTab): '(home)' | '(library)' {
  return tab === '(library)' ? '(home)' : '(library)';
}

/** The route of a tab's first screen now (an `Href` string with groups). */
export function tabRootHref(dest: TabDestination, replaced: ReplaceableTab | null): string {
  const own = GROUP_OF[dest];
  if (replaced !== own) return `/(tabs)/${own}/${ROOT_OF[dest]}`;
  return `/(tabs)/${hostOf(own)}/more/${dest}`;
}

/** The stack to push a shared detail route into, for a page that belongs to `group`. */
export function tabGroupFor<G extends string>(group: G, replaced: ReplaceableTab | null): G | '(home)' | '(library)' {
  if (!replaced || group !== replaced) return group;
  return hostOf(replaced);
}

/** The tab group of a route's segments, or null outside the tabs. */
export function tabGroupOfSegments(segments: readonly string[]): TabGroup | '(ext)' | '(live)' | null {
  for (const s of segments) {
    if (s === '(home)' || s === '(library)' || s === '(music)' || s === '(search)' || s === '(saved)' || s === '(ext)' || s === '(live)') return s;
  }
  return null;
}

/**
 * A screen that is the root of `own` shows as a pushed page in another
 * stack (`more/`). Outside the tabs (the offline Downloads route) it stays a root.
 */
export function isPushedRoot(own: ReplaceableTab, segments: readonly string[]): boolean {
  const g = tabGroupOfSegments(segments);
  return g !== null && g !== own;
}

const stripGroups = (path: string) => path.replace(/\/\([^/)]*\)/g, '') || '/';

/**
 * A system path (a deep link, a typed URL) rewritten so it never lands in
 * a replaced tab: its root (`/downloads`, `/(tabs)/(saved)/downloads`)
 * goes to the new place, and a path inside its stack moves to the other
 * stack. Other paths pass unchanged.
 */
export function rewriteTabPath(link: string, replaced: ReplaceableTab | null): string {
  if (!replaced) return link;
  const path = pathOfLink(link);
  if (path === null) return link;
  const q = path.search(/[?#]/);
  const pathname = q < 0 ? path : path.slice(0, q);
  const rest = q < 0 ? '' : path.slice(q);
  const dest = DEST_OF[replaced];
  const plain = stripGroups(pathname).replace(/\/+$/, '');
  if (plain === `/${ROOT_OF[dest]}`) return stripGroups(tabRootHref(dest, replaced)) + rest;
  const prefix = `/(tabs)/${replaced}/`;
  if (pathname.startsWith(prefix)) return `/(tabs)/${hostOf(replaced)}/${pathname.slice(prefix.length)}${rest}`;
  return link;
}

/** The path of a link: `/x` as it is, `zoggyfin://x` and `https://host/x` as `/x`; null for anything else. */
function pathOfLink(link: string): string | null {
  if (link.startsWith('/')) return link;
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(link);
  if (!m) return null;
  const rest = m[2];
  if (/^https?$/i.test(m[1])) {
    const slash = rest.search(/[/?#]/);
    return slash < 0 ? '/' : rest[slash] === '/' ? rest.slice(slash) : `/${rest.slice(slash)}`;
  }
  // A custom scheme: what follows `://` is the path (`zoggyfin://downloads`).
  return `/${rest.replace(/^\/+/, '')}`;
}
