/**
 * IPTV actions: providers (add, edit, remove, refresh), the channel cache in
 * files, the guides, favourites and recents, and playing a channel. Screens
 * reach it through `index.ts`. The pure rules live in their own files; this
 * file does the I/O. Nothing here logs a URL or a secret.
 */
import { Platform } from 'react-native';

import { useSessionStore } from '@/auth/session-store';
import { randomId } from '@/lib/id';
import { tsBridge } from '@/native/ts-bridge';
import { isDesktop } from '@/platform/desktop';
import { isTV } from '@/platform/tv';
import type { LiveChannelRef, LivePlayRequest, LiveSource } from '@/player';
import { forgetProviderTracks } from '@/player/track-prefs-store';

import { IptvError, iptvErrorText, isHttpUrl } from './errors';
import { iptvFiles } from './files';
import { EMPTY_GUIDE, guideIdFor, isStale, nowNext, withProgrammes } from './guide';
import { addRecent, EMPTY_LISTS, snapOf, toggleFavourite as toggleIn, withSnaps } from './lists';
import { ALL_PROVIDERS, moveInOrder, type ProviderChannel, resolveActive, splitProviderChannelKey, uniqueProviderName } from './merged';
import { parseM3u } from './m3u';
import { migrateChannelsFile, migrateGuide } from './migrate';
import { buildSearchIndex, EMPTY_RECENT_SEARCHES, rememberSearch, type RecentSearches } from './search';
import { readSecrets, removeSecrets, writeSecrets } from './secrets';
import {
  EMPTY_DATA,
  iptvState,
  loadActive,
  loadLists,
  loadProviders,
  loadSearches,
  patchData,
  removeLists,
  saveActive,
  saveLists,
  saveProviders,
  saveSearches,
  type Scope,
  scopeId,
  setIptvState,
} from './store';
import { liveStreamFor, type StreamPlatform } from './stream-url';
import { transport } from './transport';
import { MAX_JSON_BYTES, MAX_LIST_BYTES } from './transport-types';
import {
  CHANNELS_SCHEMA_VERSION,
  type Channel,
  type ChannelsFile,
  GUIDE_SCHEMA_VERSION,
  type GuideWindow,
  type NowNext,
  PROVIDERS_SCHEMA_VERSION,
  type ProviderInput,
  type ProviderRecord,
  type ProviderSecrets,
  type ProvidersSnapshot,
  type ChannelLists,
} from './types';
import { splitM3uVod } from './m3u-vod';
import { removeVodData, resetVodState, saveVodLists, setM3uVod, setVodState, vodState } from './vod-store';
import type { VodLists } from './vod-types';
import { parseXmltv } from './xmltv';
import { connectionLimitText, normalizeXtreamInput, parseXtreamAuth, parseXtreamCategories, parseXtreamShortEpg, parseXtreamStreams, type XtreamLogin, xtreamApiUrl } from './xtream';

const HOUR = 3_600_000;
/** A saved list older than this loads again in the background when the page opens. */
const STALE_LIST_MS = 24 * HOUR;
/** The XMLTV window: programmes from now to this far ahead. */
const GUIDE_WINDOW_MS = 6 * HOUR;

export const streamPlatform: StreamPlatform =
  Platform.OS === 'ios' ? (isTV ? 'tvos' : 'ios') : Platform.OS === 'android' ? 'android' : isDesktop ? 'desktop' : 'web';

const dirOf = (id: string) => `iptv/${id}`;
const channelsPath = (id: string) => `iptv/${id}/channels.json`;
const guidePath = (id: string) => `iptv/${id}/guide.json`;
const namesPath = (id: string) => `iptv/${id}/names.json`;

// ---- Session scope ---------------------------------------------------------------

function currentScope(): Scope | null {
  const s = useSessionStore.getState().session;
  return s ? { serverId: s.serverId, userId: s.userId } : null;
}

function applyScope(scope: Scope | null): void {
  const id = scope ? scopeId(scope) : null;
  if (iptvState().scope === id) return;
  const providers = scope ? loadProviders(scope) : { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers: {}, order: [] };
  // The start the person chose (a provider or "All providers"), else the last one used.
  const activeId = resolveActive(providers.startWith, scope ? loadActive(scope) : null, providers.order);
  // Another account: its providers only; the memory of the old ones goes.
  setIptvState({ scope: id, providers, activeId, data: {}, lists: {}, guides: {}, guideNames: {}, guideStatus: {} });
  resetVodState();
}

let bound = false;

/** Follows the signed-in account (providers belong to one account). Safe to call often. */
export function bindSession(): void {
  if (bound) return;
  bound = true;
  applyScope(currentScope());
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.serverId !== prev.session?.serverId || s.session?.userId !== prev.session?.userId) applyScope(currentScope());
  });
}

function requireScope(): Scope {
  const scope = currentScope();
  if (!scope) throw new Error('Sign in first.');
  applyScope(scope);
  return scope;
}

function saveSnapshot(scope: Scope, providers: Record<string, ProviderRecord>, order: readonly string[], startWith = iptvState().providers.startWith ?? null): void {
  // A removed provider is no longer the start; "All providers" needs two.
  const start = startWith === ALL_PROVIDERS ? (order.length > 1 ? startWith : null) : startWith && providers[startWith] ? startWith : null;
  const snap = { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers, order: order.slice(), startWith: start };
  setIptvState({ providers: snap });
  saveProviders(scope, snap);
}

export function setActiveProvider(id: string | null): void {
  const scope = currentScope();
  setIptvState({ activeId: id });
  if (scope) saveActive(scope, id);
}

/** Moves a provider one place up (-1) or down (+1) in the list (chips, the browse column, "All providers"). */
export function moveProvider(id: string, delta: -1 | 1): void {
  const scope = requireScope();
  const st = iptvState();
  const order = moveInOrder(st.providers.order, id, delta);
  if (order !== st.providers.order) saveSnapshot(scope, st.providers.providers, order);
}

/** What Live TV opens on: a provider id, ALL_PROVIDERS, or null for the last one used. */
export function setStartWith(startWith: string | null): void {
  const scope = requireScope();
  const st = iptvState();
  saveSnapshot(scope, st.providers.providers, st.providers.order, startWith);
}

export function providerById(id: string): ProviderRecord | null {
  return iptvState().providers.providers[id] ?? null;
}

// ---- Loading channels --------------------------------------------------------------

export function xtreamLogin(record: ProviderRecord, secrets: ProviderSecrets): XtreamLogin | null {
  if (record.kind !== 'xtream' || !record.server || !secrets.username || !secrets.password) return null;
  return { server: record.server, username: secrets.username, password: secrets.password };
}

async function fetchXtream(login: XtreamLogin, userAgent: string | null): Promise<Channel[]> {
  const opts = { userAgent, maxBytes: MAX_JSON_BYTES };
  const auth = parseXtreamAuth(await transport.json(xtreamApiUrl(login), opts));
  if (!auth.ok) throw new IptvError(auth.reason);
  const [cats, streams] = await Promise.all([
    transport.json(xtreamApiUrl(login, 'get_live_categories'), opts),
    transport.json(xtreamApiUrl(login, 'get_live_streams'), opts),
  ]);
  return parseXtreamStreams(streams, parseXtreamCategories(cats));
}

async function fetchM3u(url: string, userAgent: string | null): Promise<{ channels: Channel[]; guideUrls: string[] }> {
  if (!isHttpUrl(url)) throw new IptvError('badAddress');
  const r = await parseM3u(transport.text(url.trim(), { userAgent, maxBytes: MAX_LIST_BYTES }));
  if (!r.looksLikeM3u) throw new IptvError('notM3u');
  return { channels: r.channels, guideUrls: r.guideUrls };
}

/** Fetches the channels of a provider (no state changes). */
async function fetchChannels(record: ProviderRecord, secrets: ProviderSecrets): Promise<{ channels: Channel[]; playlistGuideUrl?: string }> {
  if (record.kind === 'xtream') {
    const login = xtreamLogin(record, secrets);
    if (!login) throw new IptvError('denied');
    const channels = await fetchXtream(login, record.userAgent);
    if (!channels.length) throw new IptvError('empty');
    return { channels };
  }
  if (!secrets.playlistUrl) throw new IptvError('badAddress');
  const r = await fetchM3u(secrets.playlistUrl, record.userAgent);
  if (!r.channels.length) throw new IptvError('empty');
  return { channels: r.channels, playlistGuideUrl: r.guideUrls.find(isHttpUrl) };
}

/**
 * Shows a channel list. An M3U list can hold films and episodes too: they
 * go to Films and Series (`m3u-vod.ts`), and the channel list keeps the
 * live channels. The cache file keeps the whole list.
 */
function showChannels(id: string, entries: Channel[]): void {
  const split = providerById(id)?.kind === 'm3u' ? splitM3uVod(entries) : { live: entries, vod: null };
  setM3uVod(id, split.vod);
  const channels = split.live;
  patchData(id, { status: 'ready', channels, index: buildSearchIndex(channels), error: null, refreshing: false });
  // The favourites and recents keep a snap of their channels for "All providers" (new name, new logo).
  const lists = iptvState().lists[id] ?? loadLists(id);
  const next = withSnaps(lists, channels);
  if (next !== lists || !iptvState().lists[id]) setIptvState({ lists: { ...iptvState().lists, [id]: next } });
  if (next !== lists) saveLists(id, next);
}

/** The number of live channels shown for a provider. */
const liveCount = (id: string, fallback: number) => iptvState().data[id]?.channels.length ?? fallback;

async function writeChannels(id: string, channels: Channel[]): Promise<void> {
  const file: ChannelsFile = { schemaVersion: CHANNELS_SCHEMA_VERSION, providerId: id, savedAt: Date.now(), channels };
  try {
    await iptvFiles.write(channelsPath(id), JSON.stringify(file));
  } catch (e) {
    console.warn('[iptv] the channel list was not saved', e instanceof Error ? e.name : 'error');
  }
}

const inFlight = new Map<string, Promise<void>>();

/** Loads the channel list from the provider again and saves it. */
export function refresh(id: string): Promise<void> {
  const running = inFlight.get(id);
  if (running) return running;
  const job = (async () => {
    const record = providerById(id);
    if (!record) return;
    const data = iptvState().data[id] ?? EMPTY_DATA;
    patchData(id, data.status === 'ready' ? { refreshing: true, error: null } : { status: 'loading', error: null });
    try {
      const secrets = readSecrets(id);
      const r = await fetchChannels(record, secrets);
      if (!providerById(id)) return;
      if (r.playlistGuideUrl !== secrets.playlistGuideUrl) writeSecrets(id, { ...secrets, playlistGuideUrl: r.playlistGuideUrl });
      showChannels(id, r.channels);
      await writeChannels(id, r.channels);
      updateRecord(id, { refreshedAt: Date.now(), channelCount: liveCount(id, r.channels.length), hasGuide: record.kind === 'xtream' || !!(secrets.guideUrl || r.playlistGuideUrl) });
      void loadGuide(id, true);
    } catch (e) {
      const text = iptvErrorText(e);
      const now = iptvState().data[id] ?? EMPTY_DATA;
      // A refresh that fails keeps the saved list; the error shows above it.
      patchData(id, now.channels.length ? { status: 'ready', refreshing: false, error: text } : { status: 'error', error: text, refreshing: false });
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

/** Shows the saved list (or loads it), and refreshes a list that is a day old. */
export async function ensureLoaded(id: string): Promise<void> {
  const data = iptvState().data[id];
  if (!iptvState().lists[id]) setIptvState({ lists: { ...iptvState().lists, [id]: loadLists(id) } });
  if (data && data.status !== 'idle') return;
  patchData(id, { status: 'loading', error: null });
  const raw = await iptvFiles.read(channelsPath(id));
  let file: ChannelsFile | null = null;
  if (raw) {
    try {
      file = migrateChannelsFile(JSON.parse(raw), id);
    } catch {
      file = null;
    }
  }
  if (file && file.channels.length) {
    showChannels(id, file.channels);
    void loadGuide(id, false);
    if (Date.now() - file.savedAt > STALE_LIST_MS) void refresh(id);
    return;
  }
  await refresh(id);
}

function updateRecord(id: string, patch: Partial<ProviderRecord>): void {
  const scope = currentScope();
  const st = iptvState();
  const record = st.providers.providers[id];
  if (!scope || !record) return;
  saveSnapshot(scope, { ...st.providers.providers, [id]: { ...record, ...patch, updatedAt: Date.now() } }, st.providers.order);
}

// ---- Providers --------------------------------------------------------------------

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 60) || fallback;
}

function cleanAgent(ua: string | null): string | null {
  const v = ua?.trim() ?? '';
  return v && v.length <= 256 && !/[\u0000-\u001f]/.test(v) ? v : null;
}

/** The record and secrets for form input; throws an IptvError for a bad address. */
function fromInput(input: ProviderInput, base: Pick<ProviderRecord, 'id' | 'createdAt'>, keep: ProviderSecrets): { record: ProviderRecord; secrets: ProviderSecrets } {
  const now = Date.now();
  if (input.kind === 'xtream') {
    const n = normalizeXtreamInput(input.server);
    if (!n) throw new IptvError('badAddress');
    const username = input.username.trim() || n.username || '';
    // An empty password in the edit form keeps the saved one.
    const password = input.password || n.password || keep.password || '';
    if (!username || !password) throw new IptvError('denied');
    return {
      record: { ...base, kind: 'xtream', name: cleanName(input.name, 'Xtream'), server: n.server, userAgent: cleanAgent(input.userAgent), hasGuide: true, updatedAt: now, refreshedAt: null, channelCount: 0 },
      secrets: { username, password },
    };
  }
  const playlistUrl = input.playlistUrl.trim();
  if (!isHttpUrl(playlistUrl)) throw new IptvError('badAddress');
  const guideUrl = input.guideUrl?.trim() || undefined;
  if (guideUrl && !isHttpUrl(guideUrl)) throw new IptvError('badAddress');
  return {
    record: { ...base, kind: 'm3u', name: cleanName(input.name, 'Playlist'), server: null, userAgent: cleanAgent(input.userAgent), hasGuide: !!guideUrl, updatedAt: now, refreshedAt: null, channelCount: 0 },
    secrets: { playlistUrl, guideUrl },
  };
}

/**
 * Adds a provider, or saves changes to one (`id`). The channel list loads
 * first: a provider that does not answer is not saved, and the error says
 * why. Returns the provider id.
 */
export async function saveProvider(input: ProviderInput, id?: string): Promise<string> {
  const scope = requireScope();
  const old = id ? providerById(id) : null;
  // A shared provider is read only: only its admin changes it.
  if (old?.sharedBy) throw new IptvError('denied');
  const pid = old?.id ?? randomId();
  const { record, secrets } = fromInput(input, { id: pid, createdAt: old?.createdAt ?? Date.now() }, id ? readSecrets(pid) : {});
  const r = await fetchChannels(record, secrets);
  const full: ProviderSecrets = { ...secrets, playlistGuideUrl: r.playlistGuideUrl };
  writeSecrets(pid, full);
  const st = iptvState();
  // Two providers never share a name: the chips and the labels in "All providers" tell them apart.
  record.name = uniqueProviderName(record.name, st.providers.order.filter((x) => x !== pid).map((x) => st.providers.providers[x]?.name ?? ''));
  const saved: ProviderRecord = {
    ...record,
    refreshedAt: Date.now(),
    channelCount: r.channels.length,
    hasGuide: record.kind === 'xtream' || !!(full.guideUrl || full.playlistGuideUrl),
  };
  const order = st.providers.order.includes(pid) ? st.providers.order : [...st.providers.order, pid];
  saveSnapshot(scope, { ...st.providers.providers, [pid]: saved }, order);
  if (!iptvState().lists[pid]) setIptvState({ lists: { ...iptvState().lists, [pid]: loadLists(pid) } });
  showChannels(pid, r.channels);
  if (saved.kind === 'm3u') updateRecord(pid, { channelCount: liveCount(pid, saved.channelCount) });
  // A changed guide or login: the old guide goes.
  setIptvState({ guides: { ...iptvState().guides, [pid]: EMPTY_GUIDE }, guideStatus: { ...iptvState().guideStatus, [pid]: 'idle' } });
  await writeChannels(pid, r.channels);
  setActiveProvider(pid);
  void loadGuide(pid, true);
  return pid;
}

/** Everything but one key. */
function without<T>(rec: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _gone, ...rest } = rec;
  return rest;
}

/**
 * Removes a provider with everything of it: the record, its secrets, the
 * channel, guide and film files, favourites, recents and recent searches,
 * films and series data, and the audio and subtitle choices of its titles.
 * Live TV moves to the first provider left (or stays on "All providers"
 * while two are left).
 */
export async function removeProvider(id: string): Promise<void> {
  const scope = requireScope();
  const st = iptvState();
  const order = st.providers.order.filter((x) => x !== id);
  saveSnapshot(scope, without(st.providers.providers, id), order);
  removeSecrets(id);
  removeLists(id);
  removeVodData(id);
  forgetProviderTracks(id);
  setIptvState({
    data: without(st.data, id),
    guides: without(st.guides, id),
    guideNames: without(st.guideNames, id),
    guideStatus: without(st.guideStatus, id),
    lists: without(st.lists, id),
    searches: without(st.searches, id),
  });
  if (st.activeId === id || (st.activeId === ALL_PROVIDERS && order.length < 2)) setActiveProvider(order[0] ?? null);
  await iptvFiles.remove(dirOf(id));
}

/** What account sync changes on this device (see `account-sync.ts` `planApply`). */
export interface SyncedChanges {
  providers: ProvidersSnapshot;
  secrets: Record<string, ProviderSecrets>;
  reload: string[];
  removed: string[];
  lists: Record<string, ChannelLists>;
  vod: Record<string, VodLists>;
}

/**
 * Makes this device match the Live TV setup of the account: removes the
 * providers the account no longer has (with everything of them), writes new
 * logins to the secure store, saves the providers, favourites, recents and
 * positions. A provider whose login changed loads its channels again.
 */
export async function applySynced(changes: SyncedChanges): Promise<void> {
  const scope = requireScope();
  for (const id of changes.removed) await removeProvider(id);
  for (const [id, secrets] of Object.entries(changes.secrets)) writeSecrets(id, secrets);
  for (const id of changes.reload) {
    const st = iptvState();
    setIptvState({ data: without(st.data, id), guides: without(st.guides, id), guideNames: without(st.guideNames, id), guideStatus: without(st.guideStatus, id) });
    await iptvFiles.remove(dirOf(id));
  }
  saveSnapshot(scope, changes.providers.providers, changes.providers.order, changes.providers.startWith ?? null);
  if (Object.keys(changes.lists).length) {
    setIptvState({ lists: { ...iptvState().lists, ...changes.lists } });
    for (const [id, lists] of Object.entries(changes.lists)) saveLists(id, lists);
  }
  if (Object.keys(changes.vod).length) {
    setVodState({ vodLists: { ...vodState().vodLists, ...changes.vod } });
    for (const [id, lists] of Object.entries(changes.vod)) saveVodLists(id, lists);
  }
  const st = iptvState();
  const order = st.providers.order;
  if (!(st.activeId === ALL_PROVIDERS ? order.length > 1 : st.activeId && st.providers.providers[st.activeId])) {
    setActiveProvider(resolveActive(st.providers.startWith, null, order));
  }
  // A changed login: a list on screen loads again from the provider.
  for (const id of changes.reload) if (iptvState().lists[id]) void ensureLoaded(id);
}

/**
 * Providers an admin shares with this user (`shared.ts` `planShared`): adds
 * or updates them next to the user's own, and removes the ones no longer
 * shared, with their files. Logins go to the secure store only.
 */
export async function applyShared(upsert: { record: ProviderRecord; secrets: ProviderSecrets; reload: boolean }[], remove: readonly string[]): Promise<void> {
  const scope = requireScope();
  for (const id of remove) await removeProvider(id);
  if (!upsert.length) return;
  for (const u of upsert) {
    writeSecrets(u.record.id, u.secrets);
    if (u.reload) {
      const st = iptvState();
      setIptvState({ data: without(st.data, u.record.id), guides: without(st.guides, u.record.id), guideNames: without(st.guideNames, u.record.id), guideStatus: without(st.guideStatus, u.record.id) });
      await iptvFiles.remove(dirOf(u.record.id));
    }
  }
  const st = iptvState();
  const providers = { ...st.providers.providers };
  const order = st.providers.order.slice();
  for (const u of upsert) {
    providers[u.record.id] = u.record;
    if (!order.includes(u.record.id)) order.push(u.record.id);
  }
  saveSnapshot(scope, providers, order);
  for (const u of upsert) if (u.reload && iptvState().lists[u.record.id]) void ensureLoaded(u.record.id);
}

/** What the edit form shows: the saved values, without the password. */
export function formValues(id: string): ProviderInput | null {
  const record = providerById(id);
  if (!record) return null;
  // A shared provider shows no login at all (its list address can hold a token too).
  const s = record.sharedBy ? {} : readSecrets(id);
  if (record.kind === 'xtream') return { kind: 'xtream', name: record.name, server: record.server ?? '', username: s.username ?? '', password: '', userAgent: record.userAgent };
  return { kind: 'm3u', name: record.name, playlistUrl: s.playlistUrl ?? '', guideUrl: s.guideUrl ?? null, userAgent: record.userAgent };
}

// ---- Favourites and recents ------------------------------------------------------------

function setLists(id: string, update: (l: typeof EMPTY_LISTS) => typeof EMPTY_LISTS): void {
  const current = iptvState().lists[id] ?? loadLists(id);
  const next = update(current);
  setIptvState({ lists: { ...iptvState().lists, [id]: next } });
  saveLists(id, next);
}

/** Adds or removes a favourite. Returns true when the channel is a favourite now. */
export function toggleFavourite(providerId: string, channel: Channel): boolean {
  setLists(providerId, (l) => toggleIn(l, channel.id, snapOf(channel)));
  return (iptvState().lists[providerId]?.favourites ?? []).includes(channel.id);
}

export function markWatched(providerId: string, channelId: string): void {
  const channel = iptvState().data[providerId]?.channels.find((c) => c.id === channelId);
  setLists(providerId, (l) => addRecent(l, channelId, Date.now(), channel ? snapOf(channel) : l.snaps[channelId]));
}

/** Loads the channel list of every provider (a search in "All providers"). One at a time, saved lists first. */
export async function ensureAllLoaded(): Promise<void> {
  for (const id of iptvState().providers.order) {
    if (!providerById(id)) continue;
    await ensureLoaded(id).catch(() => undefined);
  }
}

// ---- Recent searches --------------------------------------------------------------------

export function recentSearchesOf(providerId: string): RecentSearches {
  return iptvState().searches[providerId] ?? loadSearches(providerId);
}

/** Keeps a search the person used (they played a result). */
export function rememberSearchFor(providerId: string, query: string): void {
  const current = recentSearchesOf(providerId);
  const next = rememberSearch(current, query);
  if (next === current && iptvState().searches[providerId]) return;
  setIptvState({ searches: { ...iptvState().searches, [providerId]: next } });
  saveSearches(providerId, next);
}

export function clearSearches(providerId: string): void {
  setIptvState({ searches: { ...iptvState().searches, [providerId]: EMPTY_RECENT_SEARCHES } });
  saveSearches(providerId, EMPTY_RECENT_SEARCHES);
}

// ---- Guide ----------------------------------------------------------------------------

function setGuide(id: string, guide: GuideWindow): void {
  setIptvState({ guides: { ...iptvState().guides, [id]: guide } });
}

function setGuideStatus(id: string, status: 'idle' | 'loading' | 'ready' | 'error'): void {
  setIptvState({ guideStatus: { ...iptvState().guideStatus, [id]: status } });
}

/**
 * M3U: reads the XMLTV guide into a window of a few hours (saved, so a
 * restart shows now and next at once). Xtream: nothing up front; now and
 * next load per channel (`requestNowNext`).
 */
export async function loadGuide(id: string, force: boolean): Promise<void> {
  const record = providerById(id);
  if (!record || record.kind !== 'm3u' || iptvState().guideStatus[id] === 'loading') return;
  const secrets = readSecrets(id);
  const url = secrets.guideUrl ?? secrets.playlistGuideUrl;
  if (!url) return;
  const now = Date.now();
  if (!force && !iptvState().guides[id]) {
    const [raw, rawNames] = await Promise.all([iptvFiles.read(guidePath(id)), iptvFiles.read(namesPath(id))]);
    try {
      const saved = raw ? migrateGuide(JSON.parse(raw)) : null;
      if (saved && saved.to > now + HOUR) {
        setGuide(id, saved);
        if (rawNames) setIptvState({ guideNames: { ...iptvState().guideNames, [id]: JSON.parse(rawNames) as Record<string, string> } });
        setGuideStatus(id, 'ready');
        return;
      }
    } catch {
      // Load it again.
    }
  }
  const current = iptvState().guides[id];
  if (!force && current && current.to > now + HOUR) return;
  setGuideStatus(id, 'loading');
  try {
    const channels = iptvState().data[id]?.channels ?? [];
    const keep = new Set<string>();
    const matchNames = new Set<string>();
    for (const c of channels) {
      if (c.epgId) keep.add(c.epgId);
      else matchNames.add(c.name.trim().toLowerCase());
    }
    const r = await parseXmltv(transport.text(url, { userAgent: record.userAgent, maxBytes: MAX_LIST_BYTES }), {
      from: now - 30 * 60_000,
      to: now + GUIDE_WINDOW_MS,
      keep: channels.length ? keep : null,
      matchNames,
      maxPerChannel: 4,
    });
    if (!r.looksLikeXmltv) throw new IptvError('notXmltv');
    const names: Record<string, string> = {};
    for (const n of matchNames) {
      const gid = r.names.get(n);
      if (gid) names[n] = gid;
    }
    setGuide(id, r.guide);
    setIptvState({ guideNames: { ...iptvState().guideNames, [id]: names } });
    setGuideStatus(id, 'ready');
    await Promise.all([iptvFiles.write(guidePath(id), JSON.stringify(r.guide)), iptvFiles.write(namesPath(id), JSON.stringify(names))]).catch(() => undefined);
  } catch (e) {
    setGuideStatus(id, 'error');
    console.warn('[iptv] guide failed:', iptvErrorText(e));
  }
}

/** Xtream short-guide requests: at most two at a time, each channel once until its programmes run out. */
const epgQueue: { providerId: string; channel: Channel }[] = [];
const epgPending = new Set<string>();
let epgRunning = 0;
const EPG_PARALLEL = 2;

function pumpEpg(): void {
  while (epgRunning < EPG_PARALLEL && epgQueue.length) {
    const job = epgQueue.shift();
    if (!job) break;
    epgRunning++;
    void fetchShortEpg(job.providerId, job.channel).finally(() => {
      epgRunning--;
      epgPending.delete(`${job.providerId}:${job.channel.id}`);
      pumpEpg();
    });
  }
}

async function fetchShortEpg(providerId: string, channel: Channel): Promise<void> {
  const record = providerById(providerId);
  const login = record ? xtreamLogin(record, readSecrets(providerId)) : null;
  if (!record || !login || channel.streamId === undefined) return;
  try {
    const json = await transport.json(xtreamApiUrl(login, 'get_short_epg', { stream_id: channel.streamId, limit: 4 }), { userAgent: record.userAgent, maxBytes: MAX_JSON_BYTES });
    const progs = parseXtreamShortEpg(json);
    setGuide(providerId, withProgrammes(iptvState().guides[providerId] ?? EMPTY_GUIDE, channel.id, progs));
  } catch {
    // No guide for this channel now: it is asked again when it shows next time.
    setGuide(providerId, withProgrammes(iptvState().guides[providerId] ?? { ...EMPTY_GUIDE, schemaVersion: GUIDE_SCHEMA_VERSION }, channel.id, []));
  }
}

/** Xtream: asks for now and next of channels that show (rows on screen, the channel that plays). */
export function requestNowNext(providerId: string, channels: readonly Channel[]): void {
  const record = providerById(providerId);
  if (!record || record.kind !== 'xtream') return;
  const guide = iptvState().guides[providerId] ?? EMPTY_GUIDE;
  const now = Date.now();
  for (const c of channels) {
    const key = `${providerId}:${c.id}`;
    if (epgPending.has(key) || !isStale(guide, c.id, now)) continue;
    epgPending.add(key);
    epgQueue.push({ providerId, channel: c });
  }
  pumpEpg();
}

/** Now and next of a channel from the loaded guide. */
/** The guide's display names as a Map, built once per guide (every row asks). */
const namesMaps = new WeakMap<Record<string, string>, Map<string, string>>();
function namesMap(names: Record<string, string> | undefined): Map<string, string> | null {
  if (!names) return null;
  let m = namesMaps.get(names);
  if (!m) {
    m = new Map(Object.entries(names));
    namesMaps.set(names, m);
  }
  return m;
}

export function nowNextOf(providerId: string, channel: Channel, at: number): NowNext {
  const st = iptvState();
  const guide = st.guides[providerId];
  if (!guide) return { now: null, next: null };
  const record = st.providers.providers[providerId];
  const key = record?.kind === 'xtream' ? channel.id : guideIdFor(channel, namesMap(st.guideNames[providerId]));
  return key ? nowNext(guide.channels[key], at) : { now: null, next: null };
}

// ---- Playing ----------------------------------------------------------------------------

function refOf(c: Channel): LiveChannelRef {
  return { id: c.id, name: c.name, logo: c.logo ?? null, number: c.number ?? null, group: c.group };
}

function sourceFor(providerId: string): LiveSource {
  const find = (channelId: string) => iptvState().data[providerId]?.channels.find((c) => c.id === channelId) ?? null;
  return {
    providerId,
    async resolve(channelId) {
      const record = providerById(providerId);
      // A favourite of "All providers" can play before its provider's list is in memory.
      if (record && !find(channelId)) await ensureLoaded(providerId).catch(() => undefined);
      const channel = find(channelId);
      if (!record || !channel) return { candidates: [], userAgent: null, unsupported: 'This channel is not in the list any more.' };
      return liveStreamFor(channel, record, xtreamLogin(record, readSecrets(providerId)), streamPlatform, tsBridge !== null);
    },
    nowLine(channelId) {
      const channel = find(channelId);
      if (!channel) return null;
      requestNowNext(providerId, [channel]);
      return nowNextOf(providerId, channel, Date.now()).now?.title ?? null;
    },
    nowNext(channelId) {
      const channel = find(channelId);
      if (!channel) return { now: null, next: null };
      requestNowNext(providerId, [channel]);
      const nn = nowNextOf(providerId, channel, Date.now());
      const brief = (p: typeof nn.now) => (p ? { title: p.title, start: p.start, stop: p.stop } : null);
      return { now: brief(nn.now), next: brief(nn.next) };
    },
    onStart(channelId) {
      markWatched(providerId, channelId);
    },
    explainFailure: () => explainFailure(providerId),
  };
}

/** Xtream: asks the panel whether every stream of the account is in use (`connectionLimitText`). */
async function explainFailure(providerId: string): Promise<string | null> {
  const record = providerById(providerId);
  const login = record ? xtreamLogin(record, readSecrets(providerId)) : null;
  if (!record || !login) return null;
  try {
    return connectionLimitText(parseXtreamAuth(await transport.json(xtreamApiUrl(login), { userAgent: record.userAgent, maxBytes: MAX_JSON_BYTES })));
  } catch {
    return null;
  }
}

/** The play request for a channel in a list (channel up and down move through the list). */
export function playRequest(providerId: string, list: readonly Channel[], channel: Channel): LivePlayRequest {
  const index = Math.max(0, list.findIndex((c) => c.id === channel.id));
  return { channels: (list.length ? list : [channel]).map(refOf), index, source: sourceFor(providerId) };
}

/**
 * The source of a list that mixes providers ("All providers"). Its channel
 * ids are merged keys (`merged.ts`); each call goes to the channel's own
 * provider, so channel up and down move through the merged list.
 */
function mergedSource(): LiveSource {
  const split = (key: string) => splitProviderChannelKey(key);
  const none = { candidates: [], userAgent: null, unsupported: 'This channel is not in the list any more.' };
  return {
    providerId: ALL_PROVIDERS,
    async resolve(key) {
      const k = split(key);
      return k ? sourceFor(k.providerId).resolve(k.channelId) : none;
    },
    nowLine(key) {
      const k = split(key);
      return k ? (sourceFor(k.providerId).nowLine?.(k.channelId) ?? null) : null;
    },
    nowNext(key) {
      const k = split(key);
      return k ? (sourceFor(k.providerId).nowNext?.(k.channelId) ?? { now: null, next: null }) : { now: null, next: null };
    },
    onStart(key) {
      const k = split(key);
      if (k) markWatched(k.providerId, k.channelId);
    },
    async explainFailure(key) {
      const k = split(key);
      return k ? explainFailure(k.providerId) : null;
    },
    titleOf(key) {
      const k = split(key);
      return k ?? { providerId: ALL_PROVIDERS, channelId: key };
    },
  };
}

/** The play request for a channel in a merged list: channel up and down stay in that list. */
export function playMergedRequest(list: readonly ProviderChannel[], item: ProviderChannel): LivePlayRequest {
  const index = Math.max(0, list.findIndex((x) => x.key === item.key));
  const items = list.length ? list : [item];
  const st = iptvState();
  return {
    channels: items.map((x) => ({ ...refOf(x.channel), id: x.key, provider: st.providers.providers[x.providerId]?.name })),
    index,
    source: mergedSource(),
  };
}
