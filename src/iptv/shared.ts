/**
 * Providers that a server admin shares with other users of the same
 * Jellyfin server. Pure, so it is unit-tested; `share-sync.ts` does the I/O.
 *
 * - The admin's app writes the shared providers into each chosen user's
 *   display preferences (id `zoggyfin-iptv-shared`, key `shared`), never
 *   into the user's own synced blob. Jellyfin lets only an admin write
 *   another user's display preferences.
 * - Each admin owns the entries it wrote (`by.userId`): an admin's app
 *   replaces only its own entries, so two admins can share with one user.
 * - The admin's choices (which users, or everyone) are in the admin's own
 *   display preferences (same id, key `sharing`), so every device of the
 *   admin applies them. "Everyone" also covers users added later: the
 *   admin's app writes to them the next time it runs.
 * - On the user's device a shared provider has the id `sh_<the admin's id>`
 *   (`localSharedId`), so the admin's own provider on the same device is a
 *   different one. It is read only.
 * - Data from the server is checked field by field: bad data is dropped,
 *   never thrown.
 */
import { canonical, type SyncedProvider, type SyncedSecrets } from './account-sync';
import { migrateProviders } from './migrate';
import type { ProviderRecord, ProviderSecrets } from './types';

export const SHARED_PREFS_ID = 'zoggyfin-iptv-shared';
export const SHARED_KEY = 'shared';
export const SHARING_KEY = 'sharing';
export const SHARED_SCHEMA_VERSION = 1;
/** The most characters of one value; shared providers are few and small. */
export const MAX_SHARED_CHARS = 200_000;
const MAX_SHARED_PROVIDERS = 100;
const MAX_USERS = 2000;

export interface SharedBy {
  userId: string;
  name: string;
}

/** A provider in a user's shared blob. */
export interface SharedProvider extends SyncedProvider {
  by: SharedBy;
}

/** The providers shared with one user, by the admin's provider id. */
export interface SharedBlob {
  schemaVersion: number;
  providers: Record<string, SharedProvider>;
}

/** Who an admin shares one provider with. */
export interface ShareChoice {
  /** Every user of the server, also users added later. */
  everyone: boolean;
  /** User ids (used when `everyone` is false). */
  users: string[];
}

/** An admin's choices, by the admin's provider id. */
export interface SharingChoices {
  schemaVersion: number;
  providers: Record<string, ShareChoice>;
}

export const EMPTY_SHARED: SharedBlob = { schemaVersion: SHARED_SCHEMA_VERSION, providers: {} };
export const EMPTY_SHARING: SharingChoices = { schemaVersion: SHARED_SCHEMA_VERSION, providers: {} };

/** The id of a shared provider on the user's device. */
export const localSharedId = (providerId: string) => `sh_${providerId}`;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function secretsOf(v: unknown): SyncedSecrets {
  const out: SyncedSecrets = {};
  if (!isObject(v)) return out;
  for (const k of ['username', 'password', 'playlistUrl', 'guideUrl'] as const) {
    const x = str(v[k]);
    if (x) out[k] = x;
  }
  return out;
}

function sharedProvider(id: string, v: unknown): SharedProvider | null {
  if (!isObject(v) || !isObject(v.by) || !str(v.by.userId)) return null;
  const rec = migrateProviders({ providers: { [id]: v } }).providers[id];
  if (!rec) return null;
  const secrets = secretsOf(v.secrets);
  if (rec.kind === 'm3u' ? !secrets.playlistUrl : !secrets.username || !secrets.password) return null;
  return {
    kind: rec.kind,
    name: rec.name,
    server: rec.server,
    userAgent: rec.userAgent,
    createdAt: rec.createdAt,
    secrets,
    by: { userId: str(v.by.userId) as string, name: str(v.by.name) ?? 'an admin' },
  };
}

/** A user's shared blob of any version. Never throws: bad data is the empty blob, a bad provider is dropped. */
export function migrateShared(raw: unknown): SharedBlob {
  if (!isObject(raw) || !isObject(raw.providers)) return EMPTY_SHARED;
  const providers: Record<string, SharedProvider> = {};
  for (const [id, v] of Object.entries(raw.providers).slice(0, MAX_SHARED_PROVIDERS)) {
    const p = id && /^[\w-]+$/.test(id) ? sharedProvider(id, v) : null;
    if (p) providers[id] = p;
  }
  return { schemaVersion: SHARED_SCHEMA_VERSION, providers };
}

/** An admin's choices of any version. Never throws. */
export function migrateSharing(raw: unknown): SharingChoices {
  if (!isObject(raw) || !isObject(raw.providers)) return EMPTY_SHARING;
  const providers: Record<string, ShareChoice> = {};
  for (const [id, v] of Object.entries(raw.providers).slice(0, MAX_SHARED_PROVIDERS)) {
    if (!id || !isObject(v)) continue;
    const users = Array.isArray(v.users) ? [...new Set(v.users.filter((u): u is string => !!str(u)))].slice(0, MAX_USERS) : [];
    const choice: ShareChoice = { everyone: v.everyone === true, users };
    if (choice.everyone || users.length) providers[id] = choice;
  }
  return { schemaVersion: SHARED_SCHEMA_VERSION, providers };
}

function parseValue<T>(prefs: Record<string, string | null | undefined> | null | undefined, key: string, migrate: (raw: unknown) => T, empty: T): T {
  const text = prefs?.[key];
  if (typeof text !== 'string' || !text) return empty;
  try {
    return migrate(JSON.parse(text));
  } catch {
    return empty;
  }
}

export const parseShared = (prefs: Record<string, string | null | undefined> | null | undefined) => parseValue(prefs, SHARED_KEY, migrateShared, EMPTY_SHARED);
export const parseSharing = (prefs: Record<string, string | null | undefined> | null | undefined) => parseValue(prefs, SHARING_KEY, migrateSharing, EMPTY_SHARING);

/** The CustomPrefs with one key set to a value (or removed when null), the other keys as they are. */
export function withValue(prefs: Record<string, string | null | undefined> | null | undefined, key: string, value: unknown | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(prefs ?? {})) if (k !== key && typeof v === 'string') out[k] = v;
  if (value !== null) out[key] = JSON.stringify(value);
  return out;
}

/** Sets or clears the choice for one provider. Returns the same object when nothing changes. */
export function withChoice(choices: SharingChoices, providerId: string, choice: ShareChoice | null): SharingChoices {
  const clean = choice && (choice.everyone || choice.users.length) ? { everyone: choice.everyone, users: choice.everyone ? [] : [...new Set(choice.users)].sort() } : null;
  const old = choices.providers[providerId] ?? null;
  if (canonical(old) === canonical(clean)) return choices;
  const { [providerId]: _old, ...rest } = choices.providers;
  return { ...choices, providers: clean ? { ...rest, [providerId]: clean } : rest };
}

/** The users a choice reaches: everyone but the admin, or the chosen users that exist. */
export function targetsOf(choice: ShareChoice | undefined, userIds: readonly string[], adminId: string): string[] {
  if (!choice) return [];
  const exists = new Set(userIds);
  const ids = choice.everyone ? userIds : choice.users.filter((u) => exists.has(u));
  return ids.filter((u) => u !== adminId);
}

/**
 * The providers one user must get from this admin: each provider the admin
 * still has and shares with the user. A choice for a removed provider
 * reaches no one.
 */
export function desiredFor(userId: string, choices: SharingChoices, own: Record<string, SyncedProvider>, userIds: readonly string[], admin: SharedBy): Record<string, SharedProvider> {
  const out: Record<string, SharedProvider> = {};
  for (const [pid, choice] of Object.entries(choices.providers)) {
    const p = own[pid];
    if (p && targetsOf(choice, userIds, admin.userId).includes(userId)) out[pid] = { ...p, by: admin };
  }
  return out;
}

/**
 * A user's shared blob with this admin's entries replaced by `desired`. The
 * entries of other admins stay. Returns the same object when nothing changes,
 * so the admin's app writes only real changes.
 */
export function withAdminShares(blob: SharedBlob, adminId: string, desired: Record<string, SharedProvider>): SharedBlob {
  const providers: Record<string, SharedProvider> = {};
  for (const [id, p] of Object.entries(blob.providers)) if (p.by.userId !== adminId) providers[id] = p;
  for (const [id, p] of Object.entries(desired)) {
    // Another admin's entry under the same id stays (it was there first).
    if (!providers[id]) providers[id] = p;
  }
  return canonical(providers) === canonical(blob.providers) ? blob : { schemaVersion: SHARED_SCHEMA_VERSION, providers };
}

/** What a user's device must change: the shared providers to add or update, and the ones to remove. */
export interface SharedPlan {
  upsert: { record: ProviderRecord; secrets: ProviderSecrets; reload: boolean }[];
  remove: string[];
}

/**
 * Compares the shared providers on the device with the user's shared blob.
 * `me`: the signed-in user (a provider the user shared is the user's own,
 * never a shared copy). `secretsOf`: the secrets the device has.
 */
export function planShared(
  records: Record<string, ProviderRecord>,
  secretsOfId: (id: string) => ProviderSecrets,
  blob: SharedBlob,
  me: string,
  now: number,
): SharedPlan {
  const upsert: SharedPlan['upsert'] = [];
  const wanted = new Set<string>();
  for (const [pid, p] of Object.entries(blob.providers)) {
    if (p.by.userId === me) continue;
    const id = localSharedId(pid);
    wanted.add(id);
    const old = records[id];
    const oldSecrets = secretsOfId(id);
    const was: SyncedSecrets = {};
    for (const k of ['username', 'password', 'playlistUrl', 'guideUrl'] as const) if (oldSecrets[k]) was[k] = oldSecrets[k];
    const loginChanged = canonical(was) !== canonical(p.secrets);
    const reload = !!old && (loginChanged || old.server !== p.server || old.userAgent !== p.userAgent || old.kind !== p.kind);
    const same = !!old && !reload && old.name === p.name && old.sharedBy?.userId === p.by.userId && old.sharedBy?.name === p.by.name;
    if (same) continue;
    const keepGuide = !loginChanged && oldSecrets.playlistGuideUrl ? { playlistGuideUrl: oldSecrets.playlistGuideUrl } : {};
    const stays = !!old && !reload;
    upsert.push({
      record: {
        id,
        kind: p.kind,
        name: p.name,
        server: p.server,
        userAgent: p.userAgent,
        hasGuide: p.kind === 'xtream' || !!p.secrets.guideUrl || (stays && old.hasGuide),
        createdAt: p.createdAt,
        updatedAt: now,
        refreshedAt: stays ? old.refreshedAt : null,
        channelCount: stays ? old.channelCount : 0,
        sharedBy: p.by,
      },
      secrets: { ...p.secrets, ...keepGuide },
      reload,
    });
  }
  const remove = Object.values(records)
    .filter((r) => r.sharedBy && !wanted.has(r.id))
    .map((r) => r.id);
  return { upsert, remove };
}

/** The label of a shared provider. */
export const sharedLabel = (by: SharedBy) => `Shared by ${by.name}`;
