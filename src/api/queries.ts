/**
 * Query hooks. Each one pairs a key from `queryKeys` with a function from
 * `jellyfin.ts`. Screens use these and nothing lower.
 */
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { downloadedChildren, downloadedItem, serverOrLocal } from '@/downloads';

import * as jf from './jellyfin';
import type { BaseItemDto } from './types';
import { type LibraryQuery, queryKeys } from './query-keys';
import { useApi } from './use-api';

const PAGE_SIZE = 60;

export function useViews() {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.views(scope), queryFn: () => jf.getViews(api, userId), staleTime: 5 * 60 * 1000 });
}

export function useResume(media: 'Video' | 'Audio') {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.resume(scope, media), queryFn: () => jf.getResume(api, userId, media) });
}

export function useNextUp(seriesId?: string) {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.nextUp(scope, seriesId), queryFn: () => jf.getNextUp(api, userId, seriesId) });
}

export function useLatest(parentId: string) {
  const { api, userId, scope } = useApi();
  return useQuery({ queryKey: queryKeys.latest(scope, parentId), queryFn: () => jf.getLatest(api, userId, parentId) });
}

/** `seed`: what a tile already knew about the item, shown until the full item arrives. */
export function useItem(itemId: string | undefined, seed?: BaseItemDto) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.item(scope, itemId ?? ''),
    // With no server, a downloaded item still opens from its saved facts.
    queryFn: () => serverOrLocal(() => jf.getItem(api, userId, itemId ?? ''), () => downloadedItem(itemId ?? '')),
    enabled: !!itemId,
    placeholderData: seed && seed.Id === itemId ? seed : undefined,
  });
}

/** How long a prefetched item counts as fresh (ms). */
const PREFETCH_FRESH_MS = 60_000;

/**
 * TV: loads an item shortly after its tile takes the focus, so Select opens
 * a page whose data is already there. A focus that moves on within `delayMs`
 * loads nothing.
 */
export function usePrefetchItemOnFocus(delayMs = 300): (item: BaseItemDto) => void {
  const { api, userId, scope } = useApi();
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (item: BaseItemDto) => {
      const id = item.Id;
      if (!id) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void qc.prefetchQuery({
          queryKey: queryKeys.item(scope, id),
          queryFn: () => serverOrLocal(() => jf.getItem(api, userId, id), () => downloadedItem(id)),
          staleTime: PREFETCH_FRESH_MS,
        });
      }, delayMs);
    },
    [api, userId, scope, qc, delayMs],
  );
}

export function useLibrary(q: LibraryQuery) {
  const { api, userId, scope } = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.library(scope, q),
    queryFn: ({ pageParam }) => jf.getLibraryPage(api, userId, q, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.startIndex + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function useFilters(parentId: string, includeItemTypes: readonly string[]) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.filters(scope, parentId),
    queryFn: () => jf.getFilters(api, userId, parentId, includeItemTypes),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSeasons(seriesId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.seasons(scope, seriesId ?? ''),
    queryFn: () => jf.getSeasons(api, userId, seriesId ?? ''),
    enabled: !!seriesId,
  });
}

export function useEpisodes(seriesId: string | undefined, seasonId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.episodes(scope, seriesId ?? '', seasonId ?? ''),
    queryFn: () => serverOrLocal(() => jf.getEpisodes(api, userId, seriesId ?? '', seasonId ?? ''), () => downloadedChildren(seasonId)),
    enabled: !!seriesId && !!seasonId,
  });
}

export function useChildren(parentId: string | undefined, kind: jf.ChildrenKind, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.children(scope, parentId ?? '', kind),
    queryFn: () =>
      kind === 'tracks' || kind === 'playlist' || kind === 'items'
        ? serverOrLocal(() => jf.getChildren(api, userId, parentId ?? '', kind), () => downloadedChildren(parentId))
        : jf.getChildren(api, userId, parentId ?? '', kind),
    enabled: enabled && !!parentId,
  });
}

export function useSimilar(itemId: string | undefined, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.similar(scope, itemId ?? ''),
    queryFn: () => jf.getSimilar(api, userId, itemId ?? ''),
    enabled: enabled && !!itemId,
  });
}

const HOUR = 60 * 60 * 1000;

/**
 * Movie recommendations. The server can pick other categories on each call,
 * so a long stale time keeps the rows from changing under the user; pull to
 * refresh asks again.
 */
export function useMovieRecommendations(enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.recommendations(scope),
    queryFn: () => jf.getMovieRecommendations(api, userId),
    staleTime: 12 * HOUR,
    enabled,
  });
}

/** The pool of unwatched movies for "Short on time" (`limit` keeps the request small). */
export function useShortMoviePool(limit: number, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.shortMovies(scope),
    queryFn: () => jf.getShortMoviePool(api, userId, limit),
    staleTime: HOUR,
    enabled,
  });
}

/** Movie and show genres with counts. They change rarely. */
export function useVideoGenres(enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.videoGenres(scope),
    queryFn: () => jf.getVideoGenres(api, userId),
    staleTime: 24 * HOUR,
    enabled,
  });
}

/** The items of the genre of the day (`day` is "YYYY-MM-DD"). */
export function useGenreOfDayItems(day: string, genreId: string | undefined, limit: number, enabled = true) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.genreOfDay(scope, day, genreId ?? ''),
    queryFn: () => jf.getGenreVideos(api, userId, genreId ?? '', limit),
    staleTime: 6 * HOUR,
    enabled: enabled && !!genreId,
  });
}

export function useMusicTab(libraryId: string | undefined, tab: jf.MusicTab, options: jf.MusicOptions = jf.DEFAULT_MUSIC_OPTIONS, enabled = true) {
  const { api, userId, scope } = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.music(scope, libraryId ?? '', tab, options),
    queryFn: ({ pageParam }) => jf.getMusicPage(api, userId, libraryId ?? '', tab, pageParam, PAGE_SIZE, options),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.startIndex + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
    enabled: enabled && !!libraryId,
  });
}

export function usePlayedSongs(libraryId: string | undefined, kind: 'recent' | 'most') {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.played(scope, libraryId ?? '', kind),
    queryFn: () => jf.getPlayedSongs(api, userId, libraryId ?? '', kind),
    enabled: !!libraryId,
  });
}

export function useGenreItems(libraryId: string | undefined, genreId: string | undefined) {
  const { api, userId, scope } = useApi();
  return useQuery({
    queryKey: queryKeys.children(scope, `${libraryId ?? ''}:${genreId ?? ''}`, 'genre'),
    queryFn: () => jf.getGenreItems(api, userId, libraryId || undefined, genreId ?? ''),
    enabled: !!genreId,
  });
}

/** `genre` (a genre name): only movies and shows of it; with a genre an empty term lists the genre. */
export function useSearch(term: string, genre?: string) {
  const { api, userId, scope } = useApi();
  const t = term.trim();
  return useQuery({
    queryKey: queryKeys.search(scope, t, genre),
    queryFn: ({ signal }) => jf.search(api, userId, t, signal, genre),
    enabled: t.length >= 2 || !!genre,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
}
