/**
 * The IPTV state: the providers of the signed-in account, the loaded channel
 * lists (memory only; the files hold them between launches), favourites and
 * recents, and the guide windows. Small data is saved to MMKV here; big data
 * goes to files in `manager.ts`.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { EMPTY_LISTS } from './lists';
import { EMPTY_PROVIDERS, migrateLists, migrateProviders } from './migrate';
import type { SlicedProgramme } from './programme-index';
import { migrateRecentSearches, type RecentSearches, type SearchIndex } from './search';
import type { Channel, ChannelLists, GuideWindow, ProvidersSnapshot } from './types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProviderData {
  status: LoadStatus;
  channels: Channel[];
  index: SearchIndex | null;
  /** A message for the person (never with a URL). */
  error: string | null;
  /** A refresh runs while the saved list shows. */
  refreshing: boolean;
}

export const EMPTY_DATA: ProviderData = { status: 'idle', channels: [], index: null, error: null, refreshing: false };

export interface Scope {
  serverId: string;
  userId: string;
}

export interface IptvState {
  /** `serverId:userId` of the account the providers belong to, or null with no account. */
  scope: string | null;
  providers: ProvidersSnapshot;
  /** The provider the Live TV page shows. */
  activeId: string | null;
  data: Record<string, ProviderData>;
  lists: Record<string, ChannelLists>;
  guides: Record<string, GuideWindow>;
  /** M3U: XMLTV display names (lower case) to guide ids. */
  guideNames: Record<string, Record<string, string>>;
  guideStatus: Record<string, LoadStatus>;
  /** Recent channel searches per provider (loaded on first use). */
  searches: Record<string, RecentSearches>;
  /** Per provider: the programmes on in `from`..`to` (about two hours), from the saved programme index. */
  programmeSlices: Record<string, ProgrammeSlice>;
}

export interface ProgrammeSlice {
  from: number;
  to: number;
  programmes: SlicedProgramme[];
}

export const useIptvStore = create<IptvState>(() => ({
  scope: null,
  providers: EMPTY_PROVIDERS,
  activeId: null,
  data: {},
  lists: {},
  guides: {},
  guideNames: {},
  guideStatus: {},
  searches: {},
  programmeSlices: {},
}));

export const iptvState = () => useIptvStore.getState();
export const setIptvState = (patch: Partial<IptvState>) => useIptvStore.setState(patch);

export const scopeId = (s: Scope) => `${s.serverId}:${s.userId}`;
const providersKey = (s: Scope) => `iptv.providers.${s.serverId}.${s.userId}`;
const activeKey = (s: Scope) => `iptv.active.${s.serverId}.${s.userId}`;
const listsKey = (providerId: string) => `iptv.lists.${providerId}`;
const searchesKey = (providerId: string) => `iptv.searches.${providerId}`;

export function loadProviders(s: Scope): ProvidersSnapshot {
  return migrateProviders(readJson<unknown>(providersKey(s), null));
}

export function saveProviders(s: Scope, snap: ProvidersSnapshot): void {
  writeJson(providersKey(s), snap);
}

export function loadActive(s: Scope): string | null {
  return storage.getString(activeKey(s)) ?? null;
}

export function saveActive(s: Scope, id: string | null): void {
  if (id) storage.set(activeKey(s), id);
  else storage.remove(activeKey(s));
}

export function loadLists(providerId: string): ChannelLists {
  const raw = readJson<unknown>(listsKey(providerId), null);
  return raw === null ? EMPTY_LISTS : migrateLists(raw);
}

export function saveLists(providerId: string, lists: ChannelLists): void {
  writeJson(listsKey(providerId), lists);
}

export function removeLists(providerId: string): void {
  storage.remove(listsKey(providerId));
  storage.remove(searchesKey(providerId));
}

export function loadSearches(providerId: string): RecentSearches {
  return migrateRecentSearches(readJson<unknown>(searchesKey(providerId), null));
}

export function saveSearches(providerId: string, searches: RecentSearches): void {
  writeJson(searchesKey(providerId), searches);
}

/** Sets part of one provider's data. */
export function patchData(providerId: string, patch: Partial<ProviderData>): void {
  const st = iptvState();
  setIptvState({ data: { ...st.data, [providerId]: { ...(st.data[providerId] ?? EMPTY_DATA), ...patch } } });
}
