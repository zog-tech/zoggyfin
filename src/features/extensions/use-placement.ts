/**
 * The placement of extension pages for this device and the signed-in
 * account. The rule is in `placement.ts` (pure, tested); this file gives it
 * the platform and the store, so it follows installs, the on/off switch, the
 * chosen tab page, the phone's "On this phone" choice and the account switch.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useExtensions } from '@/extensions/store';
import { isDesktop } from '@/platform/desktop';
import type { ReplaceableTab } from '@/lib/tab-destination';
import { features, isTV } from '@/platform/tv';

import { type PagePlacement, type PlacedPage, type PlacementExtension, placePages, placementPlatform } from './placement';

/** This device's kind for the placement rule. */
export const PLACEMENT_PLATFORM = placementPlatform({
  os: Platform.OS,
  isPad: Platform.OS === 'ios' && Platform.isPad,
  tv: isTV,
  desktop: isDesktop,
});

const ENV = { downloads: features.downloads };

/** Where each extension page shows on this device, for a list of the store. */
export function placementOf(list: readonly PlacementExtension[]): PagePlacement {
  return placePages(PLACEMENT_PLATFORM, list, ENV);
}

/** Where each extension page shows on this device. */
export function usePagePlacement(): PagePlacement {
  const list = useExtensions((st) => st.list);
  return useMemo(() => placementOf(list), [list]);
}

/** The tab an extension page takes the place of on this phone now, or null (outside React). */
export function replacedTabNow(): ReplaceableTab | null {
  return placementOf(useExtensions.getState().list).replaces;
}

/** The tab an extension page takes the place of on this phone, or null. */
export function useReplacedTab(): ReplaceableTab | null {
  return usePagePlacement().replaces;
}

/** The page in the visible tab slot, or null when the slot is hidden. */
export function useTabSlotPage(): PlacedPage | null {
  return usePagePlacement().tab;
}
