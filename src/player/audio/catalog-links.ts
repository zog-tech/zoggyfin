/**
 * The device's catalog links (see `catalog.ts`): a catalog song's id → the id
 * of the song the server saved for it. The audio session adds one when a
 * catalog song plays, the download manager when one downloads. Rows read them
 * to show the playing and downloaded marks and the saved name.
 *
 * Saved in MMKV (`catalog.links`, version 1). Ids of two servers never meet,
 * so the links are not split per server.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { addLink, type CatalogLinks, emptyLinks, linkedId, parseLinks } from './catalog';

const KEY = 'catalog.links';

function load(): CatalogLinks {
  try {
    return parseLinks(readJson<unknown>(KEY, null));
  } catch {
    return emptyLinks();
  }
}

export const useCatalogLinks = create<CatalogLinks>(() => load());

/** Joins a catalog id to the saved song's id. */
export function linkCatalogSong(from: string | null | undefined, to: string | null | undefined): void {
  if (!from || !to) return;
  const prev = useCatalogLinks.getState();
  const next = addLink(prev, from, to);
  if (next === prev) return;
  useCatalogLinks.setState(next, true);
  try {
    writeJson(KEY, next);
  } catch {
    // The link stays for this run only.
  }
}

/** The saved id of a catalog id, or the id itself. */
export function savedId(id: string | null | undefined): string | null | undefined {
  return linkedId(useCatalogLinks.getState(), id);
}

/** The saved id of a catalog id, or the id itself; re-renders when a link for it arrives. */
export function useSavedId(id: string | null | undefined): string | null | undefined {
  return useCatalogLinks((s) => linkedId(s, id));
}
