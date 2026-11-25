/**
 * What the Search page lists before any words: a few rows to start from, so
 * the page is never empty, and each filter chip (Movies, Shows, Videos,
 * Music) opens rows of its own kind. Each row is one server query; a row
 * with no items is left out.
 *
 * Pure, so it is unit-tested. `useBrowseRows` (`api/queries.ts`) runs the rows.
 */
import type { BrowseQuery } from '@/api/jellyfin';

import type { BrowseKind } from './group-results';

export type BrowseSort = 'random' | 'rating' | 'added';

export interface BrowseRow {
  key: string;
  title: string;
  /** Jellyfin item types. */
  types: string[];
  sort: BrowseSort;
  limit: number;
}

/** One row of each kind on the first page. */
const START_LIMIT = 24;
/** A chosen kind: longer rows. */
const KIND_LIMIT = 40;

export function browseRows(kind: BrowseKind): BrowseRow[] {
  switch (kind) {
    case 'all':
      return [
        { key: 'movies', title: 'Movies for you', types: ['Movie'], sort: 'random', limit: START_LIMIT },
        { key: 'shows', title: 'Shows for you', types: ['Series'], sort: 'random', limit: START_LIMIT },
        { key: 'videos', title: 'Recently added videos', types: ['Video', 'MusicVideo'], sort: 'added', limit: START_LIMIT },
        { key: 'albums', title: 'Albums for you', types: ['MusicAlbum'], sort: 'random', limit: START_LIMIT },
      ];
    case 'movies':
      return [
        { key: 'movies-top', title: 'Top rated movies', types: ['Movie'], sort: 'rating', limit: KIND_LIMIT },
        { key: 'movies-new', title: 'Recently added movies', types: ['Movie'], sort: 'added', limit: KIND_LIMIT },
        { key: 'movies-pick', title: 'Movies for you', types: ['Movie'], sort: 'random', limit: KIND_LIMIT },
      ];
    case 'shows':
      return [
        { key: 'shows-top', title: 'Top rated shows', types: ['Series'], sort: 'rating', limit: KIND_LIMIT },
        { key: 'shows-new', title: 'Recently added shows', types: ['Series'], sort: 'added', limit: KIND_LIMIT },
        { key: 'shows-pick', title: 'Shows for you', types: ['Series'], sort: 'random', limit: KIND_LIMIT },
      ];
    case 'videos':
      return [
        { key: 'videos-new', title: 'Recently added videos', types: ['Video'], sort: 'added', limit: KIND_LIMIT },
        { key: 'music-videos', title: 'Music videos', types: ['MusicVideo'], sort: 'added', limit: KIND_LIMIT },
      ];
    case 'music':
      return [
        { key: 'albums-new', title: 'Recently added albums', types: ['MusicAlbum'], sort: 'added', limit: KIND_LIMIT },
        { key: 'albums-pick', title: 'Albums for you', types: ['MusicAlbum'], sort: 'random', limit: KIND_LIMIT },
        { key: 'playlists', title: 'Playlists', types: ['Playlist'], sort: 'added', limit: KIND_LIMIT },
      ];
  }
}

/** The server's sort for a row: the order, and the name as the tie-break. */
export function browseSort(sort: BrowseSort): { sortBy: string[]; sortOrder: ('Ascending' | 'Descending')[] } {
  switch (sort) {
    case 'random':
      return { sortBy: ['Random'], sortOrder: ['Ascending'] };
    case 'rating':
      return { sortBy: ['CommunityRating', 'SortName'], sortOrder: ['Descending', 'Ascending'] };
    case 'added':
      return { sortBy: ['DateCreated', 'SortName'], sortOrder: ['Descending', 'Ascending'] };
  }
}

/** The rows of a kind as server queries (`useBrowseRows`). */
export function browseQueries(kind: BrowseKind): { key: string; title: string; query: BrowseQuery }[] {
  return browseRows(kind).map((r) => ({ key: r.key, title: r.title, query: { types: r.types, limit: r.limit, ...browseSort(r.sort) } }));
}

/** A chosen kind with no rows: what to say. */
export function browseEmptyText(kind: BrowseKind): string {
  switch (kind) {
    case 'all':
      return 'Your libraries have nothing to list yet.';
    case 'movies':
      return 'No movies in your libraries yet.';
    case 'shows':
      return 'No shows in your libraries yet.';
    case 'videos':
      return 'No videos in your libraries yet.';
    case 'music':
      return 'No music in your libraries yet.';
  }
}
