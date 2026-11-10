/**
 * Live TV in the Jellyfin account: the rules that turn this device's IPTV
 * setup into one versioned blob, merge it with the blob of the account, and
 * say what this device must change. Pure, so it is unit-tested; `sync.ts`
 * does the I/O (the server, MMKV, the secure store). Sync is always on.
 *
 * - Providers merge one by one by id: the newer stamp wins, and a removed
 *   provider leaves a removal marker (tombstone) with its own stamp. So a
 *   provider removed on one device goes everywhere, and two devices that
 *   add different providers keep both.
 * - Favourites, recently watched channels and film and episode positions
 *   merge per entry the same way.
 * - The order and the Live TV start choice are last writer wins, by their
 *   own stamp.
 * - Removal markers older than 30 days go (every device has seen them).
 * - The first sync of a device never overwrites either side: what the device
 *   has gets the lowest stamps, so it only adds to the account, and a
 *   removal in the account still wins.
 * - Two providers with the same login or playlist become one (the older).
 * - Channel lists, guides and caches never go into the blob, and channel
 *   snaps never hold a stream URL.
 * - Data from the server is checked field by field: bad data is dropped,
 *   never thrown.
 *
 * The device keeps a ledger (`SyncMeta`) of the stamps it last knew. A
 * change on the device shows as a difference between what it has and the
 * ledger (`observe`), so the rest of the IPTV code needs no sync hooks.
 */
import {
  canonical,
  chunkCodec,
  type CustomPrefs,
  hashText,
  isNum,
  isObject,
  mergeStamped,
  readStampedMap,
  SYNC_CHUNK_CHARS,
  sortedAlive,
  type StampedMap,
  type StampMap,
  stampsOf,
} from '@/lib/account-blob';

import { MAX_FAVOURITES, MAX_RECENTS } from './lists';
import { ALL_PROVIDERS, uniqueProviderName } from './merged';
import { migrateLists, migrateProviders } from './migrate';
import type { ChannelLists, ChannelSnap, ProviderKind, ProviderRecord, ProviderSecrets, ProvidersSnapshot } from './types';
import { LISTS_SCHEMA_VERSION, PROVIDERS_SCHEMA_VERSION } from './types';
import { migrateVodLists } from './vod-migrate';
import type { VodLists, VodPosition } from './vod-types';
import { VOD_LISTS_SCHEMA_VERSION } from './vod-types';

// The generic parts live in `lib/account-blob.ts`; the names stay exported here for the IPTV code.
export { canonical, hashText, mergeStamped, SYNC_CHUNK_CHARS, TOMBSTONE_TTL_MS, type Stamp, type Stamped, type StampedMap, type StampMap } from '@/lib/account-blob';

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_META_SCHEMA_VERSION = 1;
/** The most providers the blob keeps (with removal markers). */
export const MAX_SYNC_PROVIDERS = 200;
/** The film and episode positions per provider that go into the blob (the newest). */
export const MAX_SYNC_POSITIONS = 100;
/** The largest blob the app writes. Positions, then recents, are left out to stay under it. */
export const MAX_SYNC_CHARS = 1_600_000;
/** The CustomPrefs keys: `iptv.parts` and `iptv.<n>`. */
const chunks = chunkCodec('iptv', SYNC_CHUNK_CHARS);
export const PARTS_KEY = chunks.partsKey;
export const chunkKey = chunks.chunkKey;

/** The secrets that sync. `playlistGuideUrl` is not one: the playlist names it again on each load. */
export type SyncedSecrets = Pick<ProviderSecrets, 'username' | 'password' | 'playlistUrl' | 'guideUrl'>;

/** A provider in the blob: the record fields that are the same on every device, and its login. */
export interface SyncedProvider {
  kind: ProviderKind;
  name: string;
  server: string | null;
  userAgent: string | null;
  createdAt: number;
  secrets: SyncedSecrets;
}

/** The order of the providers and what Live TV opens on. */
export interface SyncSettings {
  at: number;
  order: string[];
  startWith: string | null;
}

/** The blob in the account (Jellyfin DisplayPreferences, CustomPrefs). */
export interface SyncBlob {
  schemaVersion: number;
  providers: StampedMap<SyncedProvider>;
  settings: SyncSettings;
  /** Per provider id. */
  favourites: Record<string, StampedMap<ChannelSnap>>;
  recents: Record<string, StampedMap<ChannelSnap>>;
  positions: Record<string, StampedMap<VodPosition>>;
}

/** The device's ledger, saved per account (MMKV). No secrets: providers are kept as hashes. */
export interface SyncMeta {
  schemaVersion: number;
  /** False until the first look at the device: what it had then gets the lowest stamps. */
  seeded: boolean;
  /** A change waits to go to the server (it did not answer). */
  dirty: boolean;
  providers: StampMap;
  providerHashes: Record<string, string>;
  settingsAt: number;
  settingsHash: string;
  favourites: Record<string, StampMap>;
  recents: Record<string, StampMap>;
  positions: Record<string, StampMap>;
}

export const EMPTY_META: SyncMeta = {
  schemaVersion: SYNC_META_SCHEMA_VERSION,
  seeded: false,
  dirty: false,
  providers: {},
  providerHashes: {},
  settingsAt: 0,
  settingsHash: '',
  favourites: {},
  recents: {},
  positions: {},
};

/** What the device has now. */
export interface LocalState {
  providers: ProvidersSnapshot;
  secrets: Record<string, ProviderSecrets>;
  lists: Record<string, ChannelLists>;
  vod: Record<string, VodLists>;
}

// ---- Helpers --------------------------------------------------------------------------------

function syncedSecrets(s: ProviderSecrets | undefined): SyncedSecrets {
  const out: SyncedSecrets = {};
  for (const k of ['username', 'password', 'playlistUrl', 'guideUrl'] as const) {
    const v = s?.[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/** A login or playlist that is the same provider, whatever its id. */
function identityOf(p: SyncedProvider): string {
  return p.kind === 'xtream' ? `x|${(p.server ?? '').toLowerCase()}|${p.secrets.username ?? ''}` : `m|${(p.secrets.playlistUrl ?? '').trim()}`;
}

// ---- The device -------------------------------------------------------------------------------

function syncedOf(local: LocalState, id: string): SyncedProvider | null {
  const p: ProviderRecord | undefined = local.providers.providers[id];
  if (!p) return null;
  return { kind: p.kind, name: p.name, server: p.server, userAgent: p.userAgent, createdAt: p.createdAt, secrets: syncedSecrets(local.secrets[id]) };
}

/** The device's own providers (a provider shared by an admin is not part of the user's setup). */
const providerIds = (local: LocalState) => local.providers.order.filter((id) => !!local.providers.providers[id] && !local.providers.providers[id].sharedBy);
/** Every provider whose lists sync: own and shared (favourites of a shared provider are the user's own). */
const listIds = (local: LocalState) => local.providers.order.filter((id) => !!local.providers.providers[id]);
/** The shared providers on the device. */
export const sharedIds = (local: LocalState) => local.providers.order.filter((id) => !!local.providers.providers[id]?.sharedBy);
const settingsHashOf = (order: readonly string[], startWith: string | null | undefined) => hashText(canonical({ order, startWith: startWith ?? null }));

/**
 * Stamps of the entries a device has now. An entry with no own time (a
 * favourite) gets `stampNew`, a bit less for each one after it, so the order
 * stays. An entry that is gone gets a removal marker.
 */
function observeMap(ledger: StampMap | undefined, current: Map<string, number | null>, stampNew: number, now: number): StampMap | null {
  const prev = ledger ?? {};
  let changed = false;
  const next: StampMap = {};
  let i = 0;
  for (const [id, at] of current) {
    const old = prev[id];
    const stamp = at ?? (old && !old.del ? old.at : stampNew - i);
    i++;
    if (old && !old.del && old.at >= stamp) next[id] = old;
    else {
      next[id] = { at: stamp };
      changed = true;
    }
  }
  for (const [id, old] of Object.entries(prev)) {
    if (current.has(id)) continue;
    if (old.del) next[id] = old;
    else {
      next[id] = { at: Math.max(now, old.at + 1), del: true };
      changed = true;
    }
  }
  return changed ? next : null;
}

function observeAll(ledger: Record<string, StampMap>, ids: readonly string[], currentOf: (id: string) => Map<string, number | null>, stampNew: number, now: number): Record<string, StampMap> {
  let next: Record<string, StampMap> | null = null;
  for (const id of ids) {
    const m = observeMap(ledger[id], currentOf(id), stampNew, now);
    if (m) next = { ...(next ?? ledger), [id]: m };
  }
  // A provider that is gone takes its list stamps with it (its removal marker stays in `providers`).
  for (const id of Object.keys(ledger)) {
    if (ids.includes(id)) continue;
    next = { ...(next ?? ledger) };
    delete next[id];
  }
  return next ?? ledger;
}

const favouritesNow = (l: ChannelLists | undefined) => new Map<string, number | null>((l?.favourites ?? []).map((id) => [id, null]));
const recentsNow = (l: ChannelLists | undefined) => new Map<string, number | null>((l?.recents ?? []).map((r) => [r.id, r.at]));
const positionsNow = (v: VodLists | undefined) => new Map<string, number | null>(Object.entries(v?.positions ?? {}).map(([k, p]) => [k, p.at]));

/** The lowest stamps: what a device had before its first sync only adds to the account. */
const SEED_STAMP = 1_000_000;

/**
 * Brings the ledger up to date with what the device has now. Returns the
 * same object when nothing changed, so a caller knows there is nothing to send.
 */
export function observe(meta: SyncMeta, local: LocalState, now: number): SyncMeta {
  const seeding = !meta.seeded;
  const stampNew = seeding ? SEED_STAMP : now;
  const ids = providerIds(local);
  // Providers: a new or changed one gets a new stamp, a removed one a removal marker.
  let providers = meta.providers;
  let providerHashes = meta.providerHashes;
  for (const id of ids) {
    const h = hashText(canonical(syncedOf(local, id)));
    if (providerHashes[id] === h && providers[id] && !providers[id].del) continue;
    providers = { ...providers, [id]: { at: seeding ? 1 : Math.max(now, (providers[id]?.at ?? 0) + 1) } };
    providerHashes = { ...providerHashes, [id]: h };
  }
  for (const [id, s] of Object.entries(meta.providers)) {
    if (s.del || ids.includes(id)) continue;
    providers = { ...providers, [id]: { at: Math.max(now, s.at + 1), del: true } };
    const { [id]: _gone, ...rest } = providerHashes;
    providerHashes = rest;
  }
  const settingsHash = settingsHashOf(ids, local.providers.startWith);
  const lids = listIds(local);
  const settingsChanged = settingsHash !== meta.settingsHash;
  // Seeding: the account's order wins; this device's providers go after it.
  const settingsAt = settingsChanged ? (seeding ? 0 : Math.max(now, meta.settingsAt + 1)) : meta.settingsAt;
  const favourites = observeAll(meta.favourites, lids, (id) => favouritesNow(local.lists[id]), stampNew, now);
  const recents = observeAll(meta.recents, lids, (id) => recentsNow(local.lists[id]), stampNew, now);
  const positions = observeAll(meta.positions, lids, (id) => positionsNow(local.vod[id]), stampNew, now);
  if (!seeding && !settingsChanged && providers === meta.providers && favourites === meta.favourites && recents === meta.recents && positions === meta.positions) return meta;
  return { ...meta, seeded: true, providers, providerHashes, settingsAt, settingsHash, favourites, recents, positions };
}

function withValues<T>(stamps: StampMap | undefined, valueOf: (id: string) => T | undefined | null): StampedMap<T> {
  const out: StampedMap<T> = {};
  for (const [id, s] of Object.entries(stamps ?? {})) {
    if (s.del) out[id] = { at: s.at, del: true };
    else {
      const val = valueOf(id);
      out[id] = val == null ? { at: s.at } : { at: s.at, val };
    }
  }
  return out;
}

/** The device's blob: the ledger's stamps with the values the device has. Call `observe` first. */
export function localBlob(meta: SyncMeta, local: LocalState): SyncBlob {
  const ids = providerIds(local);
  const favourites: SyncBlob['favourites'] = {};
  const recents: SyncBlob['recents'] = {};
  const positions: SyncBlob['positions'] = {};
  for (const id of listIds(local)) {
    const lists = local.lists[id];
    favourites[id] = withValues(meta.favourites[id], (cid) => lists?.snaps[cid]);
    recents[id] = withValues(meta.recents[id], (cid) => lists?.snaps[cid]);
    positions[id] = withValues(meta.positions[id], (key) => local.vod[id]?.positions[key]);
  }
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    providers: withValues(meta.providers, (id) => syncedOf(local, id)),
    settings: { at: meta.settingsAt, order: ids, startWith: local.providers.startWith ?? null },
    favourites,
    recents,
    positions,
  };
}

// ---- Merging ----------------------------------------------------------------------------

const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** The ids of providers that are not removed and have a value. */
const aliveProviders = (m: StampedMap<SyncedProvider>) =>
  Object.entries(m)
    .filter(([, e]) => !e.del && e.val)
    .map(([id]) => id);

/** The order: the settings' order of the providers that exist, then the others (oldest first). */
function orderOf(providers: StampedMap<SyncedProvider>, order: readonly string[]): string[] {
  const alive = new Set(aliveProviders(providers));
  const out = [...new Set(order.filter((id) => alive.has(id)))];
  const rest = [...alive].filter((id) => !out.includes(id));
  rest.sort((x, y) => (providers[x].val?.createdAt ?? 0) - (providers[y].val?.createdAt ?? 0) || (x < y ? -1 : 1));
  return [...out, ...rest];
}

/**
 * Merges the device's blob with the account's. Two providers with the same
 * login become the older one (its id stays; the other gets a removal marker
 * and its lists move over). Two names that clash get a number. `keep`: the
 * shared providers on the device, whose lists sync too. The lists of a
 * provider this device does not know (shared with another device first)
 * pass through.
 */
export function mergeBlobs(local: SyncBlob, remote: SyncBlob | null, now: number, keep: readonly string[] = []): SyncBlob {
  const r = remote ?? { schemaVersion: SYNC_SCHEMA_VERSION, providers: {}, settings: { at: -1, order: [], startWith: null }, favourites: {}, recents: {}, positions: {} };
  let providers = mergeStamped(r.providers, local.providers, now, NO_LIMIT);
  // The order: the newer wins; a tie keeps the account's.
  const settings = local.settings.at > r.settings.at ? local.settings : r.settings;
  const favourites: SyncBlob['favourites'] = {};
  const recents: SyncBlob['recents'] = {};
  const positions: SyncBlob['positions'] = {};
  const listsOf = (id: string) => ({
    f: mergeStamped(r.favourites[id], local.favourites[id], now, NO_LIMIT),
    r: mergeStamped(r.recents[id], local.recents[id], now, NO_LIMIT),
    p: mergeStamped(r.positions[id], local.positions[id], now, NO_LIMIT),
  });
  // The same login twice: the older provider stays.
  const byIdentity = new Map<string, string>();
  const ids = aliveProviders(providers).sort((x, y) => (providers[x].val?.createdAt ?? 0) - (providers[y].val?.createdAt ?? 0) || (x < y ? -1 : 1));
  const into: Record<string, string> = {};
  for (const id of ids) {
    const key = identityOf(providers[id].val as SyncedProvider);
    const keep = byIdentity.get(key);
    if (keep) {
      into[id] = keep;
      providers = { ...providers, [id]: { at: Math.max(now, providers[id].at + 1), del: true } };
    } else byIdentity.set(key, id);
  }
  const order = orderOf(providers, settings.order);
  const known = new Set(Object.keys(providers));
  const passing = [...new Set([...Object.keys(r.favourites), ...Object.keys(r.recents), ...Object.keys(r.positions)])].filter((id) => !known.has(id));
  for (const id of [...new Set([...order, ...keep, ...passing])]) {
    let l = listsOf(id);
    for (const [from, to] of Object.entries(into)) {
      if (to !== id) continue;
      const m = listsOf(from);
      l = { f: mergeStamped(l.f, m.f, now, NO_LIMIT), r: mergeStamped(l.r, m.r, now, NO_LIMIT), p: mergeStamped(l.p, m.p, now, NO_LIMIT) };
    }
    favourites[id] = mergeStamped(l.f, undefined, now, MAX_FAVOURITES);
    recents[id] = mergeStamped(l.r, undefined, now, MAX_RECENTS);
    positions[id] = mergeStamped(l.p, undefined, now, MAX_SYNC_POSITIONS);
  }
  // Two providers never share a name: a later one gets a number (a new stamp, so every device takes it).
  const names: string[] = [];
  for (const id of order) {
    const e = providers[id];
    const p = e.val as SyncedProvider;
    const name = uniqueProviderName(p.name, names);
    names.push(name);
    if (name !== p.name) providers = { ...providers, [id]: { at: e.at + 1, val: { ...p, name } } };
  }
  // Removal markers beyond the limit: the oldest go first.
  const keys = Object.keys(providers);
  if (keys.length > MAX_SYNC_PROVIDERS) {
    const dead = keys.filter((k) => providers[k].del).sort((x, y) => providers[x].at - providers[y].at);
    for (const k of dead.slice(0, keys.length - MAX_SYNC_PROVIDERS)) {
      const { [k]: _gone, ...rest } = providers;
      providers = rest;
    }
  }
  const count = order.length + keep.length;
  const startWith =
    settings.startWith === ALL_PROVIDERS ? (count > 1 ? ALL_PROVIDERS : null) : settings.startWith && (order.includes(settings.startWith) || keep.includes(settings.startWith)) ? settings.startWith : null;
  return { schemaVersion: SYNC_SCHEMA_VERSION, providers, settings: { at: settings.at, order, startWith }, favourites, recents, positions };
}

/** True when two blobs hold the same data. */
export function sameBlob(a: SyncBlob | null, b: SyncBlob | null): boolean {
  if (!a || !b) return a === b;
  return canonical(a) === canonical(b);
}

/** True when the blob holds nothing (a user with no Live TV gets no blob; favourites of a shared provider count). */
export function isEmptyBlob(b: SyncBlob): boolean {
  const none = (r: Record<string, StampedMap<unknown>>) => Object.values(r).every((m) => !Object.keys(m).length);
  return !Object.keys(b.providers).length && none(b.favourites) && none(b.recents) && none(b.positions);
}

// ---- Applying a merged blob to the device -----------------------------------------------------------

export interface ApplyPlan {
  providers: ProvidersSnapshot;
  /** The secrets to write, per provider (only the ones that change). */
  secrets: Record<string, ProviderSecrets>;
  /** Providers that change login, address or user agent: their saved channels and guide are no longer right. */
  reload: string[];
  /** Providers to remove from the device, with everything of them. */
  removed: string[];
  /** The lists to write (only the ones that change). */
  lists: Record<string, ChannelLists>;
  vod: Record<string, VodLists>;
  /** The ledger that matches the merged blob. */
  meta: SyncMeta;
}

/** The lists of one provider as the merged blob says, with the device's snaps where the blob has none. */
function listsFrom(blob: SyncBlob, id: string, current: ChannelLists | undefined): ChannelLists {
  const favs = sortedAlive(blob.favourites[id]);
  const recs = sortedAlive(blob.recents[id]);
  const snaps: Record<string, ChannelSnap> = {};
  for (const [cid, e] of [...favs, ...recs]) {
    const s = e.val ?? current?.snaps[cid];
    if (s) snaps[cid] = s;
  }
  return {
    schemaVersion: LISTS_SCHEMA_VERSION,
    favourites: favs.map(([cid]) => cid),
    recents: recs.map(([cid, e]) => ({ id: cid, at: e.at })),
    snaps,
  };
}

function vodFrom(blob: SyncBlob, id: string, current: VodLists | undefined): VodLists {
  const positions: Record<string, VodPosition> = {};
  for (const [key, e] of sortedAlive(blob.positions[id])) {
    const p = e.val ?? current?.positions[key];
    if (p) positions[key] = { ...p, at: e.at };
  }
  return { schemaVersion: VOD_LISTS_SCHEMA_VERSION, favourites: current?.favourites ?? [], positions };
}

const sameLists = (a: ChannelLists | undefined, b: ChannelLists) => canonical({ ...(a ?? { favourites: [], recents: [], snaps: {} }), schemaVersion: 0 }) === canonical({ ...b, schemaVersion: 0 });

/** What the device must change to match the merged blob. */
export function planApply(local: LocalState, blob: SyncBlob, meta: SyncMeta): ApplyPlan {
  const have = local.providers;
  const order = blob.settings.order;
  const records: Record<string, ProviderRecord> = {};
  const secrets: Record<string, ProviderSecrets> = {};
  const reload: string[] = [];
  for (const id of order) {
    const p = blob.providers[id]?.val;
    if (!p) continue;
    const old = have.providers[id];
    const oldSecrets = local.secrets[id] ?? {};
    const was = syncedSecrets(oldSecrets);
    const loginChanged = canonical(was) !== canonical(p.secrets);
    if (loginChanged) {
      // The guide the playlist names stays while the playlist is the same.
      const keep = p.secrets.playlistUrl && p.secrets.playlistUrl === was.playlistUrl && oldSecrets.playlistGuideUrl ? { playlistGuideUrl: oldSecrets.playlistGuideUrl } : {};
      secrets[id] = { ...p.secrets, ...keep };
    }
    if (old && (loginChanged || old.server !== p.server || old.userAgent !== p.userAgent || old.kind !== p.kind)) reload.push(id);
    const stays = !!old && !reload.includes(id);
    const hasGuide = p.kind === 'xtream' || !!(p.secrets.guideUrl || (secrets[id] ?? oldSecrets).playlistGuideUrl) || (stays && old.hasGuide);
    records[id] = {
      id,
      kind: p.kind,
      name: p.name,
      server: p.server,
      userAgent: p.userAgent,
      hasGuide,
      createdAt: p.createdAt,
      updatedAt: old?.updatedAt ?? blob.providers[id].at,
      refreshedAt: stays ? old.refreshedAt : null,
      channelCount: stays ? old.channelCount : 0,
    };
  }
  // Shared providers stay where they are; the own providers take the blob's order in the other places.
  const fullOrder: string[] = [];
  const own = order.filter((id) => records[id]);
  let slot = 0;
  for (const id of have.order) {
    const p = have.providers[id];
    if (p?.sharedBy) {
      records[id] = p;
      fullOrder.push(id);
    } else if (p && slot < own.length) fullOrder.push(own[slot++]);
  }
  fullOrder.push(...own.slice(slot));
  const startWith = blob.settings.startWith === ALL_PROVIDERS || (blob.settings.startWith && records[blob.settings.startWith]) ? blob.settings.startWith : null;
  const providers: ProvidersSnapshot = { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers: records, order: fullOrder, startWith };
  const removed = have.order.filter((id) => !records[id]);
  const lists: Record<string, ChannelLists> = {};
  const vod: Record<string, VodLists> = {};
  const positionStamps: Record<string, StampMap> = {};
  for (const id of fullOrder) {
    const l = listsFrom(blob, id, local.lists[id]);
    if (!sameLists(local.lists[id], l)) lists[id] = l;
    const v = vodFrom(blob, id, local.vod[id]);
    if (canonical(local.vod[id]?.positions ?? {}) !== canonical(v.positions)) vod[id] = v;
    // A position with no value (none here, none in the blob) is not on the device: the ledger leaves it out.
    positionStamps[id] = Object.fromEntries(Object.entries(stampsOf(blob.positions[id])).filter(([key, s]) => s.del || key in v.positions));
  }
  const after: LocalState = { providers, secrets: { ...local.secrets, ...secrets }, lists: {}, vod: {} };
  const next: SyncMeta = {
    ...meta,
    seeded: true,
    providers: stampsOf(blob.providers),
    providerHashes: Object.fromEntries(own.map((id) => [id, hashText(canonical(syncedOf(after, id)))])),
    settingsAt: blob.settings.at,
    settingsHash: settingsHashOf(own, startWith),
    favourites: Object.fromEntries(fullOrder.map((id) => [id, stampsOf(blob.favourites[id])])),
    recents: Object.fromEntries(fullOrder.map((id) => [id, stampsOf(blob.recents[id])])),
    positions: positionStamps,
  };
  return { providers, secrets, reload, removed, lists, vod, meta: next };
}

const providersShape = (s: ProvidersSnapshot) => ({
  order: s.order,
  startWith: s.startWith ?? null,
  providers: s.order.map((id) => {
    const p = s.providers[id];
    return p ? [p.kind, p.name, p.server, p.userAgent, p.createdAt] : null;
  }),
});

/** True when the plan changes nothing on the device. */
export function planIsEmpty(plan: ApplyPlan, local: LocalState): boolean {
  return (
    !plan.removed.length &&
    !Object.keys(plan.secrets).length &&
    !Object.keys(plan.lists).length &&
    !Object.keys(plan.vod).length &&
    canonical(providersShape(plan.providers)) === canonical(providersShape(local.providers))
  );
}

// ---- Reading and writing the blob ------------------------------------------------------------

/** A channel snap from the blob (the list migration keeps only snap fields: no URLs). */
function snapValue(id: string, v: unknown): ChannelSnap | null {
  return migrateLists({ favourites: [id], recents: [], snaps: { [id]: v } }).snaps[id] ?? null;
}

function positionValue(key: string, v: unknown): VodPosition | null {
  const p = migrateVodLists({ positions: { [key]: v } }).positions;
  return Object.values(p)[0] ?? null;
}

/** A provider from the blob; the record migration checks kind, name and server like saved records. */
function providerValue(id: string, v: unknown): SyncedProvider | null {
  if (!isObject(v)) return null;
  const rec = migrateProviders({ providers: { [id]: v } }).providers[id];
  if (!rec) return null;
  const raw = isObject(v.secrets) ? v.secrets : {};
  const secrets = syncedSecrets(Object.fromEntries(Object.entries(raw).filter(([, x]) => typeof x === 'string')) as ProviderSecrets);
  if (rec.kind === 'm3u' && !secrets.playlistUrl) return null;
  return { kind: rec.kind, name: rec.name, server: rec.server, userAgent: rec.userAgent, createdAt: rec.createdAt, secrets };
}

/** Lists per provider: of a provider that exists, or one the blob does not know (a provider shared with the user). */
function perProvider<T>(raw: unknown, ok: (id: string) => boolean, read: (v: unknown) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObject(raw)) return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw)) {
    if (!ok(id) || n++ >= MAX_SYNC_PROVIDERS) continue;
    out[id] = read(v);
  }
  return out;
}

/**
 * Reads a blob from the server into the current shape. It never throws:
 * a blob it cannot read is null (no blob), a bad provider or entry is dropped.
 * v1: the shape above. A later version adds its step here, with a test of the old shape.
 */
export function migrateBlob(raw: unknown): SyncBlob | null {
  if (!isObject(raw) || !isNum(raw.schemaVersion) || raw.schemaVersion < 1) return null;
  // A newer app's blob: this version reads the fields it knows.
  const all = readStampedMap(raw.providers, providerValue, MAX_SYNC_PROVIDERS * 2);
  // A provider with no readable value is not one: it is dropped (a removal marker stays).
  const providers: StampedMap<SyncedProvider> = {};
  for (const [id, e] of Object.entries(all)) if (e.del || e.val) providers[id] = e;
  const alive = new Set(aliveProviders(providers));
  const s = isObject(raw.settings) ? raw.settings : {};
  const order = Array.isArray(s.order) ? s.order.filter((x): x is string => typeof x === 'string' && alive.has(x)) : [];
  // A start choice can be a shared provider (not in this blob): the device checks it.
  const startWith = typeof s.startWith === 'string' && s.startWith && (alive.has(s.startWith) || !(s.startWith in providers)) ? s.startWith : null;
  const listOk = (id: string) => !!id && (alive.has(id) || !(id in providers));
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    providers,
    settings: { at: isNum(s.at) ? s.at : 0, order, startWith },
    favourites: perProvider(raw.favourites, listOk, (v) => readStampedMap(v, snapValue, MAX_FAVOURITES * 2)),
    recents: perProvider(raw.recents, listOk, (v) => readStampedMap(v, snapValue, MAX_RECENTS * 10)),
    positions: perProvider(raw.positions, listOk, (v) => readStampedMap(v, positionValue, MAX_SYNC_POSITIONS * 10)),
  };
}

/** The ledger of any version. It never throws: bad data is the empty ledger (the next sync seeds it again). */
export function migrateMeta(raw: unknown): SyncMeta {
  if (!isObject(raw)) return EMPTY_META;
  const stamps = (v: unknown): StampMap => stampsOf(readStampedMap(v, () => null, NO_LIMIT));
  const stampMaps = (v: unknown): Record<string, StampMap> => {
    const out: Record<string, StampMap> = {};
    if (!isObject(v)) return out;
    for (const [pid, m] of Object.entries(v)) out[pid] = stamps(m);
    return out;
  };
  const hashes: Record<string, string> = {};
  if (isObject(raw.providerHashes)) for (const [k, v] of Object.entries(raw.providerHashes)) if (typeof v === 'string') hashes[k] = v;
  return {
    schemaVersion: SYNC_META_SCHEMA_VERSION,
    seeded: raw.seeded === true,
    dirty: raw.dirty === true,
    providers: stamps(raw.providers),
    providerHashes: hashes,
    settingsAt: isNum(raw.settingsAt) ? raw.settingsAt : 0,
    settingsHash: typeof raw.settingsHash === 'string' ? raw.settingsHash : '',
    favourites: stampMaps(raw.favourites),
    recents: stampMaps(raw.recents),
    positions: stampMaps(raw.positions),
  };
}

/** The blob's text, made smaller when it is too large: positions go first, then recents. Null when even that is too large. */
export function blobText(blob: SyncBlob): string | null {
  const steps: ((b: SyncBlob) => SyncBlob)[] = [(b) => b, (b) => ({ ...b, positions: {} }), (b) => ({ ...b, positions: {}, recents: {} })];
  for (const step of steps) {
    const text = JSON.stringify(step(blob));
    if (text.length <= MAX_SYNC_CHARS) return text;
  }
  return null;
}

/** The CustomPrefs values for a blob text: numbered parts and their count. */
export const encodeChunks = (text: string): Record<string, string> => chunks.encode(text);

/** True for a CustomPrefs key this module writes. */
export const isSyncKey = (k: string) => chunks.isKey(k);

/** The blob in the CustomPrefs, or null (none, or unreadable). Never throws. */
export function decodeChunks(prefs: CustomPrefs): SyncBlob | null {
  const text = chunks.decode(prefs);
  if (text === null) return null;
  try {
    return migrateBlob(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The CustomPrefs to send: the other keys as they are and the blob's keys new. */
export const withBlob = (prefs: CustomPrefs, text: string): Record<string, string> => chunks.withText(prefs, text);
