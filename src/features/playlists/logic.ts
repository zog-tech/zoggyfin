/**
 * Playlist rules. Pure, so they are unit-tested: the order of the "Add to
 * playlist" sheet, which playlists fit an item, and the local copies of
 * reorder and remove that the screen shows before the server answers, and
 * when to roll one back.
 */
import type { BaseItemDto } from '@/api/types';

export type PlaylistMedia = 'Audio' | 'Video';

const AUDIO = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);

/**
 * What to put back in the cache after a failed optimistic change. `before`
 * only while the cache still holds this change's own list (`applied`). When a
 * newer change replaced it, null: a rollback would wipe the newer change, and
 * the refetch after each change brings the server's order anyway.
 */
export function rollbackTo<T>(current: T | undefined, applied: T, before: T): T | null {
  return current === applied ? before : null;
}

/** Audio items go into audio playlists, everything else into video playlists. */
export function playlistMediaFor(items: readonly BaseItemDto[]): PlaylistMedia {
  const first = items[0];
  if (!first) return 'Audio';
  if (first.Type === 'Playlist') return first.MediaType === 'Video' ? 'Video' : 'Audio';
  return AUDIO.has(first.Type ?? '') || first.MediaType === 'Audio' ? 'Audio' : 'Video';
}

/** Items that can go into a playlist. */
export function canAddToPlaylist(item: Pick<BaseItemDto, 'Type' | 'Id'>): boolean {
  if (!item.Id) return false;
  return !['Person', 'CollectionFolder', 'UserView', 'Folder', 'Genre', 'Studio'].includes(item.Type ?? '');
}

/** A playlist without a media type (older servers) accepts anything. */
export function fits(playlist: Pick<BaseItemDto, 'MediaType'>, media: PlaylistMedia): boolean {
  const t = playlist.MediaType;
  return !t || t === 'Unknown' || t === media;
}

export const MAX_RECENT = 5;

/**
 * The sheet order (design system §7.12): up to five recent playlists (the
 * ones this device used last), then every other one A–Z.
 */
export function sheetOrder(playlists: readonly BaseItemDto[], recentIds: readonly string[]): { recent: BaseItemDto[]; all: BaseItemDto[] } {
  const byId = new Map(playlists.filter((p) => p.Id).map((p) => [p.Id as string, p]));
  const recent = recentIds.map((id) => byId.get(id)).filter((p): p is BaseItemDto => !!p).slice(0, MAX_RECENT);
  const taken = new Set(recent.map((p) => p.Id));
  const all = playlists
    .filter((p) => !taken.has(p.Id))
    .sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? '', undefined, { sensitivity: 'base' }));
  return { recent, all };
}

/** Puts a playlist first in the recent list. */
export function touchRecent(recentIds: readonly string[], id: string, max = 20): string[] {
  return [id, ...recentIds.filter((x) => x !== id)].slice(0, max);
}

/** Moves one entry; the same rule as the server's Move/{newIndex} (the final index). */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  const at = Math.max(0, Math.min(out.length, to));
  out.splice(at, 0, item as T);
  return out;
}

/** Removes entries by their PlaylistItemId. */
export function removeEntries(list: readonly BaseItemDto[], entryIds: readonly string[]): BaseItemDto[] {
  const drop = new Set(entryIds);
  return list.filter((i) => !i.PlaylistItemId || !drop.has(i.PlaylistItemId));
}

/** A name for a new playlist: what the user typed, trimmed, or a default. */
export function playlistName(input: string, fallback = 'New playlist'): string {
  const t = input.replace(/\s+/g, ' ').trim();
  return t.length ? t.slice(0, 200) : fallback;
}
