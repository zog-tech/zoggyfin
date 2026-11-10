/**
 * Extensions in the Jellyfin account: the rules that turn the account's
 * installed extensions on this device into one versioned blob, merge it
 * with the blob of the account, and say what this device must change.
 * `io.ts` does the I/O. The stamp rules are the ones of Live TV
 * (`lib/account-blob.ts`).
 *
 * - Per extension: the manifest URL, on or off, the grants, the settings
 *   that are not secret, the tab page, the phone-only tab choice
 *   (`phoneTab`) and when it was added. Every device keeps and sends
 *   `phoneTab` as it got it; only phones act on it (`placement.ts`). The
 *   field is optional, so the blob stays version 1: an older app drops it. Secret
 *   settings never go into the blob (they stay in this device's secure
 *   store). The manifest itself never goes either: a device that installs
 *   from the account loads it from the URL.
 * - Per skip label (`<extensionId>:<label>`): the skip choice.
 * - Extensions and skip choices merge one by one: the newer stamp wins, a
 *   removal leaves a marker (30 days), so a removal on one device removes
 *   the extension on the others, with no question.
 * - The first sync of a device gives what it has the lowest stamps, so it
 *   only adds to the account (and a removal in the account still wins).
 * - An extension in the account that this device does not have is offered
 *   on the confirm screen, once per add: the device ledger keeps the ones
 *   it offered (`seen`, by when they were added). "Not now" leaves it seen.
 *   A new add on another device (a new `addedAt`) is offered again. A
 *   change of its settings elsewhere is not.
 * - The confirm screen for an offer starts from the account's grants, and
 *   the install takes the account's settings, tab and add time
 *   (`accountInstall`). When the result equals the account's entry, it
 *   takes the account's stamp and sends nothing. When the user changed a
 *   grant on the screen, it is a change of this device: a new stamp, so it
 *   wins and goes to the account, and a later pull of the older account
 *   value does not undo it. A newer change elsewhere still wins after.
 * - Data from the server is checked field by field: bad data is dropped,
 *   never thrown. Nothing here holds a secret.
 *
 * Pure, so it is unit-tested.
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
  type Stamped,
  type StampedMap,
  type StampMap,
  stampsOf,
} from '@/lib/account-blob';

import { isReplaceableTab, type ReplaceableTab } from '@/lib/tab-destination';

import type { Grants } from '../http';
import { SKIP_MODES, type Manifest, type SkipMode } from '../schema';
import type { AccountExtensions, InstalledExtension, Values } from '../types';

export const EXT_SYNC_SCHEMA_VERSION = 1;
export const EXT_SYNC_META_SCHEMA_VERSION = 1;
/** The most entries (with removal markers) the blob keeps. */
export const MAX_SYNC_EXTENSIONS = 200;
export const MAX_SYNC_SKIP = 1000;
/** The largest blob the app writes. */
export const MAX_EXT_SYNC_CHARS = 400_000;
/** The CustomPrefs keys: `ext.parts` and `ext.<n>`. */
export const extChunks = chunkCodec('ext');

/** One extension in the blob. */
export interface SyncedExtension {
  manifestUrl: string;
  enabled: boolean;
  grants: Grants;
  /** The settings the user set that are not secret. */
  settings: Values;
  /** The page shown as a tab. */
  tab?: string;
  /** Phones only: the tab the page takes the place of. */
  phoneTab?: ReplaceableTab;
  /** When it was added (the install's `installedAt`): a new add has a new one. */
  addedAt: number;
}

export interface ExtSyncBlob {
  schemaVersion: number;
  extensions: StampedMap<SyncedExtension>;
  skip: StampedMap<SkipMode>;
}

/** An offered extension: the add it belongs to, the account's stamp then, and the hash of the account's entry. */
export interface Seen {
  added: number;
  at: number;
  hash?: string;
}

/** The device's ledger, per account (MMKV). No secrets. */
export interface ExtSyncMeta {
  schemaVersion: number;
  seeded: boolean;
  dirty: boolean;
  extensions: StampMap;
  hashes: Record<string, string>;
  skip: StampMap;
  skipHashes: Record<string, string>;
  /** Extensions of the account this device offered on the confirm screen. */
  seen: Record<string, Seen>;
}

export const EMPTY_EXT_META: ExtSyncMeta = { schemaVersion: EXT_SYNC_META_SCHEMA_VERSION, seeded: false, dirty: false, extensions: {}, hashes: {}, skip: {}, skipHashes: {}, seen: {} };

/** What the device has for the signed-in account. */
export type LocalExtensions = Pick<AccountExtensions, 'list' | 'values' | 'skip'>;

/** The keys of the secret settings of a manifest: they never sync. */
export function secretKeys(m: Pick<Manifest, 'contributes'>): Set<string> {
  return new Set((m.contributes.settings ?? []).filter((f) => f.type === 'text' && f.secret).map((f) => f.key));
}

/** The settings of an extension that sync: not secret, and never a secret's marker. */
export function syncedSettings(m: Pick<Manifest, 'contributes'>, values: Values | undefined): Values {
  const secret = secretKeys(m);
  const out: Values = {};
  for (const [k, v] of Object.entries(values ?? {})) if (!secret.has(k) && v !== '•') out[k] = v;
  return out;
}

export function syncedOf(local: LocalExtensions, id: string): SyncedExtension | null {
  const e = local.list.find((x) => x.manifest.id === id);
  if (!e) return null;
  const out: SyncedExtension = {
    manifestUrl: e.manifestUrl,
    enabled: e.enabled,
    grants: { itemPath: !!e.grants.itemPath, jellyfinToken: !!e.grants.jellyfinToken, playback: !!e.grants.playback, downloads: !!e.grants.downloads },
    settings: syncedSettings(e.manifest, local.values[id]),
    addedAt: e.installedAt,
  };
  if (e.tab) out.tab = e.tab;
  if (e.phoneTab) out.phoneTab = e.phoneTab;
  return out;
}

const NO_LIMIT = Number.MAX_SAFE_INTEGER;
/** The lowest stamp: what a device had before its first sync only adds to the account. */
const SEED_STAMP = 1;

/**
 * Brings a stamp map up to date with the current values. A new or changed
 * value gets a new stamp (`stampFor`), a value that is gone a removal
 * marker. Returns null when nothing changed.
 */
function observeValues<T>(
  stamps: StampMap,
  hashes: Record<string, string>,
  current: Record<string, T>,
  stampFor: (id: string, old: Stamp | undefined) => number,
  now: number,
): { stamps: StampMap; hashes: Record<string, string> } | null {
  let s = stamps;
  let h = hashes;
  for (const [id, v] of Object.entries(current)) {
    const hash = hashText(canonical(v));
    if (h[id] === hash && s[id] && !s[id].del) continue;
    s = { ...s, [id]: { at: stampFor(id, s[id]) } };
    h = { ...h, [id]: hash };
  }
  for (const [id, old] of Object.entries(stamps)) {
    if (old.del || id in current) continue;
    s = { ...s, [id]: { at: Math.max(now, old.at + 1), del: true } };
    const { [id]: _gone, ...rest } = h;
    h = rest;
  }
  return s === stamps && h === hashes ? null : { stamps: s, hashes: h };
}

type Stamp = StampMap[string];

/**
 * Brings the ledger up to date with what the device has now. Returns the
 * same object when nothing changed, so a caller knows there is nothing to send.
 */
export function observe(meta: ExtSyncMeta, local: LocalExtensions, now: number): ExtSyncMeta {
  const seeding = !meta.seeded;
  const current: Record<string, SyncedExtension> = {};
  for (const e of local.list) current[e.manifest.id] = syncedOf(local, e.manifest.id) as SyncedExtension;
  const ext = observeValues(
    meta.extensions,
    meta.hashes,
    current,
    (id, old) => {
      if (seeding) return SEED_STAMP;
      // An install of an offered extension that is the same as the account's entry takes the account's
      // stamp (nothing to send). One the user changed on the confirm screen is a new change: it wins.
      const offered = meta.seen[id];
      if ((!old || old.del) && offered?.hash && offered.at > (old?.at ?? 0) && offered.hash === hashText(canonical(current[id]))) return offered.at;
      return Math.max(now, (old?.at ?? 0) + 1);
    },
    now,
  );
  const skip = observeValues(meta.skip, meta.skipHashes, local.skip, (_id, old) => (seeding ? SEED_STAMP : Math.max(now, (old?.at ?? 0) + 1)), now);
  if (!seeding && !ext && !skip) return meta;
  return {
    ...meta,
    seeded: true,
    extensions: ext?.stamps ?? meta.extensions,
    hashes: ext?.hashes ?? meta.hashes,
    skip: skip?.stamps ?? meta.skip,
    skipHashes: skip?.hashes ?? meta.skipHashes,
  };
}

function withValues<T>(stamps: StampMap, valueOf: (id: string) => T | undefined | null): StampedMap<T> {
  const out: StampedMap<T> = {};
  for (const [id, s] of Object.entries(stamps)) {
    if (s.del) out[id] = { at: s.at, del: true };
    else {
      const val = valueOf(id);
      out[id] = val == null ? { at: s.at } : { at: s.at, val };
    }
  }
  return out;
}

/** The device's blob: the ledger's stamps with the values the device has. Call `observe` first. */
export function localBlob(meta: ExtSyncMeta, local: LocalExtensions): ExtSyncBlob {
  return {
    schemaVersion: EXT_SYNC_SCHEMA_VERSION,
    extensions: withValues(meta.extensions, (id) => syncedOf(local, id)),
    skip: withValues(meta.skip, (k) => local.skip[k]),
  };
}

/** Keeps at most `max` entries: the oldest removal markers go first. */
function capMarkers<T>(m: StampedMap<T>, max: number): StampedMap<T> {
  const keys = Object.keys(m);
  if (keys.length <= max) return m;
  const out = { ...m };
  const dead = keys.filter((k) => m[k].del).sort((x, y) => m[x].at - m[y].at);
  for (const k of dead.slice(0, keys.length - max)) delete out[k];
  return out;
}

/** Merges the device's blob with the account's (the account wins a tie). */
export function mergeBlobs(local: ExtSyncBlob, remote: ExtSyncBlob | null, now: number): ExtSyncBlob {
  const r = remote ?? { schemaVersion: EXT_SYNC_SCHEMA_VERSION, extensions: {}, skip: {} };
  return {
    schemaVersion: EXT_SYNC_SCHEMA_VERSION,
    extensions: capMarkers(mergeStamped(r.extensions, local.extensions, now, NO_LIMIT), MAX_SYNC_EXTENSIONS),
    skip: capMarkers(mergeStamped(r.skip, local.skip, now, NO_LIMIT), MAX_SYNC_SKIP),
  };
}

export function sameBlob(a: ExtSyncBlob | null, b: ExtSyncBlob | null): boolean {
  if (!a || !b) return a === b;
  return canonical(a) === canonical(b);
}

/** True when the blob holds nothing: a user with no extensions anywhere gets no blob. */
export function isEmptyBlob(b: ExtSyncBlob): boolean {
  return !Object.keys(b.extensions).length && !Object.keys(b.skip).length;
}

// ---- Applying a merged blob to the device -----------------------------------------------------------

/** An extension of the account to offer on the confirm screen. */
export interface Offer {
  id: string;
  manifestUrl: string;
  added: number;
  at: number;
  /** The account's entry: the confirm screen and the install start from it. */
  val: SyncedExtension;
}

export interface ApplyPlan {
  /** Installed here, removed in the account: remove, with no question. */
  remove: string[];
  /** Installed here, changed in the account: the account's values. */
  update: Record<string, SyncedExtension>;
  /** In the account, not here, not offered for this add yet. */
  offer: Offer[];
  /** The skip choices to keep, or null when they do not change. */
  skip: Record<string, SkipMode> | null;
  /** The ledger that matches the merged blob (call `markSeen` once the offer shows). */
  meta: ExtSyncMeta;
}

/** What the device must change to match the merged blob. */
export function planApply(local: LocalExtensions, blob: ExtSyncBlob, meta: ExtSyncMeta): ApplyPlan {
  const installed = new Set(local.list.map((e) => e.manifest.id));
  const remove: string[] = [];
  const update: Record<string, SyncedExtension> = {};
  const offer: Offer[] = [];
  const stamps: StampMap = {};
  const hashes: Record<string, string> = {};
  for (const [id, e] of Object.entries(blob.extensions)) {
    if (e.del) {
      if (installed.has(id)) remove.push(id);
      stamps[id] = { at: e.at, del: true };
      continue;
    }
    if (!installed.has(id)) {
      // Not in this device's ledger, so a later look does not count it as removed here.
      if (e.val && meta.seen[id]?.added !== e.val.addedAt) offer.push({ id, manifestUrl: e.val.manifestUrl, added: e.val.addedAt, at: e.at, val: e.val });
      continue;
    }
    const mine = syncedOf(local, id) as SyncedExtension;
    const val = e.val ?? mine;
    if (canonical(mine) !== canonical(val)) update[id] = val;
    stamps[id] = { at: e.at };
    hashes[id] = hashText(canonical(val));
  }
  // An extension installed here that the merged blob has no entry for (it cannot happen after a merge): keep the ledger's stamp.
  for (const id of installed) {
    if (id in blob.extensions || !meta.extensions[id]) continue;
    stamps[id] = meta.extensions[id];
    if (meta.hashes[id]) hashes[id] = meta.hashes[id];
  }
  const skipNow: Record<string, SkipMode> = {};
  const skipHashes: Record<string, string> = {};
  for (const [k, e] of Object.entries(blob.skip)) {
    const v = e.del ? undefined : (e.val ?? local.skip[k]);
    if (v) {
      skipNow[k] = v;
      skipHashes[k] = hashText(canonical(v));
    }
  }
  const skipStamps = Object.fromEntries(Object.entries(stampsOf(blob.skip)).filter(([k, s]) => s.del || k in skipNow));
  const skip = canonical(skipNow) === canonical(local.skip) ? null : skipNow;
  return {
    remove,
    update,
    offer,
    skip,
    meta: { ...meta, seeded: true, extensions: stamps, hashes, skip: skipStamps, skipHashes },
  };
}

/** The ledger once the offers show: "Not now" or not, they are not offered again for this add. */
export function markSeen(meta: ExtSyncMeta, offers: readonly Offer[]): ExtSyncMeta {
  if (!offers.length) return meta;
  const seen = { ...meta.seen };
  for (const o of offers) seen[o.id] = { added: o.added, at: o.at, hash: hashText(canonical(o.val)) };
  return { ...meta, seen };
}

/**
 * An install from an offer: the new extension with the account's add time,
 * on/off state and tab, and its values with the account's settings (secret
 * ones stay as they are on the device). The grants are the ones the user
 * set on the confirm screen.
 */
export function accountInstall(ext: InstalledExtension, values: Values | undefined, val: SyncedExtension): { ext: InstalledExtension; values: Values } {
  const next: InstalledExtension = { ...ext, enabled: val.enabled, installedAt: val.addedAt };
  delete next.tab;
  delete next.phoneTab;
  if (val.tab) next.tab = val.tab;
  if (val.phoneTab) next.phoneTab = val.phoneTab;
  const secret = secretKeys(ext.manifest);
  const out: Values = {};
  for (const [k, v] of Object.entries(values ?? {})) if (secret.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(val.settings)) if (!secret.has(k)) out[k] = v;
  return { ext: next, values: out };
}

/** True when the plan changes nothing on the device. */
export function planIsEmpty(plan: ApplyPlan): boolean {
  return !plan.remove.length && !Object.keys(plan.update).length && plan.skip === null;
}

/**
 * The device's list, values and skip choices after a plan (the removals
 * are done by the caller, with their secrets). Secret settings and their
 * markers stay as they are; the other settings become the account's.
 */
export function applyUpdates(local: LocalExtensions, plan: Pick<ApplyPlan, 'update' | 'skip'>): LocalExtensions {
  let list = local.list;
  let values = local.values;
  for (const [id, val] of Object.entries(plan.update)) {
    const e = list.find((x) => x.manifest.id === id);
    if (!e) continue;
    const next: InstalledExtension = { ...e, manifestUrl: val.manifestUrl, enabled: val.enabled, grants: { ...val.grants }, installedAt: val.addedAt };
    delete next.tab;
    delete next.phoneTab;
    if (val.tab) next.tab = val.tab;
    if (val.phoneTab) next.phoneTab = val.phoneTab;
    list = list.map((x) => (x === e ? next : x));
    const secret = secretKeys(e.manifest);
    const kept: Values = {};
    for (const [k, v] of Object.entries(values[id] ?? {})) if (secret.has(k)) kept[k] = v;
    for (const [k, v] of Object.entries(val.settings)) if (!secret.has(k)) kept[k] = v;
    values = { ...values, [id]: kept };
  }
  return { list, values, skip: plan.skip ?? local.skip };
}

// ---- Reading and writing the blob ------------------------------------------------------------

const isHttpUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048 && /^https?:\/\/\S+$/i.test(v);

function syncedValue(_id: string, v: unknown): SyncedExtension | null {
  if (!isObject(v) || !isHttpUrl(v.manifestUrl)) return null;
  const g = isObject(v.grants) ? v.grants : {};
  const settings: Values = {};
  if (isObject(v.settings)) for (const [k, x] of Object.entries(v.settings)) if (typeof x === 'string' || typeof x === 'boolean') settings[k] = x;
  const out: SyncedExtension = {
    manifestUrl: v.manifestUrl,
    enabled: v.enabled !== false,
    // A grant the entry does not name yet (`playback`, `downloads`) is on: it counts only with its permission.
    grants: { itemPath: g.itemPath === true, jellyfinToken: g.jellyfinToken === true, playback: g.playback !== false, downloads: g.downloads !== false },
    settings,
    addedAt: isNum(v.addedAt) ? v.addedAt : 0,
  };
  if (typeof v.tab === 'string' && v.tab) out.tab = v.tab;
  if (isReplaceableTab(v.phoneTab)) out.phoneTab = v.phoneTab;
  return out;
}

const skipValue = (id: string, v: unknown): SkipMode | null => (id.includes(':') && (SKIP_MODES as readonly unknown[]).includes(v) ? (v as SkipMode) : null);

/** Keeps removal markers and entries with a value: an entry with no readable value is dropped. */
function readable<T>(m: StampedMap<T>): StampedMap<T> {
  const out: StampedMap<T> = {};
  for (const [id, e] of Object.entries(m) as [string, Stamped<T>][]) if (e.del || e.val !== undefined) out[id] = e;
  return out;
}

/**
 * Reads a blob from the server into the current shape. It never throws:
 * a blob it cannot read is null (no blob), a bad entry is dropped.
 * v1: the shape above. A later version adds its step here, with a test of the old shape.
 */
export function migrateExtBlob(raw: unknown): ExtSyncBlob | null {
  if (!isObject(raw) || !isNum(raw.schemaVersion) || raw.schemaVersion < 1) return null;
  return {
    schemaVersion: EXT_SYNC_SCHEMA_VERSION,
    extensions: readable(readStampedMap(raw.extensions, syncedValue, MAX_SYNC_EXTENSIONS * 2)),
    skip: readable(readStampedMap(raw.skip, skipValue, MAX_SYNC_SKIP * 2)),
  };
}

/** The ledger of any version. It never throws: bad data is the empty ledger (the next sync seeds it again). */
export function migrateExtMeta(raw: unknown): ExtSyncMeta {
  if (!isObject(raw)) return EMPTY_EXT_META;
  const stamps = (v: unknown): StampMap => stampsOf(readStampedMap(v, () => null, NO_LIMIT));
  const hashes = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (isObject(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
    return out;
  };
  const seen: Record<string, Seen> = {};
  if (isObject(raw.seen)) for (const [k, x] of Object.entries(raw.seen)) if (isObject(x) && isNum(x.added) && isNum(x.at)) seen[k] = typeof x.hash === 'string' ? { added: x.added, at: x.at, hash: x.hash } : { added: x.added, at: x.at };
  return {
    schemaVersion: EXT_SYNC_META_SCHEMA_VERSION,
    seeded: raw.seeded === true,
    dirty: raw.dirty === true,
    extensions: stamps(raw.extensions),
    hashes: hashes(raw.hashes),
    skip: stamps(raw.skip),
    skipHashes: hashes(raw.skipHashes),
    seen,
  };
}

/** The blob's text, or null when it is too large to write. */
export function extBlobText(blob: ExtSyncBlob): string | null {
  const text = JSON.stringify(blob);
  return text.length <= MAX_EXT_SYNC_CHARS ? text : null;
}

/** The blob in the CustomPrefs, or null (none, or unreadable). Never throws. */
export function decodeExtBlob(prefs: CustomPrefs): ExtSyncBlob | null {
  const text = extChunks.decode(prefs);
  if (text === null) return null;
  try {
    return migrateExtBlob(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The CustomPrefs to send: the other keys as they are and the blob's keys new. */
export const withExtBlob = (prefs: CustomPrefs, text: string): Record<string, string> => extChunks.withText(prefs, text);
