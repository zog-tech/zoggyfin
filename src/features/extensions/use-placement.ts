/**
 * The placement of extension pages for this device and the signed-in
 * account. The rule is in `placement.ts` (pure, tested); this file gives it
 * the platform and the store, so it follows installs, the on/off switch, the
 * chosen tab page and the account switch.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useExtensions } from '@/extensions/store';
import { isDesktop } from '@/platform/desktop';
import { isTV } from '@/platform/tv';

import { type PagePlacement, type PlacedPage, placePages, placementPlatform } from './placement';

/** This device's kind for the placement rule. */
export const PLACEMENT_PLATFORM = placementPlatform({
  os: Platform.OS,
  isPad: Platform.OS === 'ios' && Platform.isPad,
  tv: isTV,
  desktop: isDesktop,
});

/** Where each extension page shows on this device. */
export function usePagePlacement(): PagePlacement {
  const list = useExtensions((st) => st.list);
  return useMemo(() => placePages(PLACEMENT_PLATFORM, list), [list]);
}

/** The page in the visible tab slot, or null when the slot is hidden. */
export function useTabSlotPage(): PlacedPage | null {
  return usePagePlacement().tab;
}
