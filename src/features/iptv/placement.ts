/**
 * Where Live TV shows outside its own pages, and what those places say.
 *
 * - The Library tab: a "Live TV" tile in the grid of libraries (iPhone,
 *   iPad, Android). It sits after the server's libraries, as one more
 *   source of things to watch. The web and the Mac app have a Live TV tab
 *   and TV has the side menu, so there is no tile there.
 * - Home: a "Live TV" row with the favourite channels, then the channels
 *   watched last, and an "All channels" tile at the end. A tap on a channel
 *   plays it. The row shows only when the account has a provider.
 *
 * iOS shows nothing about Live TV until a provider is added in Settings.
 * The App Store build is a Jellyfin client first, and the app ships no
 * channels of its own, so an empty Live TV entry only confuses.
 *
 * Pure, so it is unit-tested.
 */
import type { BaseItemDto } from '@/api/types';
import type { ProviderChannel } from '@/iptv';

/** The most channels the Home row shows before "All channels". */
export const HOME_ROW_MAX = 20;

/** The Id of the Live TV tile in the Library grid. Not a Jellyfin Id. */
export const LIVE_TV_TILE_ID = 'zoggyfin.live-tv';

export interface PlacementEnv {
  /** `Platform.OS`. */
  os: string;
  /** Live TV is a tab of its own (web, the Mac app). */
  tab: boolean;
  tv: boolean;
}

/** True where the Library grid shows the Live TV tile. */
export function showLibraryTile(env: PlacementEnv, providerCount: number): boolean {
  if (env.tab || env.tv) return false;
  return env.os !== 'ios' || providerCount > 0;
}

/** True where Home shows the Live TV row. TV Home is the billboard and its rows; TV has Live TV in the side menu. */
export function showHomeRow(env: PlacementEnv, providerCount: number): boolean {
  return !env.tv && providerCount > 0;
}

/**
 * The channels of the Home row: the favourites first (in their own order),
 * then the channels watched last that are not favourites, at most `max`.
 */
export function homeRowChannels(
  favourites: readonly ProviderChannel[],
  recents: readonly ProviderChannel[],
  max: number = HOME_ROW_MAX,
): ProviderChannel[] {
  const seen = new Set<string>();
  const out: ProviderChannel[] = [];
  for (const c of [...favourites, ...recents]) {
    if (out.length >= max) break;
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

/** The line under the Live TV tile in the Library. */
export function libraryTileSubtitle(providerNames: readonly string[], favouriteCount: number): string {
  if (favouriteCount > 0) return favouriteCount === 1 ? '1 favourite' : `${favouriteCount} favourites`;
  if (!providerNames.length) return 'Add an IPTV provider';
  if (providerNames.length === 1) return providerNames[0];
  return `${providerNames.length} providers`;
}

/** The Library grid with the Live TV tile after the server's libraries. */
export function withLiveTvTile(views: readonly BaseItemDto[], show: boolean): BaseItemDto[] {
  if (!show) return [...views];
  return [...views, { Id: LIVE_TV_TILE_ID, Name: 'Live TV', Type: 'UserView', CollectionType: 'livetv' }];
}
