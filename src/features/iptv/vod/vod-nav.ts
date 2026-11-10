/**
 * Where the film and series pages live: under Live TV, shared by the Home,
 * Library and Live TV stacks like the other Live TV pages (`../nav.ts`).
 * Every page names its provider (`p`), so a page stays on the provider it
 * opened with when the active provider changes.
 */
import { type Href, router } from 'expo-router';

import type { VodKind } from '@/iptv';

import type { LiveGroup } from '../nav';
import type { VodTileData } from './vod-view';

const root = (group: LiveGroup) => `/(tabs)/${group}/live-tv`;

/** The Films or Series page (categories, Continue watching, search). */
export function vodHomeHref(group: LiveGroup, kind: VodKind, providerId: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'films' : 'series'}`, params: { p: providerId } } as unknown as Href;
}

/** The poster grid of a category. */
export function vodCategoryHref(group: LiveGroup, kind: VodKind, providerId: string, categoryId: string, name: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'films' : 'series'}/[category]`, params: { category: categoryId, p: providerId, name } } as unknown as Href;
}

/** The page of a film or a series. */
export function vodDetailHref(group: LiveGroup, kind: VodKind, providerId: string, id: string): Href {
  return { pathname: `${root(group)}/${kind === 'film' ? 'film' : 'show'}/[id]`, params: { id, p: providerId } } as unknown as Href;
}

/** Opens the page of a tile: a film, a series, or the series of an episode. */
export function openTile(group: LiveGroup, providerId: string, d: VodTileData, seriesOf?: (episodeId: string) => string | undefined): void {
  if (d.kind === 'film') router.push(vodDetailHref(group, 'film', providerId, d.id));
  else if (d.kind === 'series') router.push(vodDetailHref(group, 'series', providerId, d.id));
  else {
    const seriesId = seriesOf?.(d.id);
    if (seriesId) router.push(vodDetailHref(group, 'series', providerId, seriesId));
  }
}
