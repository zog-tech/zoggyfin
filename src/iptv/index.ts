/**
 * The app-level IPTV interface (Live TV). Screens use these hooks and the
 * `iptv` object and never call a provider, the files or the secure store.
 * Providers belong to the signed-in account (server Id + user Id).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { usePlayer } from '@/player';

import { buildGroups, channelsInGroup, EMPTY_LISTS, type GroupView } from './lists';
import {
  bindSession,
  clearSearches,
  ensureAllLoaded,
  ensureLoaded,
  formValues,
  loadGuide,
  markWatched,
  moveProvider,
  nowNextOf,
  playMergedRequest,
  playRequest,
  providerById,
  recentSearchesOf,
  refresh,
  rememberSearchFor,
  removeProvider,
  requestNowNext,
  saveProvider,
  setActiveProvider,
  setStartWith,
  streamPlatform,
  toggleFavourite,
} from './manager';
import { ALL_PROVIDERS, type ChannelLookup, mergedFavourites, mergedRecents, mergeSearchHits, type ProviderChannel, providerChannelKey, providersMissingSnaps } from './merged';
import { searchChannels, searchChannelsRanked } from './search';
import { EMPTY_DATA, loadLists, type ProviderData, setIptvState, iptvState, useIptvStore } from './store';
import { checkAdmin, loadShareTargets, setShareChoice, useShareStore } from './share-sync';
import { needsHls } from './stream-url';
import { transport } from './transport';
import type { Channel, ChannelLists, NowNext, ProviderRecord } from './types';

export type { Channel, NowNext, ProviderInput, ProviderKind, ProviderRecord, Programme } from './types';
export type { GroupView } from './lists';
export type { ProviderData, LoadStatus } from './store';
export { ALL_GROUP, FAVOURITES_GROUP, RECENTS_GROUP } from './lists';
export { ALL_PROVIDERS, asProviderChannel, type ProviderChannel } from './merged';
export { browseEntries, type BrowseEntry, type BrowseSection, defaultGroup, mergedBrowseEntries, mergedDefaultGroup, type ProviderEntry, providerEntryKey, PROVIDERS_ENTRY, resolveGroup, SEARCH_ENTRY } from './browse';
export { providerChannelKey } from './merged';
export { iptvErrorText } from './errors';
export { progressOf } from './guide';
export { startIptvSync, syncSoon } from './sync';
export { sharedLabel, type ShareChoice } from './shared';
// Films and series (phase 3).
export * from './vod-hooks';

/** True when this platform sends the provider's user agent (the apps); a browser cannot. */
export const sendsUserAgent: boolean = transport.sendsUserAgent;
/** True where plain `.ts` channels need their HLS form (iPhone, iPad, Apple TV, browsers). */
export const prefersHls: boolean = needsHls(streamPlatform);

export const iptv = {
  save: saveProvider,
  remove: removeProvider,
  refresh,
  formValues,
  setActive: setActiveProvider,
  toggleFavourite,
  markWatched,
  /** Moves a provider up (-1) or down (+1) in the list. */
  move: moveProvider,
  /** What Live TV opens on: a provider id, ALL_PROVIDERS, or null (the last one used). */
  setStartWith,
  reloadGuide: (id: string) => loadGuide(id, true),
  /** Xtream: asks for now and next of the channels on screen. */
  requestNowNext: (providerId: string, channels: readonly Channel[]) => requestNowNext(providerId, channels),
  provider: providerById,
  /** Keeps a search the person used (they played one of its channels). */
  rememberSearch: rememberSearchFor,
  clearSearches,
  /** Admins: the server's users and who each provider is shared with. */
  shareTargets: loadShareTargets,
  /** Admins: shares a provider with users (or everyone), or stops (null). */
  share: setShareChoice,
};

/** True when the signed-in user is an admin of the server (false while unknown). */
export function useIsAdmin(): boolean {
  const scope = useIptvStore((s) => s.scope);
  const admin = useShareStore((s) => (scope ? s.admin[scope] : undefined));
  useEffect(() => {
    if (scope && admin === undefined) void checkAdmin().catch(() => undefined);
  }, [scope, admin]);
  return admin === true;
}

/** The recent channel searches of a provider, newest first. */
export function useRecentSearches(providerId: string | null): string[] {
  const kept = useIptvStore((s) => (providerId ? s.searches[providerId] : undefined));
  return useMemo(() => (providerId ? (kept ?? recentSearchesOf(providerId)).queries : []), [providerId, kept]);
}

/** The providers of the signed-in account, in order. */
export function useProviders(): ProviderRecord[] {
  bindSession();
  return useIptvStore(useShallow((s) => s.providers.order.map((id) => s.providers.providers[id]).filter((p): p is ProviderRecord => !!p)));
}

/**
 * What the Live TV page shows: a provider id, or ALL_PROVIDERS ("All
 * providers", only with two providers or more). Else the first provider.
 */
export function useLiveView(): string | null {
  bindSession();
  return useIptvStore((s) => {
    if (s.activeId === ALL_PROVIDERS && s.providers.order.length > 1) return ALL_PROVIDERS;
    return s.activeId && s.providers.providers[s.activeId] ? s.activeId : (s.providers.order[0] ?? null);
  });
}

/**
 * A real provider for pages of one provider (films and series): the one
 * Live TV shows, or the first one while it shows "All providers".
 */
export function useActiveProviderId(): string | null {
  bindSession();
  return useIptvStore((s) => (s.activeId && s.providers.providers[s.activeId] ? s.activeId : (s.providers.order[0] ?? null)));
}

/** What Live TV opens on (a provider id, ALL_PROVIDERS, or null for the last one used). */
export function useStartWith(): string | null {
  bindSession();
  return useIptvStore((s) => s.providers.startWith ?? null);
}

/** Channels by id, built once per loaded list (the merged lists ask often). */
const byIdCache = new WeakMap<readonly Channel[], Map<string, Channel>>();
function byId(channels: readonly Channel[]): Map<string, Channel> {
  let m = byIdCache.get(channels);
  if (!m) {
    m = new Map(channels.map((c) => [c.id, c]));
    byIdCache.set(channels, m);
  }
  return m;
}

/**
 * "All providers": Favourites and Recently watched of every provider. They
 * need no channel list in memory (the lists keep a snap of each channel); a
 * provider whose lists predate the snaps loads its list once.
 */
export function useMergedLists(enabled: boolean): { favourites: ProviderChannel[]; recents: ProviderChannel[] } {
  bindSession();
  const order = useIptvStore(useShallow((s) => s.providers.order));
  const lists = useIptvStore((s) => s.lists);
  const data = useIptvStore((s) => s.data);
  useEffect(() => {
    if (!enabled) return;
    // The lists are small (MMKV): read the ones not in memory yet.
    const st = iptvState();
    const missing = order.filter((id) => !st.lists[id]);
    if (missing.length) setIptvState({ lists: { ...st.lists, ...Object.fromEntries(missing.map((id) => [id, loadLists(id)])) } });
  }, [enabled, order]);
  const listsOf = useCallback((id: string) => lists[id] ?? EMPTY_LISTS, [lists]);
  useEffect(() => {
    if (!enabled) return;
    for (const id of providersMissingSnaps(order, listsOf)) void ensureLoaded(id);
  }, [enabled, order, listsOf]);
  return useMemo(() => {
    if (!enabled) return { favourites: [], recents: [] };
    const lookup: ChannelLookup = (pid, cid) => {
      const d = data[pid];
      return d && d.status === 'ready' ? (byId(d.channels).get(cid) ?? null) : undefined;
    };
    return { favourites: mergedFavourites(order, listsOf, lookup), recents: mergedRecents(order, listsOf, lookup) };
  }, [enabled, order, listsOf, data]);
}

/**
 * "All providers": a channel search over every provider. It loads each
 * provider's list (saved lists first), so it is the one part of the merged
 * view that holds every list in memory.
 */
export function useMergedSearch(enabled: boolean, query: string): { results: ProviderChannel[]; loading: boolean } {
  bindSession();
  const order = useIptvStore(useShallow((s) => s.providers.order));
  const data = useIptvStore((s) => s.data);
  const active = enabled && !!query.trim();
  useEffect(() => {
    if (active) void ensureAllLoaded();
  }, [active]);
  return useMemo(() => {
    if (!active) return { results: [], loading: false };
    const per = order.map((providerId) => {
      const index = data[providerId]?.index;
      return { providerId, hits: index ? searchChannelsRanked(index, query, MERGED_SEARCH_LIMIT) : [] };
    });
    const loading = order.some((id) => {
      const st = data[id]?.status ?? 'idle';
      return st === 'idle' || st === 'loading';
    });
    return { results: mergeSearchHits(per, MERGED_SEARCH_LIMIT), loading };
  }, [active, order, data, query]);
}

/** The most hits a search shows (one provider or all). */
export const MERGED_SEARCH_LIMIT = 300;

/** The channel list of a provider; loads it (from the file, else the provider) when it is not loaded. */
export function useChannels(providerId: string | null): ProviderData {
  bindSession();
  const data = useIptvStore((s) => (providerId ? (s.data[providerId] ?? EMPTY_DATA) : EMPTY_DATA));
  useEffect(() => {
    if (providerId) void ensureLoaded(providerId);
  }, [providerId]);
  return data;
}

export function useChannelLists(providerId: string | null): ChannelLists {
  return useIptvStore((s) => (providerId ? (s.lists[providerId] ?? EMPTY_LISTS) : EMPTY_LISTS));
}

/** The groups (Favourites and Recently watched first) and the channels of the picked group, or the search hits. */
export function useChannelView(providerId: string | null, group: string, query: string): { groups: GroupView[]; channels: Channel[] } {
  const data = useChannels(providerId);
  const lists = useChannelLists(providerId);
  const groups = useMemo(() => buildGroups(data.channels, lists), [data.channels, lists]);
  const channels = useMemo(() => {
    if (query.trim() && data.index) return searchChannels(data.index, query, 300);
    return channelsInGroup(data.channels, lists, group);
  }, [data.channels, data.index, lists, group, query]);
  return { groups, channels };
}

/** The time now, to the minute (now and next move on by themselves). */
export function useMinute(): number {
  const [now, setNow] = useState(() => minuteOf(Date.now()));
  useEffect(() => {
    // Checked every 15 s, but the value (and every list row that reads it) changes once a minute.
    const t = setInterval(() => setNow(minuteOf(Date.now())), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function minuteOf(ms: number): number {
  return ms - (ms % 60_000);
}

const NO_NOW_NEXT: NowNext = { now: null, next: null };

/**
 * Now and next of a channel. It re-renders only when this channel's own now or next programme
 * changes, not on every guide load: a list keeps many rows mounted, and a slow TV stick cannot
 * render them all again for each guide answer.
 */
export function useNowNext(providerId: string | null, channel: Channel | null, at: number): NowNext {
  const nn = useIptvStore(useShallow((s) => (providerId && channel && s.guides[providerId] ? nowNextOf(providerId, channel, at) : NO_NOW_NEXT)));
  return nn.now || nn.next ? nn : NO_NOW_NEXT;
}

/** Plays a channel; channel up and down move through `list`. */
export function usePlayChannel(): (providerId: string, list: readonly Channel[], channel: Channel) => void {
  const player = usePlayer();
  return (providerId, list, channel) => player.playLive(playRequest(providerId, list, channel));
}

/** Plays a channel of a merged list ("All providers"); channel up and down stay in that list. */
export function usePlayMerged(): (list: readonly ProviderChannel[], item: ProviderChannel) => void {
  const player = usePlayer();
  return (list, item) => player.playLive(playMergedRequest(list, item));
}

/** The favourites of every provider in memory, as merged keys (`providerChannelKey`). */
export function useFavouriteKeys(): ReadonlySet<string> {
  const lists = useIptvStore((s) => s.lists);
  return useMemo(() => {
    const keys = new Set<string>();
    for (const [pid, l] of Object.entries(lists)) for (const id of l.favourites) keys.add(providerChannelKey(pid, id));
    return keys;
  }, [lists]);
}
