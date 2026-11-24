/**
 * A playlist as plain text, to send to a person who uses another music
 * service. One line per entry, "Artist - Title": the form that playlist
 * import tools read, and that a person can read too. The first line is the
 * playlist's name.
 *
 * Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

/** One entry as a line, or null when it has no name. */
export function shareLine(item: BaseItemDto): string | null {
  const name = item.Name?.trim();
  if (!name) return null;
  if (item.Type === 'Episode') {
    const series = item.SeriesName?.trim();
    return series ? `${series} - ${name}` : name;
  }
  if (item.MediaType === 'Audio' || item.Type === 'Audio') {
    const artist = (item.Artists?.filter(Boolean).join(', ') || item.AlbumArtist || '').trim();
    return artist ? `${artist} - ${name}` : name;
  }
  return item.ProductionYear ? `${name} (${item.ProductionYear})` : name;
}

/** The text to share: the name, an empty line, then the entries in order. */
export function playlistShareText(name: string | null | undefined, items: readonly BaseItemDto[]): string {
  const lines = items.map(shareLine).filter((l): l is string => l !== null);
  const title = name?.trim() || 'Playlist';
  return lines.length ? `${title}\n\n${lines.join('\n')}` : title;
}
