/**
 * The Top songs of an artist page. The library alone lists only the songs on
 * the server's disk: for an artist from the catalog plugin, that was one song.
 * With the plugin, its list (by popularity, songs the artist is featured on
 * included) comes first, then the library's most played songs that it does not
 * have. A song the library has under a catalog name counts once, as the
 * library item. Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';
import { savedName } from '@/player/audio/catalog';

/** The most songs Top songs shows. */
export const TOP_SONGS_MAX = 20;

const key = (item: BaseItemDto) => `${(savedName(item.Name) ?? '').trim().toLowerCase()}\u0000${(item.Artists?.[0] ?? item.AlbumArtist ?? '').trim().toLowerCase()}`;

export function mergeTopSongs(catalog: readonly BaseItemDto[] | null | undefined, library: readonly BaseItemDto[], max = TOP_SONGS_MAX): BaseItemDto[] {
  if (!catalog?.length) return library.slice(0, max);
  const libraryByKey = new Map<string, BaseItemDto>();
  for (const item of library) if (!libraryByKey.has(key(item))) libraryByKey.set(key(item), item);
  const out: BaseItemDto[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  const add = (item: BaseItemDto) => {
    const k = key(item);
    if (!item.Id || ids.has(item.Id) || keys.has(k) || out.length >= max) return;
    ids.add(item.Id);
    keys.add(k);
    out.push(item);
  };
  // A catalog song the library has (same name and artist) shows as the library item.
  for (const item of catalog) add(libraryByKey.get(key(item)) ?? item);
  for (const item of library) add(item);
  return out;
}
