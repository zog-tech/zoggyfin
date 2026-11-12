/**
 * The Downloads tab lists and the offline search. Pure, so they are unit-tested.
 *
 * Extension downloads (`source.kind === 'extension'`) follow the account
 * that made them: only that account sees them in progress and in its own
 * section per extension (`buildExtensionSections`). For another account they
 * are hidden, and their files stay on the device until that account comes
 * back (or removes the extension and agrees to delete them). They are never
 * in the server sections or the offline search, which open Jellyfin items.
 */
import type { BaseItemDto } from '@/api/types';

import type { DownloadCollection, DownloadRecord } from './types';

export interface DownloadGroupView {
  id: string;
  name: string;
  type: 'Series' | 'MusicAlbum' | 'Single' | 'Collection';
  /** The item to show for the group (the album, the show, or the single item). */
  item: BaseItemDto;
  records: DownloadRecord[];
  bytes: number;
  /** The server of the group's downloads. */
  serverId?: string;
}

export function buildLists(records: Record<string, DownloadRecord>, collections: Record<string, DownloadCollection>) {
  const all = Object.values(records);
  const inProgress = all.filter((r) => r.state !== 'completed' && r.state !== 'cancelled').sort((a, b) => a.order - b.order);
  const byGroup = new Map<string, DownloadGroupView>();
  for (const r of all) {
    if (r.state !== 'completed') continue;
    const g = byGroup.get(r.group.id);
    if (g) {
      g.records.push(r);
      g.bytes += r.bytesDone;
      continue;
    }
    const collection = collections[r.group.id];
    const item: BaseItemDto =
      collection?.item ??
      (r.group.type === 'MusicAlbum'
        ? { Id: r.group.id, Name: r.group.name, Type: 'MusicAlbum', AlbumArtist: r.item.AlbumArtist, ImageTags: r.item.AlbumPrimaryImageTag ? { Primary: r.item.AlbumPrimaryImageTag } : undefined }
        : r.group.type === 'Series'
          ? { Id: r.group.id, Name: r.group.name, Type: 'Series', ImageTags: r.item.SeriesPrimaryImageTag ? { Primary: r.item.SeriesPrimaryImageTag } : undefined }
          : r.item);
    byGroup.set(r.group.id, { id: r.group.id, name: collection?.name ?? r.group.name, type: r.group.type, item, records: [r], bytes: r.bytesDone });
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, records: g.records.sort((a, b) => a.sort - b.sort) }))
    .sort((a, b) => Math.max(...b.records.map((r) => r.completedAt ?? 0)) - Math.max(...a.records.map((r) => r.completedAt ?? 0)));
  const appBytes = all.reduce((n, r) => n + r.bytesDone, 0);
  const activeCount = inProgress.filter((r) => r.state === 'downloading' || r.state === 'queued' || r.state === 'preparing').length;
  return { inProgress, groups, appBytes, activeCount };
}

/**
 * True when a download belongs to the server. Records with no server Id
 * (from the first phase) count for every server.
 */
export function onServer(r: Pick<DownloadRecord, 'serverId'>, serverId: string | null | undefined): boolean {
  return !serverId || !r.serverId || r.serverId === serverId;
}

/** Only the records (and collections) of one server. Pure. */
export function forServer<T extends Pick<DownloadRecord, 'serverId'>>(all: Record<string, T>, serverId: string | null | undefined): Record<string, T> {
  if (!serverId) return all;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(all)) if (onServer(v, serverId)) out[k] = v;
  return out;
}

/** The completed downloads of one server, grouped by show, album or single item. */
export interface ServerSection {
  serverId: string;
  /** The active server. Records with no server Id (from the first phase) count for it. */
  active: boolean;
  groups: DownloadGroupView[];
  count: number;
  bytes: number;
}

/**
 * Every completed download on the device, by server: the active server
 * first, then the other servers, largest first. Inside a server, the groups
 * are the same as in `buildLists`. Pure.
 */
export function buildServerSections(
  records: Record<string, DownloadRecord>,
  collections: Record<string, DownloadCollection>,
  activeServerId: string | null | undefined,
): ServerSection[] {
  const ids = new Set<string>();
  for (const r of Object.values(records)) if (r.state === 'completed') ids.add(onServer(r, activeServerId) ? (activeServerId ?? r.serverId) : r.serverId);
  const sections: ServerSection[] = [];
  for (const id of ids) {
    const active = !!activeServerId && id === activeServerId;
    const mine = active ? forServer(records, id) : Object.fromEntries(Object.entries(records).filter(([, r]) => r.serverId === id));
    const cols = active ? forServer(collections, id) : Object.fromEntries(Object.entries(collections).filter(([, c]) => c.serverId === id));
    const { groups } = buildLists(mine, cols);
    if (!groups.length) continue;
    const tagged = groups.map((g) => ({ ...g, serverId: id }));
    sections.push({
      serverId: id,
      active,
      groups: tagged,
      count: tagged.reduce((n, g) => n + g.records.length, 0),
      bytes: tagged.reduce((n, g) => n + g.bytes, 0),
    });
  }
  return sections.sort((a, b) => (a.active === b.active ? b.bytes - a.bytes : a.active ? -1 : 1));
}

/** Downloaded items (from every server) that match a search term, grouped like server results. Pure. */
export function searchDownloads(records: Record<string, DownloadRecord>, term: string): BaseItemDto[] {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];
  return Object.values(records)
    .filter((r) => r.state === 'completed' && isJellyfinRecord(r))
    .filter((r) =>
      [r.item.Name, r.item.Album, r.item.AlbumArtist, r.item.SeriesName, ...(r.item.Artists ?? [])]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(t)),
    )
    .map((r) => r.item);
}


/** True for a Jellyfin item's download (every record before schema version 3). */
export function isJellyfinRecord(r: Pick<DownloadRecord, 'source'>): boolean {
  return r.source?.kind !== 'extension';
}

/** The records an account sees: every Jellyfin download, and the extension downloads it made. Pure. */
export function visibleTo(records: Record<string, DownloadRecord>, account: string | null | undefined): Record<string, DownloadRecord> {
  const out: Record<string, DownloadRecord> = {};
  for (const [k, r] of Object.entries(records)) {
    if (r.source?.kind !== 'extension' || (!!account && r.source.account === account)) out[k] = r;
  }
  return out;
}

/** Only the Jellyfin downloads. Pure. */
export function jellyfinOnly(records: Record<string, DownloadRecord>): Record<string, DownloadRecord> {
  const out: Record<string, DownloadRecord> = {};
  for (const [k, r] of Object.entries(records)) if (isJellyfinRecord(r)) out[k] = r;
  return out;
}

/** The completed downloads of one extension for the signed-in account. */
export interface ExtensionSection {
  extId: string;
  /** Newest first. */
  records: DownloadRecord[];
  count: number;
  bytes: number;
}

/**
 * The completed extension downloads of an account, one section per
 * extension, the most recent download first. Pure.
 */
export function buildExtensionSections(records: Record<string, DownloadRecord>, account: string | null | undefined): ExtensionSection[] {
  if (!account) return [];
  const by = new Map<string, ExtensionSection>();
  for (const r of Object.values(records)) {
    if (r.state !== 'completed' || r.source?.kind !== 'extension' || r.source.account !== account) continue;
    const id = r.source.extId;
    const sec = by.get(id) ?? { extId: id, records: [], count: 0, bytes: 0 };
    sec.records.push(r);
    sec.count++;
    sec.bytes += r.bytesDone;
    by.set(id, sec);
  }
  const newest = (sec: ExtensionSection) => Math.max(...sec.records.map((r) => r.completedAt ?? 0));
  return [...by.values()]
    .map((sec) => ({ ...sec, records: sec.records.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)) }))
    .sort((a, b) => newest(b) - newest(a));
}
