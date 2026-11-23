/**
 * Catalog songs: songs that a server plugin lists before it has the file. The
 * plugin marks them with " ☁" at the end of the name and fetches the file
 * when a client first streams it.
 *
 * The player must not preload such a song as the next track: the preload is a
 * stream request, so a "Play next" would fetch it at once. It loads when it
 * starts instead (`session.ts` `onQueueEnd`). The links (below) join a
 * catalog id to the saved song's id. Pure, so it is unit-tested.
 */

const MARK = ' ☁';

/** True for a song the server fetches on its first play. */
export function isCatalogSong(item: { Name?: string | null }): boolean {
  return !!item.Name && item.Name.trimEnd().endsWith(MARK);
}

/** True when the player may preload this item as the next track. */
export function mayPreload(item: { Name?: string | null }): boolean {
  return !isCatalogSong(item);
}

/** The name without the catalog mark: the name of the song once the server saved it. */
export function savedName(name: string | null | undefined): string | null | undefined {
  if (!name) return name;
  const trimmed = name.trimEnd();
  return trimmed.endsWith(MARK) ? trimmed.slice(0, -MARK.length).trimEnd() : name;
}

/**
 * Links from a catalog song's id to the id of the song the server saved for it.
 * The server gives the saved song a new id, but lists (catalog rows, search,
 * albums) keep the catalog id until they load again. Through the link, those
 * rows still show the song as playing and as downloaded.
 */
export interface CatalogLinks {
  version: 1;
  /** Catalog id → saved id, oldest first. */
  links: Record<string, string>;
}

/** The most links the device keeps; the oldest go first. */
export const CATALOG_LINKS_MAX = 2000;

export const emptyLinks = (): CatalogLinks => ({ version: 1, links: {} });

/** Saved links, or none when the value is not a version 1 shape. Never throws. */
export function parseLinks(raw: unknown): CatalogLinks {
  if (!raw || typeof raw !== 'object') return emptyLinks();
  const v = raw as { version?: unknown; links?: unknown };
  if (v.version !== 1 || !v.links || typeof v.links !== 'object' || Array.isArray(v.links)) return emptyLinks();
  const links: Record<string, string> = {};
  for (const [from, to] of Object.entries(v.links as Record<string, unknown>)) {
    if (from && typeof to === 'string' && to && to !== from) links[from] = to;
  }
  return { version: 1, links };
}

/** Adds a link. The same object when nothing changes. */
export function addLink(state: CatalogLinks, from: string, to: string, max = CATALOG_LINKS_MAX): CatalogLinks {
  if (!from || !to || from === to || state.links[from] === to) return state;
  const links = { ...state.links };
  // Delete first, so a link set again moves to the end (the newest).
  delete links[from];
  links[from] = to;
  const keys = Object.keys(links);
  for (let i = 0; i < keys.length - max; i++) delete links[keys[i]];
  return { version: 1, links };
}

/** The saved id of a catalog id, or the id itself. */
export function linkedId(state: CatalogLinks, id: string): string;
export function linkedId(state: CatalogLinks, id: string | null | undefined): string | null | undefined;
export function linkedId(state: CatalogLinks, id: string | null | undefined): string | null | undefined {
  return id ? state.links[id] ?? id : id;
}

/** True when both ids are the same song, through a link or not. */
export function sameSong(state: CatalogLinks, a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || linkedId(state, a) === linkedId(state, b);
}
