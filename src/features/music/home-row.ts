/**
 * What a music Home section gets from the page: which row takes the first TV
 * focus, and the long press that opens the item action sheet. A section
 * calls `useMusicHomeRow(hasItems)` and passes the result to its `ItemRow`.
 */
import { createContext, useContext, useEffect } from 'react';

import type { BaseItemDto } from '@/api/types';
import { isTV } from '@/platform/tv';

export interface MusicHomeRows {
  /** A section shows a row (true) or nothing (false). */
  report(sectionId: string, filled: boolean): void;
  /** The section whose row takes the first TV focus. */
  first: string | undefined;
  openMenu(item: BaseItemDto): void;
}

export const MusicHomeRowsContext = createContext<MusicHomeRows | null>(null);
/** The id of the section being rendered, set by the page around each section. */
export const MusicHomeSectionId = createContext('');

export function useMusicHomeRow(hasItems: boolean): { preferredFocus: boolean; onLongPress?: (item: BaseItemDto) => void } {
  const rows = useContext(MusicHomeRowsContext);
  const id = useContext(MusicHomeSectionId);
  const report = rows?.report;
  useEffect(() => {
    report?.(id, hasItems);
  }, [report, id, hasItems]);
  useEffect(() => () => report?.(id, false), [report, id]);
  return {
    preferredFocus: isTV && !!id && rows?.first === id,
    // TV has no long press menu on tiles.
    onLongPress: isTV ? undefined : rows?.openMenu,
  };
}
