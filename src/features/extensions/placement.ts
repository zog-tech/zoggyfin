/**
 * Where extension pages show outside Settings: the one `(ext)` tab slot,
 * tiles in the Library grid, and entries in the TV side menu. Home rows
 * (`placement.home`) are not decided here: they show on every platform.
 *
 * - The tab slot. There is one `(ext)` tab group, so at most one page fills
 *   it. The candidates are the pages with `placement.tab` of the enabled
 *   extensions. The page the user chose (`setTabPage`, synced through the
 *   account) wins; else the first candidate by install date.
 * - Phones (and Android tablets) show no tab slot for now. They already
 *   have five tabs: Android's bottom bar throws with a sixth visible tab,
 *   and iOS moves a sixth into "More". `PHONE_TAB` is the one switch for a
 *   later decision ("replace:<tab>" shows the page in place of that tab).
 * - iPad, the web and the Mac app show the slot (a tab, or an item in the
 *   sidebar) when a page fills it.
 * - TV has no tab bar: the side menu gets an entry per page with
 *   `placement.tab` or `placement.library`, at most `TV_MENU_MAX`.
 * - The Library grid gets a tile per page with `placement.library`, on every
 *   platform but TV (TV has the side menu, as for Live TV). Like Live TV, a
 *   page that is a visible tab gets no tile as well.
 *
 * With no extension that asks for a place, every list is empty and the app
 * is as before.
 *
 * Pure, so it is unit-tested.
 */
import type { IconName } from '@/components/icon-names';
import { pagesOf } from '@/extensions/schema';
import type { InstalledExtension } from '@/extensions/types';

import { pageIconName } from './icons';

/** The platform kinds that place pages differently. */
export type PlacementPlatform = 'phone' | 'tablet' | 'tv' | 'web' | 'desktop';

/** The phone tabs a page could take the place of. */
export type ReplaceableTab = '(library)' | '(music)' | '(saved)' | '(search)';

/** What phones do with the tab slot: nothing, or show the page in place of one tab. */
export type PhoneTab = 'none' | `replace:${ReplaceableTab}`;

/** The phone rule until the maintainer decides (plan, open question 1). */
export const PHONE_TAB: PhoneTab = 'none';

/** The most extension pages in the TV side menu. */
export const TV_MENU_MAX = 2;

export interface PlacementOptions {
  phoneTab?: PhoneTab;
}

export interface PlacedPage {
  extId: string;
  pageId: string;
  title: string;
  /** The extension's name (the line under a Library tile). */
  extensionName: string;
  icon: IconName;
}

export interface PagePlacement {
  /** The page in the visible tab slot, or null when the slot is hidden. */
  tab: PlacedPage | null;
  /** On a phone with "replace:<tab>": the tab the page takes the place of. */
  replaces: ReplaceableTab | null;
  /** The Library tiles, in install order. */
  library: PlacedPage[];
  /** The TV side menu entries, the tab page first. */
  tvMenu: PlacedPage[];
}

/** The fields of an installed extension the rule reads. */
export type PlacementExtension = Pick<InstalledExtension, 'manifest' | 'enabled' | 'installedAt' | 'tab'>;

export const NO_PLACEMENT: PagePlacement = { tab: null, replaces: null, library: [], tvMenu: [] };

/** The platform kind from the platform facts. Android tablets count as phones: their bottom bar has the same five-tab limit. */
export function placementPlatform(env: { os: string; isPad: boolean; tv: boolean; desktop: boolean }): PlacementPlatform {
  if (env.tv) return 'tv';
  if (env.desktop) return 'desktop';
  if (env.os === 'web') return 'web';
  if (env.os === 'ios' && env.isPad) return 'tablet';
  return 'phone';
}

interface Candidate {
  page: PlacedPage;
  tab: boolean;
  library: boolean;
  chosen: boolean;
}

/** Every page of the enabled extensions that asks for a tab or a Library tile, in install order. */
function candidates(exts: readonly PlacementExtension[]): Candidate[] {
  const out: Candidate[] = [];
  const ordered = exts.filter((e) => e.enabled).sort((a, b) => a.installedAt - b.installedAt);
  for (const e of ordered) {
    for (const p of pagesOf(e.manifest)) {
      if (!p.placement.tab && !p.placement.library) continue;
      out.push({
        page: { extId: e.manifest.id, pageId: p.id, title: p.title, extensionName: e.manifest.name, icon: pageIconName(p.icon) },
        tab: p.placement.tab,
        library: p.placement.library,
        chosen: e.tab === p.id,
      });
    }
  }
  return out;
}

const same = (a: PlacedPage, b: PlacedPage | null) => !!b && a.extId === b.extId && a.pageId === b.pageId;

/** The page that fills the tab slot on any platform: the chosen one, else the first by install date. */
export function tabSlotPage(exts: readonly PlacementExtension[]): PlacedPage | null {
  const tabs = candidates(exts).filter((c) => c.tab);
  return (tabs.find((c) => c.chosen) ?? tabs[0])?.page ?? null;
}

/** Where each page shows on this platform. */
export function placePages(platform: PlacementPlatform, exts: readonly PlacementExtension[], options: PlacementOptions = {}): PagePlacement {
  const all = candidates(exts);
  if (!all.length) return NO_PLACEMENT;
  const slot = tabSlotPage(exts);

  if (platform === 'tv') {
    const menu = slot ? [slot] : [];
    for (const c of all) {
      if (menu.length >= TV_MENU_MAX) break;
      if (!same(c.page, slot)) menu.push(c.page);
    }
    return { tab: null, replaces: null, library: [], tvMenu: menu };
  }

  const phoneTab = options.phoneTab ?? PHONE_TAB;
  const replaces = platform === 'phone' && phoneTab !== 'none' ? (phoneTab.slice('replace:'.length) as ReplaceableTab) : null;
  const tab = platform === 'phone' && !replaces ? null : slot;
  const library = all.filter((c) => c.library && !same(c.page, tab)).map((c) => c.page);
  return { tab, replaces: tab ? replaces : null, library, tvMenu: [] };
}

/** The pages that may be chosen as the tab, of one extension (the Settings choice). */
export function tabPagesOf(ext: Pick<InstalledExtension, 'manifest'>): { id: string; title: string }[] {
  return pagesOf(ext.manifest)
    .filter((p) => p.placement.tab)
    .map((p) => ({ id: p.id, title: p.title }));
}

/** Every tab-capable page of the enabled extensions of the account. */
export function tabChoices(exts: readonly PlacementExtension[]): PlacedPage[] {
  return candidates(exts)
    .filter((c) => c.tab)
    .map((c) => c.page);
}

/** The Id of an extension page tile in the Library grid. Not a Jellyfin Id. */
export const PAGE_TILE_PREFIX = 'zoggyfin.ext:';

export function pageTileId(p: Pick<PlacedPage, 'extId' | 'pageId'>): string {
  return `${PAGE_TILE_PREFIX}${p.extId}:${p.pageId}`;
}

/**
 * The `setTabPage` calls that make one page the chosen tab page: that page
 * on its extension, and no choice on every other extension that has one
 * (one slot, so one choice per account).
 */
export function chooseTabPage(exts: readonly Pick<InstalledExtension, 'manifest' | 'tab'>[], extId: string, pageId: string): { extId: string; page: string | undefined }[] {
  const out: { extId: string; page: string | undefined }[] = [];
  for (const e of exts) {
    if (e.manifest.id === extId) {
      if (e.tab !== pageId) out.push({ extId, page: pageId });
    } else if (e.tab !== undefined) out.push({ extId: e.manifest.id, page: undefined });
  }
  return out;
}
