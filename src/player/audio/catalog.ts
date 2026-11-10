/**
 * Catalog songs: songs that a server plugin lists before it has the file. The
 * plugin marks them with " ☁" at the end of the name and fetches the file
 * when a client first streams it.
 *
 * The player must not preload such a song as the next track: the preload is a
 * stream request, so a "Play next" would fetch it at once. It loads when it
 * starts instead (`session.ts` `onQueueEnd`). Pure, so it is unit-tested.
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
