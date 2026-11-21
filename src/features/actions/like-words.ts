/**
 * One name for the heart. Jellyfin has one flag (`IsFavorite`); the music
 * screens called it "Liked Songs" in one place and "favourites" in others,
 * which read as two features. Music says Like everywhere (Liked Songs, the
 * player heart, the sheet, the filter chip); films, shows and other items keep
 * "favourites".
 *
 * Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

const MUSIC_TYPES = new Set(['Audio', 'MusicAlbum', 'MusicArtist', 'MusicGenre', 'MusicVideo']);

/** A music item: songs, albums, artists, music genres and audio playlists. */
export function isMusicItem(item: Pick<BaseItemDto, 'Type' | 'MediaType'>): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return MUSIC_TYPES.has(item.Type ?? '');
}

/** The label of the heart action: what a press does. */
export function likeActionTitle(item: Pick<BaseItemDto, 'Type' | 'MediaType'>, on: boolean): string {
  if (isMusicItem(item)) return on ? 'Like' : 'Unlike';
  return on ? 'Add to favourites' : 'Remove from favourites';
}

/** The toast after the heart changed. */
export function likeDoneText(item: Pick<BaseItemDto, 'Type' | 'MediaType'>, on: boolean): string {
  if (isMusicItem(item)) return on ? 'Liked' : 'Removed from Liked';
  return on ? 'Added to favourites' : 'Removed from favourites';
}
