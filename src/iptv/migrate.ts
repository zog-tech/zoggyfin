/**
 * Reads saved IPTV data of any version into the current shape. It never
 * throws: a provider record it cannot read is dropped (its secrets and files
 * are cleaned up by the store), and a bad list becomes empty.
 *
 * v1: the shapes in types.ts (ProvidersSnapshot, ChannelLists, ChannelsFile,
 * GuideWindow). A later version adds its step here, with a test of the old shape.
 * ChannelLists v2: `snaps` of the favourite and recent channels (a v1 list
 * reads with none; they fill in when the provider's channels load).
 * ProvidersSnapshot: the optional `startWith` (no version change; older
 * snapshots have none).
 */
import { ALL_PROVIDERS } from './merged';
import {
  CHANNELS_SCHEMA_VERSION,
  type Channel,
  type ChannelLists,
  type ChannelSnap,
  type ChannelsFile,
  GUIDE_SCHEMA_VERSION,
  type GuideWindow,
  LISTS_SCHEMA_VERSION,
  type Programme,
  PROVIDERS_SCHEMA_VERSION,
  type ProviderRecord,
  type ProvidersSnapshot,
} from './types';

export const EMPTY_PROVIDERS: ProvidersSnapshot = { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers: {}, order: [] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function provider(id: string, v: unknown): ProviderRecord | null {
  if (!isObject(v)) return null;
  const kind = v.kind === 'xtream' || v.kind === 'm3u' ? v.kind : null;
  if (!kind) return null;
  const server = str(v.server);
  if (kind === 'xtream' && !server) return null;
  return {
    id,
    kind,
    name: str(v.name) ?? (kind === 'xtream' ? 'Xtream' : 'Playlist'),
    server: kind === 'xtream' ? server : null,
    userAgent: str(v.userAgent),
    hasGuide: kind === 'xtream' ? true : v.hasGuide === true,
    createdAt: num(v.createdAt, 0),
    updatedAt: num(v.updatedAt, 0),
    refreshedAt: typeof v.refreshedAt === 'number' ? v.refreshedAt : null,
    channelCount: num(v.channelCount, 0),
    ...sharedByOf(v.sharedBy),
  };
}

/** Who shared a provider, when it is a shared one. */
function sharedByOf(v: unknown): { sharedBy?: { userId: string; name: string } } {
  if (!isObject(v) || !str(v.userId)) return {};
  return { sharedBy: { userId: str(v.userId) as string, name: str(v.name) ?? 'an admin' } };
}

export function migrateProviders(raw: unknown): ProvidersSnapshot {
  if (!isObject(raw) || !isObject(raw.providers)) return EMPTY_PROVIDERS;
  // A snapshot from a newer app version: this version reads the fields it knows.
  const providers: Record<string, ProviderRecord> = {};
  for (const [id, v] of Object.entries(raw.providers)) {
    const p = provider(id, v);
    if (p) providers[id] = p;
  }
  const savedOrder = Array.isArray(raw.order) ? raw.order.filter((x): x is string => typeof x === 'string' && x in providers) : [];
  const order = [...new Set(savedOrder)];
  for (const id of Object.keys(providers)) if (!order.includes(id)) order.push(id);
  // What Live TV opens on: "All providers", a provider that still exists, or the last one used.
  const startWith = raw.startWith === ALL_PROVIDERS || (typeof raw.startWith === 'string' && raw.startWith in providers) ? raw.startWith : null;
  return { schemaVersion: PROVIDERS_SCHEMA_VERSION, providers, order, startWith };
}

/** A saved channel snap, or null. It never keeps fields that are not in the snap shape (no URLs). */
function snap(id: string, v: unknown): ChannelSnap | null {
  if (!isObject(v) || typeof v.name !== 'string') return null;
  const s: ChannelSnap = { id, name: v.name, group: typeof v.group === 'string' ? v.group : '' };
  if (typeof v.logo === 'string' && v.logo) s.logo = v.logo;
  if (typeof v.number === 'number' && Number.isFinite(v.number)) s.number = v.number;
  if (typeof v.epgId === 'string' && v.epgId) s.epgId = v.epgId;
  if (typeof v.streamId === 'number' && Number.isFinite(v.streamId)) s.streamId = v.streamId;
  return s;
}

/** v1 (ids only) and v2 (with snaps). A v1 list gets its snaps when the provider's channels load. */
export function migrateLists(raw: unknown): ChannelLists {
  if (!isObject(raw)) return { schemaVersion: LISTS_SCHEMA_VERSION, favourites: [], recents: [], snaps: {} };
  const favourites = Array.isArray(raw.favourites) ? [...new Set(raw.favourites.filter((x): x is string => typeof x === 'string'))] : [];
  const recents = Array.isArray(raw.recents)
    ? raw.recents
        .filter((r): r is { id: string; at: number } => isObject(r) && typeof r.id === 'string' && typeof r.at === 'number')
        .map((r) => ({ id: r.id, at: r.at }))
    : [];
  const snaps: Record<string, ChannelSnap> = {};
  if (isObject(raw.snaps)) {
    const listed = new Set([...favourites, ...recents.map((r) => r.id)]);
    for (const [id, v] of Object.entries(raw.snaps)) {
      const s = listed.has(id) ? snap(id, v) : null;
      if (s) snaps[id] = s;
    }
  }
  return { schemaVersion: LISTS_SCHEMA_VERSION, favourites, recents, snaps };
}

function channel(v: unknown): Channel | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  return { ...(v as unknown as Channel), group: typeof v.group === 'string' ? v.group : '' };
}

/** The channel cache file, or null when it is unreadable or from another provider (load the list again). */
export function migrateChannelsFile(raw: unknown, providerId: string): ChannelsFile | null {
  if (!isObject(raw) || raw.providerId !== providerId || !Array.isArray(raw.channels)) return null;
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > CHANNELS_SCHEMA_VERSION) return null;
  const channels: Channel[] = [];
  for (const c of raw.channels) {
    const ch = channel(c);
    if (ch) channels.push(ch);
  }
  return { schemaVersion: CHANNELS_SCHEMA_VERSION, providerId, savedAt: num(raw.savedAt, 0), channels };
}

function programme(v: unknown): Programme | null {
  if (!isObject(v) || typeof v.start !== 'number' || typeof v.stop !== 'number' || typeof v.title !== 'string') return null;
  const p: Programme = { start: v.start, stop: v.stop, title: v.title };
  if (typeof v.description === 'string') p.description = v.description;
  return p;
}

/** The saved guide window, or null when it is unreadable. */
export function migrateGuide(raw: unknown): GuideWindow | null {
  if (!isObject(raw) || !isObject(raw.channels)) return null;
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > GUIDE_SCHEMA_VERSION) return null;
  const channels: Record<string, Programme[]> = {};
  for (const [id, list] of Object.entries(raw.channels)) {
    if (!Array.isArray(list)) continue;
    channels[id] = list.map(programme).filter((p): p is Programme => p !== null);
  }
  return { schemaVersion: GUIDE_SCHEMA_VERSION, from: num(raw.from, 0), to: num(raw.to, 0), channels };
}
