/**
 * The icon of an extension page. A manifest names an icon of the app
 * (`components/icon-names.ts`, an SF Symbol name). A name the app does not
 * have gives the default icon, so a manifest can never show a blank glyph.
 *
 * The native tab bar takes the icon as an SF Symbol (iOS, iPad, the web
 * build) and as a Material Symbol (Android), like the built-in tabs in
 * `src/app/(tabs)/_layout.tsx`.
 *
 * Pure, so it is unit-tested.
 */
import { ANDROID_SYMBOLS, isIconName, type IconName } from '@/components/icon-names';

/** The icon of a page that names no icon, or one the app does not have. */
export const DEFAULT_PAGE_ICON: IconName = 'square.grid.2x2';

/** The page's own icon when the app has it, else the default. */
export function pageIconName(name: string | undefined): IconName {
  return name && isIconName(name) ? name : DEFAULT_PAGE_ICON;
}

export interface PageTabIcon {
  /** The SF Symbol (iOS, iPad, web). */
  sf: IconName;
  /** The Material Symbol (Android). */
  md: (typeof ANDROID_SYMBOLS)[IconName];
}

/** The tab bar icon of a page: the same glyph in both icon sets. */
export function pageTabIcon(name: string | undefined): PageTabIcon {
  const sf = pageIconName(name);
  return { sf, md: ANDROID_SYMBOLS[sf] };
}
