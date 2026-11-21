/**
 * The Live TV browse column: what it lists, in which order, and which group
 * a provider opens on. Order, top to bottom:
 * 1. with two providers or more, a "Providers" heading: "All providers" and
 *    each provider (picking one switches the page to it). First, so the
 *    switch is always at the top and never sits between the lists and the
 *    groups,
 * 2. Search (the quickest way to a channel),
 * 3. Favourites, when it has channels,
 * 4. Recently watched, when it has channels,
 * 5. All channels,
 * 6. Favourites, when it is empty (it explains how to add one),
 * 7. the sections of other kinds of content (for example films and series),
 * 8. a "Groups" heading and the provider's groups, in the provider's order,
 * 9. Manage providers (add, edit, reload or remove one), last.
 *
 * "All providers" (`mergedBrowseEntries`): the "Providers" heading and its
 * entries, then Search, Favourites, Recently watched of every provider, and
 * Manage providers. Groups, All channels, films and series stay per
 * provider: picking a provider shows them.
 * Pure, so it is unit-tested.
 */
import { ALL_GROUP, FAVOURITES_GROUP, type GroupView, RECENTS_GROUP } from './lists';

export const SEARCH_ENTRY = 'search';
export const PROVIDERS_ENTRY = 'providers';

/** Another kind of content beside the live channels (a page of its own). */
export interface BrowseSection {
  key: string;
  label: string;
}

export type BrowseEntry =
  | { kind: 'search'; key: typeof SEARCH_ENTRY }
  | { kind: 'group'; key: string; group: GroupView }
  | { kind: 'section'; key: string; section: BrowseSection }
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'provider'; key: string; providerId: string; label: string }
  | { kind: 'providers'; key: typeof PROVIDERS_ENTRY };

/** A provider to switch to (`providerId` is ALL_PROVIDERS for "All providers"). */
export interface ProviderEntry {
  providerId: string;
  label: string;
}

/** The browse key of a provider entry. */
export const providerEntryKey = (providerId: string) => `provider:${providerId}`;

function pushProviders(out: BrowseEntry[], providers: readonly ProviderEntry[]): void {
  if (providers.length < 2) return;
  out.push({ kind: 'heading', key: 'heading:providers', label: 'Providers' });
  for (const p of providers) out.push({ kind: 'provider', key: providerEntryKey(p.providerId), providerId: p.providerId, label: p.label });
}

/** `providers`: "All providers" and each provider, shown when there are two real providers or more. */
export function browseEntries(groups: readonly GroupView[], sections: readonly BrowseSection[] = [], providers: readonly ProviderEntry[] = []): BrowseEntry[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const fav = byKey.get(FAVOURITES_GROUP);
  const recent = byKey.get(RECENTS_GROUP);
  const all = byKey.get(ALL_GROUP);
  const own = groups.filter((g) => g.key !== FAVOURITES_GROUP && g.key !== RECENTS_GROUP && g.key !== ALL_GROUP && g.count > 0);
  const out: BrowseEntry[] = [];
  pushProviders(out, providers);
  out.push({ kind: 'search', key: SEARCH_ENTRY });
  const group = (g: GroupView | undefined) => {
    if (g) out.push({ kind: 'group', key: g.key, group: g });
  };
  if (fav && fav.count > 0) group(fav);
  if (recent && recent.count > 0) group(recent);
  group(all);
  if (fav && fav.count === 0) group(fav);
  for (const s of sections) out.push({ kind: 'section', key: `section:${s.key}`, section: s });
  if (own.length) {
    out.push({ kind: 'heading', key: 'heading:groups', label: 'Groups' });
    for (const g of own) group(g);
  }
  out.push({ kind: 'providers', key: PROVIDERS_ENTRY });
  return out;
}

/** The browse column of "All providers": the providers, then the merged lists. */
export function mergedBrowseEntries(favourites: number, recents: number, providers: readonly ProviderEntry[]): BrowseEntry[] {
  const fav: GroupView = { key: FAVOURITES_GROUP, label: 'Favourites', count: favourites };
  const recent: GroupView = { key: RECENTS_GROUP, label: 'Recently watched', count: recents };
  const out: BrowseEntry[] = [];
  pushProviders(out, providers);
  out.push({ kind: 'search', key: SEARCH_ENTRY }, { kind: 'group', key: fav.key, group: fav }, { kind: 'group', key: recent.key, group: recent });
  out.push({ kind: 'providers', key: PROVIDERS_ENTRY });
  return out;
}

/** "All providers" opens on Favourites when there are some, else Recently watched when there are some. */
export function mergedDefaultGroup(favourites: number, recents: number, picked: string | null): string {
  if (picked === FAVOURITES_GROUP || picked === RECENTS_GROUP) return picked;
  return favourites > 0 || recents === 0 ? FAVOURITES_GROUP : RECENTS_GROUP;
}

/** The group a provider opens on: Favourites when it has channels, else All channels. */
export function defaultGroup(groups: readonly GroupView[]): string {
  const fav = groups.find((g) => g.key === FAVOURITES_GROUP);
  return fav && fav.count > 0 ? FAVOURITES_GROUP : ALL_GROUP;
}

/** The picked group, or the default when the pick is gone (a refresh removed the group). */
export function resolveGroup(groups: readonly GroupView[], picked: string | null): string {
  if (picked && groups.some((g) => g.key === picked)) return picked;
  return defaultGroup(groups);
}
