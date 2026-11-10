/**
 * Where extension pages show outside Settings: the one `(ext)` tab slot,
 * tiles in the Library grid, and entries in the TV side menu. Home rows
 * (`placement.home`) are not decided here: they show on every platform.
 *
 * - The tab slot. There is one `(ext)` tab group, so at most one page fills
 *   it. The candidates are the pages with `placement.tab` of the enabled
 *   extensions. The page the user chose (`setTabPage`, synced through the
 *   account) wins; else the first candidate by install date.
 * - Phones (and Android tablets) already have five tabs: Android's bottom
 *   bar throws with a sixth visible tab, and iOS moves a sixth into "More".
 *   So the user chooses, per extension ("On this phone", the `phoneTab`
 *   field, synced to the account's other phones): a Library tile (the
 *   default, no field) or a tab in place of Music, Downloads, Search or
 *   Library. Home is never replaced. Exactly one tab hides when the page
 *   shows, so the bar keeps five (`hiddenTriggers`). The first enabled
 *   extension by install date with a choice and a tab-capable page wins
 *   (`choosePhoneTab` keeps one choice per account); its page is its chosen
 *   tab page, else its first. Every other tab-capable page is a Library
 *   tile on phones. A replaced tab's screens stay one tap away
 *   (`lib/tab-destination.ts`).
 * - The phone choice means nothing on iPad, the web, the Mac app and TV:
 *   they keep the rules below and ignore `phoneTab`.
 * - iPad, the web and the Mac app show the slot (a tab, or an item in the
 *   sidebar) when a page fills it.
 * - TV has no tab bar: the side menu gets an entry per page with
 *   `placement.tab` or `placement.library`, at most `TV_MENU_MAX`.
 * - The Library grid gets a tile per page with `placement.library` (on
 *   phones also per tab-capable page that is not the tab), on every
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
import { isReplaceableTab, type ReplaceableTab } from '@/lib/tab-destination';

import { pageIconName } from './icons';

/** The platform kinds that place pages differently. */
export type PlacementPlatform = 'phone' | 'tablet' | 'tv' | 'web' | 'desktop';

export type { ReplaceableTab } from '@/lib/tab-destination';

/** The "On this phone" choice of an extension: a Library tile, or a tab in place of one tab. */
export type PhoneTab = 'none' | `replace:${ReplaceableTab}`;

/** The most extension pages in the TV side menu. */
export const TV_MENU_MAX = 2;

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
export type PlacementExtension = Pick<InstalledExtension, 'manifest' | 'enabled' | 'installedAt' | 'tab' | 'phoneTab'>;

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

/** The page a phone shows as a tab, and the tab it takes the place of, or null (every tab-capable page is a tile). */
export function phoneTabPage(exts: readonly PlacementExtension[], env: { downloads: boolean } = { downloads: true }): { page: PlacedPage; replaces: ReplaceableTab } | null {
  const all = candidates(exts);
  const ordered = exts.filter((e) => e.enabled && isReplaceableTab(e.phoneTab)).sort((a, b) => a.installedAt - b.installedAt);
  for (const e of ordered) {
    const replaces = e.phoneTab as ReplaceableTab;
    // No Downloads tab to take the place of.
    if (replaces === '(saved)' && !env.downloads) continue;
    const own = all.filter((c) => c.tab && c.page.extId === e.manifest.id);
    const pick = own.find((c) => c.page.pageId === e.tab) ?? own[0];
    if (pick) return { page: pick.page, replaces };
  }
  return null;
}

/** Where each page shows on this platform. `downloads`: this device has a Downloads tab (phones do). */
export function placePages(platform: PlacementPlatform, exts: readonly PlacementExtension[], env: { downloads: boolean } = { downloads: true }): PagePlacement {
  const all = candidates(exts);
  if (!all.length) return NO_PLACEMENT;

  if (platform === 'phone') {
    const pick = phoneTabPage(exts, env);
    const tab = pick?.page ?? null;
    // The default: a tab-capable page is a Library tile.
    const library = all.filter((c) => (c.library || c.tab) && !same(c.page, tab)).map((c) => c.page);
    return { tab, replaces: pick?.replaces ?? null, library, tvMenu: [] };
  }

  const slot = tabSlotPage(exts);

  if (platform === 'tv') {
    const menu = slot ? [slot] : [];
    for (const c of all) {
      if (menu.length >= TV_MENU_MAX) break;
      if (!same(c.page, slot)) menu.push(c.page);
    }
    return { tab: null, replaces: null, library: [], tvMenu: menu };
  }

  // iPad, the web and the Mac app: the slot, and never a replaced tab (a phone's choice means nothing here).
  const tab = slot;
  const library = all.filter((c) => c.library && !same(c.page, tab)).map((c) => c.page);
  return { tab, replaces: null, library, tvMenu: [] };
}

/** The native tab triggers, in the order of the bar. */
export type TabTrigger = '(home)' | '(library)' | '(music)' | '(ext)' | '(live)' | '(saved)' | '(search)';

/**
 * Which tab triggers are hidden. On a phone the extension tab shows only in
 * place of one tab, so the bar never has more than five (Android throws on
 * a sixth). `liveTab`: Live TV is a tab (web, the Mac app).
 */
export function hiddenTriggers(p: Pick<PagePlacement, 'tab' | 'replaces'>, env: { downloads: boolean; liveTab: boolean }): Record<TabTrigger, boolean> {
  const r = p.tab ? p.replaces : null;
  return {
    '(home)': false,
    '(library)': r === '(library)',
    '(music)': r === '(music)',
    '(ext)': !p.tab,
    '(live)': !env.liveTab,
    '(saved)': !env.downloads || r === '(saved)',
    '(search)': r === '(search)',
  };
}

/** The "On this phone" choices, in the order the Settings sheet lists them. */
export function phoneTabChoices(env: { downloads: boolean }): { value: PhoneTab; label: string }[] {
  const out: { value: PhoneTab; label: string }[] = [
    { value: 'none', label: 'Library tile' },
    { value: 'replace:(music)', label: 'Tab in place of Music' },
  ];
  if (env.downloads) out.push({ value: 'replace:(saved)', label: 'Tab in place of Downloads' });
  out.push({ value: 'replace:(search)', label: 'Tab in place of Search' }, { value: 'replace:(library)', label: 'Tab in place of Library' });
  return out;
}

/** The choice an extension's row shows: a tab only when its page is the phone tab now. */
export function phoneTabValue(placement: Pick<PagePlacement, 'tab' | 'replaces'>, extId: string): PhoneTab {
  return placement.tab?.extId === extId && placement.replaces ? `replace:${placement.replaces}` : 'none';
}

/**
 * The `setPhoneTab` calls for one choice on one extension: the choice on
 * it, and no choice on every other extension that has one (one phone tab
 * per account).
 */
export function choosePhoneTab(exts: readonly Pick<InstalledExtension, 'manifest' | 'phoneTab'>[], extId: string, choice: PhoneTab): { extId: string; tab: ReplaceableTab | undefined }[] {
  const want = choice === 'none' ? undefined : (choice.slice('replace:'.length) as ReplaceableTab);
  const out: { extId: string; tab: ReplaceableTab | undefined }[] = [];
  for (const e of exts) {
    if (e.manifest.id === extId) {
      if (e.phoneTab !== want) out.push({ extId, tab: want });
    } else if (want && e.phoneTab !== undefined) out.push({ extId: e.manifest.id, tab: undefined });
  }
  return out;
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
