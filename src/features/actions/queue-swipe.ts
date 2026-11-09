/**
 * The queue actions of a song row swipe (`SwipeRow`): swipe right for
 * "Play next", swipe left for "Add to queue". The same two actions are in the
 * row's accessibility actions, so a screen reader reaches them too.
 *
 * Queueing only puts the item into the queue; nothing loads until it plays
 * (`player/audio/session.ts`), so a catalog song is fetched when it plays.
 */
import type { AccessibilityActionInfo } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import type { SwipeAction } from '@/components/swipe-row';
import { isAudioItem, usePlayer } from '@/player';
import { useTheme } from '@/theme';

/** Which queue actions a row offers: both (its own swipe), or "Add to queue" only (the row's swipe left deletes). */
export type QueueSwipe = 'both' | 'add';

export const PLAY_NEXT_ACTION = 'playNext';
export const ADD_TO_QUEUE_ACTION = 'addToQueue';

/** True for an item a song row can queue. */
export function canQueue(item: BaseItemDto): boolean {
  return !!item.Id && item.Type !== 'Playlist' && isAudioItem(item);
}

/** The accessibility actions for a row that offers `mode`. */
export function queueAccessibilityActions(mode: QueueSwipe): AccessibilityActionInfo[] {
  const add = { name: ADD_TO_QUEUE_ACTION, label: 'Add to queue' };
  return mode === 'both' ? [{ name: PLAY_NEXT_ACTION, label: 'Play next' }, add] : [add];
}

export function useQueueSwipe() {
  const player = usePlayer();
  const { c } = useTheme();
  return {
    playNext: (item: BaseItemDto): SwipeAction => ({
      label: 'Play next',
      icon: 'text.line.first.and.arrowtriangle.forward',
      color: c.accent,
      textColor: c.onAccent,
      run: () => player.playNext(item),
    }),
    addToQueue: (item: BaseItemDto): SwipeAction => ({
      label: 'Add to queue',
      icon: 'text.append',
      color: c.surface3,
      textColor: c.text,
      run: () => player.addToQueue(item),
    }),
    /** Runs a queue accessibility action; false when the name is not one. */
    runAccessibility: (name: string, item: BaseItemDto): boolean => {
      if (name === PLAY_NEXT_ACTION) player.playNext(item);
      else if (name === ADD_TO_QUEUE_ACTION) player.addToQueue(item);
      else return false;
      return true;
    },
  };
}
