/**
 * The favourite changes made in this app session, per user and item.
 *
 * The music player shows the queue's copy of a song, taken when playback
 * started, and the queue never refetches it. Without this record, the heart
 * went back to that old state each time the player opened again, so a second
 * tap undid the first instead of liking the song again. The player heart and
 * the action sheet both write here, and the heart reads it before the item.
 * Kept in memory only: after a restart, items come fresh from the server.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';

type Overrides = Readonly<Record<string, boolean>>;

const useOverrides = create<Overrides>(() => ({}));

function key(userId: string, itemId: string): string {
  return `${userId}:${itemId}`;
}

/** The item's favourite state for the user: a change made in this session wins over the item's copy. Pure. */
export function favouriteState(overrides: Overrides, userId: string, item: Pick<BaseItemDto, 'Id' | 'UserData'>): boolean {
  const override = item.Id ? overrides[key(userId, item.Id)] : undefined;
  return override ?? !!item.UserData?.IsFavorite;
}

export function setFavouriteOverride(userId: string, itemId: string, on: boolean): void {
  useOverrides.setState({ [key(userId, itemId)]: on });
}

/** The favourite state of an item for the user, following changes made anywhere in the app. */
export function useIsFavourite(userId: string, item: Pick<BaseItemDto, 'Id' | 'UserData'> | undefined): boolean {
  return useOverrides((o) => (item ? favouriteState(o, userId, item) : false));
}
