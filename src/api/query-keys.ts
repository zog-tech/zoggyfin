/**
 * Query keys for TanStack Query. Every key starts with the session scope
 * (server ID + user ID), so two accounts never share cached data, and a
 * logout can drop one account's cache by prefix.
 */

export interface SessionScope {
  serverId: string;
  userId: string;
}

export type Scope = readonly ['jf', string, string];

export function scopeKey(scope: SessionScope): Scope {
  return ['jf', scope.serverId, scope.userId] as const;
}

export type LibrarySortBy =
  | 'SortName'
  | 'DateCreated'
  | 'PremiereDate'
  | 'CommunityRating'
  | 'Runtime'
  | 'DatePlayed'
  | 'Random';

export interface LibraryQuery {
  parentId: string;
  includeItemTypes: readonly string[];
  sortBy: LibrarySortBy;
  sortOrder: 'Ascending' | 'Descending';
  played: 'all' | 'played' | 'unplayed';
  favorites: boolean;
  genres: readonly string[];
  years: readonly number[];
}

/**
 * Makes a library query stable for use in a key: arrays are sorted, so the
 * same filter chosen in a different order hits the same cache entry.
 */
export function normalizeLibraryQuery(q: LibraryQuery): LibraryQuery {
  return {
    ...q,
    includeItemTypes: [...q.includeItemTypes].sort(),
    genres: [...q.genres].sort(),
    years: [...q.years].sort((a, b) => a - b),
  };
}

export const queryKeys = {
  all: (s: SessionScope) => scopeKey(s),
  me: (s: SessionScope) => [...scopeKey(s), 'me'] as const,
  views: (s: SessionScope) => [...scopeKey(s), 'views'] as const,
  resume: (s: SessionScope, media: 'Video' | 'Audio') => [...scopeKey(s), 'resume', media] as const,
  nextUp: (s: SessionScope, seriesId?: string) =>
    [...scopeKey(s), 'nextUp', seriesId ?? 'all'] as const,
  latest: (s: SessionScope, parentId: string) => [...scopeKey(s), 'latest', parentId] as const,
  item: (s: SessionScope, itemId: string) => [...scopeKey(s), 'item', itemId] as const,
  library: (s: SessionScope, q: LibraryQuery) =>
    [...scopeKey(s), 'library', normalizeLibraryQuery(q)] as const,
  filters: (s: SessionScope, parentId: string) => [...scopeKey(s), 'filters', parentId] as const,
  seasons: (s: SessionScope, seriesId: string) => [...scopeKey(s), 'seasons', seriesId] as const,
  episodes: (s: SessionScope, seriesId: string, seasonId: string) =>
    [...scopeKey(s), 'episodes', seriesId, seasonId] as const,
  children: (s: SessionScope, parentId: string, kind: string) =>
    [...scopeKey(s), 'children', parentId, kind] as const,
  music: (s: SessionScope, libraryId: string, tab: string, options?: object) =>
    [...scopeKey(s), 'music', libraryId, tab, options ?? {}] as const,
  /** Recently and most played songs. Invalidated after audio playback. */
  played: (s: SessionScope, libraryId: string, kind: string) => [...scopeKey(s), 'played', libraryId, kind] as const,
  /** The user's playlists for the Add to playlist sheet. */
  playlists: (s: SessionScope, mediaType?: string) => [...scopeKey(s), 'playlists', mediaType ?? 'all'] as const,
  /** Movie recommendations for the "Because you watched" Home rows. */
  recommendations: (s: SessionScope) => [...scopeKey(s), 'recommendations'] as const,
  /** The unwatched movies that the "Short on time" Home row filters by runtime. */
  shortMovies: (s: SessionScope) => [...scopeKey(s), 'shortMovies'] as const,
  /** Movie and show genres with counts, for the genre of the day. */
  videoGenres: (s: SessionScope) => [...scopeKey(s), 'videoGenres'] as const,
  /** The items of the genre of the day. The day is in the key, so the row moves on at midnight. */
  genreOfDay: (s: SessionScope, day: string, genreId: string) => [...scopeKey(s), 'genreOfDay', day, genreId] as const,
  similar: (s: SessionScope, itemId: string) => [...scopeKey(s), 'similar', itemId] as const,
  search: (s: SessionScope, term: string, genre = '') =>
    [...scopeKey(s), 'search', term.trim().toLowerCase(), genre] as const,
};
