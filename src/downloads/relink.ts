/**
 * Moves downloads to a server that came back with a new Id (a reinstall).
 * Item Ids change on a new install, so each download is matched to an item
 * of the new server: by provider ids (Tmdb, Imdb, Tvdb, MusicBrainz) first,
 * then by file path, then by name, year and type. Pure and unit-tested; the
 * caller fetches the items and writes the result.
 */
import type { BaseItemDto } from '@/api/types';

import { keyOf, type OutboxEntry } from './outbox';
import type { DownloadCollection, DownloadRecord } from './types';

export type MatchLevel = 'provider' | 'path' | 'name';

/** The provider ids that name one item (not an album or a series). */
const PROVIDERS = ['tmdb', 'imdb', 'tvdb', 'musicbrainztrack', 'musicbrainzrecording'];

function providerKeys(item: BaseItemDto): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(item.ProviderIds ?? {})) {
    if (v && PROVIDERS.includes(k.toLowerCase())) out.push(`${item.Type}|${k.toLowerCase()}|${String(v).trim().toLowerCase()}`);
  }
  return out;
}

function pathKey(item: BaseItemDto): string | null {
  return item.Path ? `${item.Type}|${item.Path.trim()}` : null;
}

function nameKey(item: BaseItemDto): string | null {
  if (!item.Name || !item.Type) return null;
  const n = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  return [item.Type, n(item.Name), item.ProductionYear ?? '', n(item.SeriesName), item.ParentIndexNumber ?? '', item.IndexNumber ?? '', n(item.Album)].join('|');
}

/** Maps from each key to the one item that has it. A key that two items share matches nothing. */
export interface MatchIndex {
  provider: Map<string, string | null>;
  path: Map<string, string | null>;
  name: Map<string, string | null>;
  items: Map<string, BaseItemDto>;
}

function put(m: Map<string, string | null>, key: string | null, id: string): void {
  if (!key) return;
  const cur = m.get(key);
  m.set(key, cur === undefined || cur === id ? id : null);
}

export function buildIndex(candidates: readonly BaseItemDto[]): MatchIndex {
  const idx: MatchIndex = { provider: new Map(), path: new Map(), name: new Map(), items: new Map() };
  for (const c of candidates) {
    if (!c.Id) continue;
    idx.items.set(c.Id, c);
    for (const k of providerKeys(c)) put(idx.provider, k, c.Id);
    put(idx.path, pathKey(c), c.Id);
    put(idx.name, nameKey(c), c.Id);
  }
  return idx;
}

export function matchItem(old: BaseItemDto, idx: MatchIndex): { id: string; level: MatchLevel } | null {
  for (const k of providerKeys(old)) {
    const id = idx.provider.get(k);
    if (id) return { id, level: 'provider' };
  }
  const p = pathKey(old);
  const byPath = p ? idx.path.get(p) : null;
  if (byPath) return { id: byPath, level: 'path' };
  const n = nameKey(old);
  const byName = n ? idx.name.get(n) : null;
  return byName ? { id: byName, level: 'name' } : null;
}

export interface RelinkResult {
  records: Record<string, DownloadRecord>;
  collections: Record<string, DownloadCollection>;
  /** Old item Id → new item Id, for the downloads that moved. */
  moved: Record<string, string>;
  /** Downloads of the old server. */
  total: number;
}

/**
 * Moves each download of `oldServerId` that matches to the new server and
 * user. A download that does not match stays as it is, under the old server.
 * The files stay where they are.
 */
export function relinkDownloads(
  records: Record<string, DownloadRecord>,
  collections: Record<string, DownloadCollection>,
  idx: MatchIndex,
  from: { serverId: string },
  to: { serverId: string; userId: string },
): RelinkResult {
  const out: Record<string, DownloadRecord> = {};
  const moved: Record<string, string> = {};
  /** Old group (series, album) Id → new one, learnt from the matched items. */
  const groups: Record<string, string> = {};
  let total = 0;
  for (const r of Object.values(records)) {
    // An extension's download is not a Jellyfin item: it never matches one by name.
    if (r.serverId !== from.serverId || r.source?.kind === 'extension') {
      out[r.itemId] = r;
      continue;
    }
    total++;
    const m = matchItem(r.item, idx);
    if (!m || (records[m.id] && records[m.id].serverId !== from.serverId)) {
      out[r.itemId] = r;
      continue;
    }
    const fresh = idx.items.get(m.id);
    const newGroup = r.group.type === 'Series' ? fresh?.SeriesId : r.group.type === 'MusicAlbum' ? fresh?.AlbumId : m.id;
    if (newGroup) groups[r.group.id] = newGroup;
    moved[r.itemId] = m.id;
    out[m.id] = {
      ...r,
      itemId: m.id,
      serverId: to.serverId,
      userId: to.userId,
      item: {
        ...r.item,
        Id: m.id,
        ServerId: to.serverId,
        SeriesId: fresh?.SeriesId ?? r.item.SeriesId,
        SeasonId: fresh?.SeasonId ?? r.item.SeasonId,
        AlbumId: fresh?.AlbumId ?? r.item.AlbumId,
        ParentId: fresh?.ParentId ?? r.item.ParentId,
      },
      group: { ...r.group, id: groups[r.group.id] ?? r.group.id },
    };
  }
  const cols: Record<string, DownloadCollection> = {};
  for (const c of Object.values(collections)) {
    if (c.serverId !== from.serverId) {
      cols[c.id] = c;
      continue;
    }
    const stay = c.itemIds.filter((id) => !moved[id]);
    const go = c.itemIds.filter((id) => moved[id]).map((id) => moved[id]);
    if (stay.length) cols[c.id] = { ...c, itemIds: stay };
    if (go.length) {
      const id = groups[c.id] ?? (stay.length ? `${c.id}~${to.serverId}` : c.id);
      cols[id] = { ...c, id, serverId: to.serverId, itemIds: go, item: { ...c.item, Id: groups[c.id] ?? c.item.Id, ServerId: to.serverId } };
    }
  }
  return { records: out, collections: cols, moved, total };
}

/**
 * Moves the waiting playback reports of the moved items to the new server
 * and user. Reports of items that did not move keep the old server Id, so
 * they never go to the new server.
 */
export function remapOutbox(entries: readonly OutboxEntry[], oldServerId: string, moved: Record<string, string>, to: { serverId: string; userId: string }): OutboxEntry[] {
  const out = new Map<string, OutboxEntry>();
  for (const e of entries) {
    const id = e.serverId === oldServerId ? moved[e.itemId] : undefined;
    const next = id ? { ...e, serverId: to.serverId, userId: to.userId, itemId: id } : e;
    const k = keyOf(next);
    const cur = out.get(k);
    if (!cur || next.at > cur.at) out.set(k, next);
  }
  return [...out.values()];
}
