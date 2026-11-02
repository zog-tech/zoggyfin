/**
 * Movie and show genres to browse: the Genres row on Home and the genre
 * filter in Search. Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';
import { genreSize } from '@/features/home/genre-spotlight';

/** At most this many genres in the Home row. */
export const GENRE_ROW_MAX = 24;

/**
 * Genres with an Id, a name and at least one movie or show: the largest
 * first, then by name, so the genres people have most of come first on a
 * TV, where each one is a D-pad press away.
 */
export function browseGenres(genres: readonly BaseItemDto[] | null | undefined, max = Infinity): BaseItemDto[] {
  return (genres ?? [])
    .filter((g) => !!g.Id && !!g.Name?.trim() && genreSize(g) > 0)
    .sort((a, b) => genreSize(b) - genreSize(a) || (a.Name ?? '').localeCompare(b.Name ?? ''))
    .slice(0, max);
}

/** Items in the genre `name` (case-insensitive). Downloads offline: the server cannot filter them. */
export function inGenre(items: readonly BaseItemDto[], name: string | null | undefined): BaseItemDto[] {
  const want = name?.trim().toLowerCase();
  if (!want) return [...items];
  return items.filter((it) => (it.Genres ?? []).some((g) => g.trim().toLowerCase() === want));
}

/** "12 movies · 3 shows" under a genre tile. */
export function genreCount(genre: BaseItemDto): string | undefined {
  const movies = genre.MovieCount ?? 0;
  const shows = genre.SeriesCount ?? 0;
  const parts = [movies ? `${movies} ${movies === 1 ? 'movie' : 'movies'}` : null, shows ? `${shows} ${shows === 1 ? 'show' : 'shows'}` : null];
  return parts.filter(Boolean).join(' · ') || undefined;
}
