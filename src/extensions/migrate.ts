/**
 * Reads the saved extension data of any version into the current shape.
 *
 * - `extensions.v1` was one list for the whole device. `extensions.v2` keeps
 *   one list per Jellyfin account (`<serverId>.<userId>`), because account
 *   sync is per account.
 * - The move from v1 copies the device list, grants, setting values and
 *   fetched options to every account saved on the device. With no saved
 *   account, the list waits in `unclaimed` and the first account that signs
 *   in takes it. No install is lost.
 * - Grants keep their values. The grants added with schema version 2
 *   (`playback`, `downloads`) are on when the manifest asks for them.
 * - Secret settings stay in the secure store under `ext.<id>.<key>`; the
 *   names do not change, so the copied `•` markers still find them.
 * - A saved manifest goes through `parseManifest` again, so a v1-era shape
 *   (no `pages`) gets the current model. One that no longer parses but has
 *   the basic fields is kept as it is (`pagesOf` reads it).
 * - v3 adds the phone-only `phoneTab` per extension ("On this phone").
 *   A v2 entry has none: its tab page stays a Library tile on phones. An
 *   unknown value is dropped (the Library tile).
 * - Bad entries are dropped one by one. Nothing here throws.
 *
 * Pure, so it is unit-tested.
 */
import { isReplaceableTab } from '@/lib/tab-destination';

import { readGrants } from './grants';
import { parseManifest, SKIP_MODES, type Manifest, type SkipMode } from './schema';
import { type AccountExtensions, type ChoiceOptions, EMPTY_ACCOUNT_EXTENSIONS, type InstalledExtension, type Values } from './types';

export const EXTENSIONS_KEY_V1 = 'extensions.v1';
export const EXTENSIONS_KEY = 'extensions.v2';
export const EXTENSIONS_SCHEMA_VERSION = 3;
/** The first version with one list per account: `extensions.v2` holds it from this version on. */
const PER_ACCOUNT_VERSION = 2;

export interface ExtensionsData {
  schemaVersion: typeof EXTENSIONS_SCHEMA_VERSION;
  /** Per account key (`accountKey`). */
  accounts: Record<string, AccountExtensions>;
  /** A v1 list found when no account was saved: the first account to sign in takes it. */
  unclaimed: AccountExtensions | null;
}

export const EMPTY_EXTENSIONS_DATA: ExtensionsData = { schemaVersion: EXTENSIONS_SCHEMA_VERSION, accounts: {}, unclaimed: null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A saved manifest in the current model, or null when it is not a manifest at all. */
export function readSavedManifest(raw: unknown): Manifest | null {
  if (!isObject(raw) || !str(raw.id) || !str(raw.name) || !str(raw.baseUrl) || !isObject(raw.contributes ?? {})) return null;
  const r = parseManifest(raw);
  if (r.ok) return r.manifest;
  // Kept as saved: the runtime reads the lists it knows, and `pagesOf` reads a missing `pages`.
  const permissions = Array.isArray(raw.permissions) ? raw.permissions.filter(str) : ['network'];
  return { ...(raw as unknown as Manifest), permissions: permissions as Manifest['permissions'], contributes: (raw.contributes ?? {}) as Manifest['contributes'] };
}

function readInstalled(raw: unknown): InstalledExtension | null {
  if (!isObject(raw) || !str(raw.manifestUrl)) return null;
  const manifest = readSavedManifest(raw.manifest);
  if (!manifest) return null;
  const ext: InstalledExtension = {
    manifestUrl: raw.manifestUrl,
    manifest,
    enabled: raw.enabled !== false,
    grants: readGrants(raw.grants, manifest.permissions),
    installedAt: typeof raw.installedAt === 'number' && Number.isFinite(raw.installedAt) ? raw.installedAt : 0,
  };
  if (str(raw.tab)) ext.tab = raw.tab;
  if (isReplaceableTab(raw.phoneTab)) ext.phoneTab = raw.phoneTab;
  return ext;
}

function readValues(raw: unknown): Record<string, Values> {
  const out: Record<string, Values> = {};
  if (!isObject(raw)) return out;
  for (const [extId, vals] of Object.entries(raw)) {
    if (!isObject(vals)) continue;
    const v: Values = {};
    for (const [k, x] of Object.entries(vals)) if (typeof x === 'string' || typeof x === 'boolean') v[k] = x;
    out[extId] = v;
  }
  return out;
}

function readOptions(raw: unknown): Record<string, ChoiceOptions> {
  const out: Record<string, ChoiceOptions> = {};
  if (!isObject(raw)) return out;
  for (const [extId, fields] of Object.entries(raw)) {
    if (!isObject(fields)) continue;
    const f: ChoiceOptions = {};
    for (const [key, list] of Object.entries(fields)) {
      if (!Array.isArray(list)) continue;
      f[key] = list.filter((o): o is { value: string; label: string } => isObject(o) && typeof o.value === 'string' && typeof o.label === 'string').map((o) => ({ value: o.value, label: o.label }));
    }
    out[extId] = f;
  }
  return out;
}

function readSkip(raw: unknown): Record<string, SkipMode> {
  const out: Record<string, SkipMode> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (k.includes(':') && (SKIP_MODES as readonly unknown[]).includes(v)) out[k] = v as SkipMode;
  return out;
}

/** One account's extensions, from any saved shape (v1 had the same fields for the device). */
export function readAccountExtensions(raw: unknown): AccountExtensions {
  if (!isObject(raw)) return EMPTY_ACCOUNT_EXTENSIONS;
  const byId = new Map<string, InstalledExtension>();
  // The same id twice: the later entry wins, as `upsertExtension` did.
  for (const e of Array.isArray(raw.list) ? raw.list : []) {
    const ext = readInstalled(e);
    if (ext) {
      byId.delete(ext.manifest.id);
      byId.set(ext.manifest.id, ext);
    }
  }
  return { list: [...byId.values()], values: readValues(raw.values), auto: readValues(raw.auto), options: readOptions(raw.options), skip: readSkip(raw.skip) };
}

const isEmpty = (a: AccountExtensions) => !a.list.length && !Object.keys(a.values).length && !Object.keys(a.auto).length;

/**
 * The saved data in the current shape. `v2` is the `extensions.v2` value,
 * `v1` the `extensions.v1` value (read only when there is no v2), and
 * `accounts` the keys of the accounts saved on the device. `migrated` is
 * true when the caller must write the result.
 */
export function loadExtensionsData(v2: unknown, v1: unknown, accounts: readonly string[]): { data: ExtensionsData; migrated: boolean } {
  if (isObject(v2) && typeof v2.schemaVersion === 'number' && v2.schemaVersion >= PER_ACCOUNT_VERSION) {
    const out: Record<string, AccountExtensions> = {};
    if (isObject(v2.accounts)) for (const [key, a] of Object.entries(v2.accounts)) if (key) out[key] = readAccountExtensions(a);
    const unclaimed = v2.unclaimed ? readAccountExtensions(v2.unclaimed) : null;
    // v2 → v3: the same shape; no entry has `phoneTab` yet. Saved again as v3.
    return {
      data: { schemaVersion: EXTENSIONS_SCHEMA_VERSION, accounts: out, unclaimed: unclaimed && !isEmpty(unclaimed) ? unclaimed : null },
      migrated: v2.schemaVersion < EXTENSIONS_SCHEMA_VERSION,
    };
  }
  const device = readAccountExtensions(v1);
  if (isEmpty(device)) return { data: EMPTY_EXTENSIONS_DATA, migrated: v1 !== null && v1 !== undefined };
  if (!accounts.length) return { data: { ...EMPTY_EXTENSIONS_DATA, unclaimed: device }, migrated: true };
  const out: Record<string, AccountExtensions> = {};
  for (const key of accounts) out[key] = device;
  return { data: { schemaVersion: EXTENSIONS_SCHEMA_VERSION, accounts: out, unclaimed: null }, migrated: true };
}

/**
 * The extensions of an account. An account with nothing saved takes the
 * `unclaimed` list, once. Returns the data to save when that happened.
 */
export function claimAccount(data: ExtensionsData, key: string): { slice: AccountExtensions; data: ExtensionsData } {
  const have = data.accounts[key];
  if (have) return { slice: have, data };
  if (!data.unclaimed) return { slice: EMPTY_ACCOUNT_EXTENSIONS, data };
  const slice = data.unclaimed;
  return { slice, data: { ...data, accounts: { ...data.accounts, [key]: slice }, unclaimed: null } };
}

/** True when another account than `key` has this extension (its secrets are shared by name). */
export function installedElsewhere(data: ExtensionsData, key: string | null, extId: string): boolean {
  if (data.unclaimed?.list.some((e) => e.manifest.id === extId)) return true;
  return Object.entries(data.accounts).some(([k, a]) => k !== key && a.list.some((e) => e.manifest.id === extId));
}
