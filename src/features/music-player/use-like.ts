/**
 * The Like heart of the music players (phone, iPad and TV).
 *
 * The audio queue is saved to storage with a copy of each song taken when
 * playback started, and it comes back after a restart. A song liked in an
 * earlier run of the app still carried its old `IsFavorite: false`, so the
 * heart showed it as not liked. The state now comes, in this order, from a
 * change made in this app session (favourite-overrides.ts), the server's
 * current copy of the song (the item query), and only then the queue's copy.
 *
 * A change updates the cached item, so the item page and the next start of
 * the player agree, and refreshes every Liked Songs list.
 */
import { useQueryClient } from '@tanstack/react-query';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { useItem } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { setFavouriteOverride, useIsFavourite } from '@/features/actions/favourite-overrides';
import { toast } from '@/lib/toast';

export function useLike(item: BaseItemDto | undefined): { liked: boolean; toggle: () => Promise<void> } {
  const { api, userId, scope } = useApi();
  const qc = useQueryClient();
  const fresh = useItem(item?.Id);
  // Keyed by the queue's Id: a catalog song's fresh copy can carry its library Id.
  const base = item ? { Id: item.Id, UserData: fresh.data?.UserData ?? item.UserData } : undefined;
  const liked = useIsFavourite(userId, base);

  // The React Compiler memoizes this; no useCallback.
  const toggle = async () => {
    const id = item?.Id;
    if (!id) return;
    const on = !liked;
    setFavouriteOverride(userId, id, on);
    try {
      await jf.setFavorite(api, userId, id, on);
      qc.setQueryData<BaseItemDto>(queryKeys.item(scope, id), (old) => (old?.UserData ? { ...old, UserData: { ...old.UserData, IsFavorite: on } } : old));
      void qc.invalidateQueries(queryKeys.likedSongs(scope));
    } catch (e) {
      setFavouriteOverride(userId, id, !on);
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  };
  return { liked, toggle };
}
