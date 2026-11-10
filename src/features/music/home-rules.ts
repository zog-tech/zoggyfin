/**
 * The rules behind the music Home tab: which artists and genres become
 * "Mixes for you", which albums to "Rediscover", the genre row, and which
 * row takes the first TV focus. All of it works on the user's most played
 * songs (stock Jellyfin data, no plugin). Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

/** How many played songs the mixes and Rediscover look at. */
export const PLAY_POOL_SIZE = 200;
/** At most this many mix tiles. */
export const MAX_MIXES = 6;
/** At most this many albums in Rediscover. */
export const MAX_REDISCOVER = 12;
/** An album is "rediscovered" when its last play is older than this. */
export const REDISCOVER_AFTER_DAYS = 60;
/** At most this many genres in the Home row. */
export const MUSIC_GENRE_ROW_MAX = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MixKind = 'artist' | 'genre';

export interface MixSeed {
  id: string;
  kind: MixKind;
  name: string;
}

interface Tally {
  id: string;
  name: string;
  plays: number;
}

/** A played song counts at least once, even when the server has no play count for it. */
const playsOf = (song: BaseItemDto) => Math.max(1, song.UserData?.PlayCount ?? 0);

function tally(map: Map<string, Tally>, id: string | null | undefined, name: string | null | undefined, plays: number) {
  const n = name?.trim();
  if (!id || !n) return;
  const t = map.get(id);
  if (t) t.plays += plays;
  else map.set(id, { id, name: n, plays });
}

const byPlays = (a: Tally, b: Tally) => b.plays - a.plays || a.name.localeCompare(b.name);

/**
 * The mixes for this user: the artists and genres with the most plays in
 * the pool, artist and genre in turn (the top artist first), so the row is
 * not all one kind. The same artist or genre never shows twice.
 */
export function mixSeeds(songs: readonly BaseItemDto[] | null | undefined, max = MAX_MIXES): MixSeed[] {
  const artists = new Map<string, Tally>();
  const genres = new Map<string, Tally>();
  for (const song of songs ?? []) {
    const plays = playsOf(song);
    for (const a of song.ArtistItems ?? []) tally(artists, a.Id, a.Name, plays);
    for (const g of song.GenreItems ?? []) tally(genres, g.Id, g.Name, plays);
  }
  const a = [...artists.values()].sort(byPlays);
  const g = [...genres.values()].sort(byPlays);
  const out: MixSeed[] = [];
  for (let i = 0; out.length < max && (i < a.length || i < g.length); i++) {
    const artist = a[i];
    const genre = g[i];
    if (artist) out.push({ id: artist.id, kind: 'artist', name: artist.name });
    if (genre && out.length < max) out.push({ id: genre.id, kind: 'genre', name: genre.name });
  }
  return out;
}

/**
 * Albums the user played a lot, but not lately: the songs of the pool are
 * summed per album, and an album stays only when its newest play is older
 * than `afterDays`. The most played albums come first.
 */
export function rediscoverAlbumIds(
  songs: readonly BaseItemDto[] | null | undefined,
  now: number,
  afterDays = REDISCOVER_AFTER_DAYS,
  max = MAX_REDISCOVER,
): string[] {
  const albums = new Map<string, { id: string; plays: number; last: number }>();
  for (const song of songs ?? []) {
    const id = song.AlbumId;
    if (!id) continue;
    const at = song.UserData?.LastPlayedDate ? Date.parse(song.UserData.LastPlayedDate) : NaN;
    const last = Number.isFinite(at) ? at : 0;
    const a = albums.get(id);
    if (a) {
      a.plays += playsOf(song);
      a.last = Math.max(a.last, last);
    } else albums.set(id, { id, plays: playsOf(song), last });
  }
  const cut = now - afterDays * DAY_MS;
  return [...albums.values()]
    // An album with no known last play is not "a while ago": leave it out.
    .filter((a) => a.last > 0 && a.last < cut)
    .sort((a, b) => b.plays - a.plays || a.last - b.last)
    .slice(0, max)
    .map((a) => a.id);
}

/** `items` in the order of `ids`. Ids the server did not return are skipped. */
export function orderByIds(items: readonly BaseItemDto[] | null | undefined, ids: readonly string[]): BaseItemDto[] {
  const byId = new Map((items ?? []).map((it) => [it.Id ?? '', it] as const));
  return ids.map((id) => byId.get(id)).filter((it): it is BaseItemDto => !!it);
}

/** The subtitle of a mix tile. */
export function mixSubtitle(item: BaseItemDto): string {
  return item.Type === 'MusicArtist' ? 'Artist mix' : 'Genre mix';
}

const songCount = (g: BaseItemDto) => g.SongCount ?? g.ChildCount ?? 0;

/** Music genres with a name, the most songs first, then by name. */
export function topMusicGenres(genres: readonly BaseItemDto[] | null | undefined, max = MUSIC_GENRE_ROW_MAX): BaseItemDto[] {
  return (genres ?? [])
    .filter((g) => !!g.Id && !!g.Name?.trim())
    .sort((a, b) => songCount(b) - songCount(a) || (a.Name ?? '').localeCompare(b.Name ?? ''))
    .slice(0, max);
}

/** "12 songs" under a genre tile. */
export function genreSongs(genre: BaseItemDto): string | undefined {
  const n = genre.SongCount ?? 0;
  return n ? `${n} ${n === 1 ? 'song' : 'songs'}` : undefined;
}

/**
 * TV: the id of the section whose row takes the first focus: the first
 * section, in Home order, that shows a row. Sections that are empty or not
 * loaded yet do not count.
 */
export function firstFilled(order: readonly string[], filled: ReadonlySet<string>): string | undefined {
  return order.find((id) => filled.has(id));
}
