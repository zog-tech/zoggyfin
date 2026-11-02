import { type Href, useRouter, useSegments } from 'expo-router';
import { useCallback } from 'react';

import { seedItem } from '@/api/item-seed';
import type { BaseItemDto } from '@/api/types';

/** Tab stacks that hold the shared detail routes. */
export type TabGroup = '(home)' | '(library)' | '(music)' | '(search)' | '(saved)';
const GROUPS: readonly TabGroup[] = ['(home)', '(library)', '(music)', '(search)', '(saved)'];

/** The tab the user is in, so a pushed detail page stays in that tab's stack. */
export function useTabGroup(): TabGroup {
  const segments = useSegments() as string[];
  const found = segments.find((s): s is TabGroup => (GROUPS as readonly string[]).includes(s));
  return found ?? '(home)';
}

/** The route for an item. User views go to the library grid; music libraries go to the music pager. */
export function itemHref(group: TabGroup, item: BaseItemDto): Href | null {
  if (!item.Id) return null;
  const id = item.Id;
  const name = item.Name ?? '';
  if (item.Type === 'CollectionFolder' || item.Type === 'UserView') {
    if (item.CollectionType === 'music' || item.CollectionType === 'books') {
      return { pathname: `/(tabs)/${group}/music/[id]`, params: { id, name, kind: item.CollectionType } } as unknown as Href;
    }
    return { pathname: `/(tabs)/${group}/library/[id]`, params: { id, name } } as unknown as Href;
  }
  if (item.Type === 'MusicGenre' || item.Type === 'Genre') {
    const libraryId = item.ParentId ?? '';
    return { pathname: `/(tabs)/${group}/genre/[id]`, params: { id, name, libraryId } } as unknown as Href;
  }
  return {
    pathname: `/(tabs)/${group}/item/[id]`,
    params: { id, type: item.Type ?? '', name },
  } as unknown as Href;
}

/** A movie and show genre: its page lists the genre in every library (music genres use `itemHref`). */
export function videoGenreHref(group: TabGroup, genre: BaseItemDto): Href | null {
  if (!genre.Id) return null;
  return { pathname: `/(tabs)/${group}/genre/[id]`, params: { id: genre.Id, name: genre.Name ?? '', kind: 'video' } } as unknown as Href;
}

export function useOpenItem() {
  const router = useRouter();
  const group = useTabGroup();
  return useCallback(
    (item: BaseItemDto) => {
      const href = itemHref(group, item);
      if (!href) return;
      // The page renders at once from what the tile knew.
      seedItem(item);
      router.push(href);
    },
    [router, group],
  );
}
