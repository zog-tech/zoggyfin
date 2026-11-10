/**
 * The rules for the rows of the optional music catalog plugin on music Home:
 * the tile shape of a row, the line under a tile, and the songs a tap plays.
 * The server picks the rows, so these rules work for any item type.
 * Pure, so it is unit-tested.
 */
import type { OnDemandSection } from '@/api/ondemand';
import type { BaseItemDto } from '@/api/types';
import { shapeFor, shapeForList, type TileShape } from '@/components/tile-shape';

/** Row types whose tile shape the app knows without looking at the items. */
const KNOWN_TYPES = new Set(['Audio', 'MusicAlbum', 'Playlist', 'MusicArtist', 'MusicGenre']);

/** The tile shape of a row: from the row's item type, else the shape most of its items want. */
export function catalogShape(section: Pick<OnDemandSection, 'itemType' | 'items'>): TileShape {
  if (section.itemType && KNOWN_TYPES.has(section.itemType)) return shapeFor({ Type: section.itemType } as BaseItemDto);
  const counts = new Map<TileShape, number>();
  let best: TileShape = 'square';
  let bestCount = 0;
  for (const item of section.items) {
    const shape = shapeFor(item);
    const n = (counts.get(shape) ?? 0) + 1;
    counts.set(shape, n);
    // A tie keeps the shape that got there first.
    if (n > bestCount) {
      best = shape;
      bestCount = n;
    }
  }
  return shapeForList(section.items, best);
}

/** The line under a tile: the artist of a song, the artist and year of an album. */
export function catalogSubtitle(item: BaseItemDto): string | undefined {
  switch (item.Type) {
    case 'Audio':
      return item.Artists?.[0] ?? item.AlbumArtist ?? item.Album ?? undefined;
    case 'MusicAlbum':
      return [item.AlbumArtist, item.ProductionYear].filter(Boolean).join(' · ') || undefined;
    default:
      return undefined;
  }
}

/** The songs of a row, in order: a tap on a song plays them as a queue. */
export function catalogSongs(items: readonly BaseItemDto[]): BaseItemDto[] {
  return items.filter((i) => i.Type === 'Audio');
}
