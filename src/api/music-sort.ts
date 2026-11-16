/**
 * The server sort fields for a music tab. Pure, so it is unit-tested.
 *
 * Jellyfin's SortName of a song starts with its disc and track number
 * ("0001 - Bend", "0010 - Jellyfin"). Sorting songs by it lists every first
 * track from A to Z, then every second track, and so on, so a song looked
 * missing from an A to Z list. Song lists sort by the title (`Name`) instead.
 * SortName stays the tie-breaker for an album sort, where it is the track
 * order. Albums, artists and the other tabs keep SortName: there it is the
 * title without "The" and "A".
 */
import type { ItemSortBy } from './types';

type Order = 'Ascending' | 'Descending';

const SONG_TABS = new Set(['songs', 'liked']);

export function musicSort(tab: string, sortBy: ItemSortBy, order: Order): { sortBy: ItemSortBy[]; sortOrder: Order[] } {
  const songs = SONG_TABS.has(tab);
  const fields: ItemSortBy[] = !songs
    ? sortBy === 'SortName'
      ? ['SortName']
      : [sortBy, 'SortName']
    : sortBy === 'SortName' || sortBy === 'Name'
      ? ['Name']
      : sortBy === 'Album'
        ? ['Album', 'SortName']
        : sortBy === 'Artist'
          ? ['Artist', 'Album', 'SortName']
          : [sortBy, 'Name'];
  // The server wants one sort order per field; only the first follows the user's choice.
  return { sortBy: fields, sortOrder: fields.map((_, i) => (i === 0 ? order : 'Ascending')) };
}
