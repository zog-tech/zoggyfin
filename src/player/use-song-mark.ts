/**
 * The mark of a song row or tile: 'playing' when it is the song in the player,
 * 'loading' while the server fetches that catalog song, else 'none'. A catalog
 * id and the id of its saved song count as the same song (`catalog-links.ts`).
 */
import { isCatalogSong, sameSong } from './audio/catalog';
import { useCatalogLinks } from './audio/catalog-links';
import { usePlayerStore } from './store';

export type SongMark = 'none' | 'loading' | 'playing';

export function useSongMark(id: string | null | undefined): SongMark {
  const links = useCatalogLinks();
  return usePlayerStore((st) => {
    const now = st.now?.item;
    if (!now || !sameSong(links, now.Id, id)) return 'none';
    return st.status === 'loading' && isCatalogSong(now) ? 'loading' : 'playing';
  });
}
