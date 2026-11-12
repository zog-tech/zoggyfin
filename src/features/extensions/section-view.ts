/**
 * What an extension section shows, and what a tap on an entry does.
 *
 * Sections:
 * - `row`: one horizontal row with the first page.
 * - The last grid or list of a page (or a section on its own screen) is
 *   `infinite`: it fills the rest of the screen and loads more near its end.
 * - A grid or list that is not last is a `preview`: its first entries and a
 *   "See all" that opens the section on its own screen. Two infinite lists
 *   on one screen cannot both load more.
 * - A section never blocks the screen. Loading shows a placeholder, a
 *   failure a short note with "Try again". On a page, an empty section keeps
 *   its title and says so (with the feed's `message` and `action` when it
 *   has them), so a section never vanishes without a word. On Home, loading
 *   and empty rows show nothing, as before.
 *
 * Tap order (docs/extensions.md): a Jellyfin item opens its page; else
 * `detail` opens the entry page; else `media` plays; else a `panel`; else a
 * `link`. TV has no panels: an entry that only opens a panel says so.
 *
 * Pure, so it is unit-tested.
 */
import type { PlainTileData } from '@/components/plain-tile';
import type { FeedEntry, MediaRef } from '@/extensions/feeds';
import type { Layout, SectionSpec } from '@/extensions/schema';

export type SectionMode = 'row' | 'preview' | 'infinite';

/** How the section at `index` of `sections` renders. */
export function sectionMode(sections: readonly Pick<SectionSpec, 'layout'>[], index: number): SectionMode {
  const layout: Layout = sections[index]?.layout ?? 'row';
  if (layout === 'row') return 'row';
  return index === sections.length - 1 ? 'infinite' : 'preview';
}

/** A list preview shows this many entries before "See all". */
export const LIST_PREVIEW = 5;

export type SectionBody = 'placeholder' | 'failed' | 'hidden' | 'empty' | 'entries';

/**
 * What a section draws for its feed state. `where`: a page, or Home (where a
 * row that loads or is empty takes no room).
 */
export type SectionPlace = 'page' | 'entry' | 'home';

/**
 * `entry`: an entry (detail) page. It shows loading and failed sections as a
 * page does, but an empty row or preview takes no room there (the "keep the
 * title, show the message" rule is for pages and page tabs only).
 */
export function sectionBody(state: { status: 'loading' | 'error' | 'ready'; count: number }, mode: SectionMode, where: SectionPlace): SectionBody {
  if (state.count > 0) return 'entries';
  if (state.status === 'error') return 'failed';
  if (state.status === 'loading') return where === 'home' ? 'hidden' : 'placeholder';
  if (where === 'page') return 'empty';
  return where === 'entry' && mode === 'infinite' ? 'empty' : 'hidden';
}

/** The text of an empty section: the feed's own message, else a plain note. */
export function emptyText(message: string | undefined): string {
  return message ?? 'Nothing here yet.';
}

/** The panel button under an empty section's message: only where panels exist (not on TV). */
export function emptyAction<A extends { panel: string }>(action: A | undefined, panels: boolean): A | null {
  return action && panels ? action : null;
}

/** The note of a section that did not load. */
export function failedText(extensionName: string): string {
  return `${extensionName} is not available now.`;
}

/** The plain tile of an entry. Its art glyph follows the media kind. */
/**
 * The length a tile shows on its art (seconds), or null: none for a live
 * entry (a `LIVE` badge), where a length means nothing, or for no length.
 */
export function entryLength(entry: Pick<FeedEntry, 'badge' | 'media'>): number | null {
  if (entry.badge && entry.badge.trim().toUpperCase() === 'LIVE') return null;
  const d = entry.media?.duration;
  return typeof d === 'number' && Number.isFinite(d) && d >= 1 ? d : null;
}

export function tileOfEntry(entry: FeedEntry): PlainTileData {
  return {
    key: entry.key,
    id: entry.id ?? entry.key,
    kind: entry.media?.kind ?? 'video',
    title: entry.title ?? '',
    subtitle: entry.subtitle ?? null,
    poster: entry.imageUrl ?? null,
    progress: entry.progress ?? null,
    badge: entry.badge ?? null,
    duration: entryLength(entry),
  };
}

export type EntryTap =
  | { kind: 'item'; itemId: string }
  | { kind: 'detail'; url: string }
  | { kind: 'media'; media: MediaRef }
  | { kind: 'panel'; panel: string }
  | { kind: 'link'; url: string }
  /** The entry only opens a panel, and this platform has none (TV). */
  | { kind: 'no-panel' }
  | null;

/**
 * What a tap on an entry does. `hasItem`: the entry's Jellyfin item loaded.
 * `panels`: the platform shows extension panels.
 */
export function entryTap(entry: FeedEntry, opts: { hasItem: boolean; panels: boolean }): EntryTap {
  if (entry.itemId && opts.hasItem) return { kind: 'item', itemId: entry.itemId };
  if (entry.detail) return { kind: 'detail', url: entry.detail };
  if (entry.media?.playback) return { kind: 'media', media: entry.media };
  if (entry.panel && opts.panels) return { kind: 'panel', panel: entry.panel };
  if (entry.link) return { kind: 'link', url: entry.link };
  if (entry.panel) return { kind: 'no-panel' };
  return null;
}
