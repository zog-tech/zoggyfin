/**
 * The open state of the "Download quality" sheet. One host at the root
 * (`DownloadQualityHost`); the Download action opens it with
 * `openDownloadQuality(item)`.
 *
 * `takeDownloadQualityItem` closes the sheet and hands out the item once,
 * so a second tap on a row in the same frame (or during the close
 * animation) starts no second download.
 *
 * No React in this file, so it is unit-tested.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';

export const useDownloadQualitySheet = create<{ item: BaseItemDto | null }>(() => ({ item: null }));

export function openDownloadQuality(item: BaseItemDto): void {
  if (item.Id) useDownloadQualitySheet.setState({ item });
}

/** Closes the sheet. Nothing starts. */
export function closeDownloadQuality(): void {
  useDownloadQualitySheet.setState({ item: null });
}

/** Closes the sheet and returns its item, or null when it was closed already. */
export function takeDownloadQualityItem(): BaseItemDto | null {
  const { item } = useDownloadQualitySheet.getState();
  if (item) useDownloadQualitySheet.setState({ item: null });
  return item;
}
