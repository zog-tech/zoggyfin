/**
 * The app-level downloads interface. Screens use these hooks and actions and
 * never import the native downloader (it sits behind `engine.native.ts`).
 * On web and TV `supported` is false and the lists stay empty.
 *
 * Look up a download by Jellyfin item id: `findDownload(itemId)`; its file is
 * `localMediaUri(record, documentsDir)` (also `localFileFor(itemId)`).
 *
 * Extension media (an extension's `media.download`), for the signed-in account:
 *
 *   downloadExtensionMedia({ extension, mediaId, download, title, subtitle?, image?,
 *     duration?, option?, playback?, kind? }): Promise<{ ok: true } | { ok: false; error: string }>
 *     Queues the file. `extension` is the manifest id or the installed extension.
 *     Refuses (with a message, never a URL) when the `downloads` grant is off,
 *     on the plain web build and TV, for a URL off the extension's origin, and
 *     when the description has `options` and no `option` was passed.
 *   extensionDownloadOptions({ extension, download }):
 *     Promise<{ ok: true; options: DownloadOption[] } | { ok: false; error: string }>
 *     The choices to show first. Empty `options`: one file, no choice needed.
 *   extensionMediaState(records, extId, mediaId, account) / useExtensionDownload(extId, mediaId):
 *     ExtensionMediaState for a button: none, queued, downloading(progress),
 *     paused(progress), done, failed(error).
 *   extensionLocalPlay({ extension, mediaId, startSeconds? }): ExternalPlayRequest | null
 *     A completed download of the signed-in account, played from the device.
 *   removeExtensionDownloads(extId) / extensionDownloadCount(extId): for the remove flow.
 */
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { features } from '@/platform/tv';
import type { ExternalPlayRequest } from '@/player/types';

import { files } from './files';
import { fileUri, localImageUri, localMediaUri } from './local';
import { downloadManager, offerDownloadAgain } from './manager';
import { isDownloadable } from './plan';
import { downloadsState, statusOf, useDownloadsStore } from './store';
import { buildExtensionSections, buildLists, buildServerSections, type DownloadGroupView, type ExtensionSection, forServer, jellyfinOnly, onServer, type ServerSection, visibleTo } from './lists';
import { type DownloadOption, type ExtensionDownloadInput, extensionMediaState, type ExtensionMediaState, extensionRecordId, isExtensionRecord, localPlayRequest } from './extension-media';
import type { DownloadRecord, DownloadStatus } from './types';

export type { DownloadCollection, DownloadRecord, DownloadSource, DownloadState, DownloadStatus, ExtensionDownloadSource, LocalSubtitle } from './types';
export type { DownloadOption, ExtensionDownloadInput } from './extension-media';
export { extensionMediaState, type ExtensionMediaState, extensionRecordId, isExtensionRecord } from './extension-media';
export { DOWNLOAD_SCHEMA_VERSION } from './types';
export { buildExtensionSections, buildLists, buildServerSections, type DownloadGroupView, type ExtensionSection, onServer, type ServerSection, searchDownloads, visibleTo } from './lists';

export { DOWNLOAD_QUALITY_OPTIONS, isDownloadable } from './plan';
export { etaSeconds, fraction, isFileMissing } from './state-machine';
export { chooseMedia, fileUri, localImageUri, localMediaUri } from './local';
export { isNetworkError, serverOrLocal } from './fallback';

/** Reads a local text file (a downloaded subtitle or lyrics) by its local URI. */
export function readLocalText(uri: string): Promise<string | null> {
  return files.readUriText(uri);
}

/** True where downloads exist (iPhone, iPad, the desktop app). False on web and TV. */
export const downloadsSupported: boolean = features.downloads && downloadManager.supported;

export const downloads = {
  init: () => downloadManager.init(),
  download: (item: BaseItemDto) => downloadManager.download(item),
  pause: (id: string) => downloadManager.pause(id),
  resume: (id: string) => downloadManager.resume(id),
  retry: (id: string) => downloadManager.retry(id),
  cancel: (id: string) => downloadManager.cancel(id),
  remove: (id: string) => downloadManager.remove(id),
  removeGroup: (id: string) => downloadManager.removeGroup(id),
  pauseAll: () => downloadManager.pauseAll(),
  resumeAll: () => downloadManager.resumeAll(),
  move: (id: string, toIndex: number) => downloadManager.move(id, toIndex),
  downloadAgain: (ids: readonly string[]) => downloadManager.downloadAgain(ids),
};

/**
 * Before play: true when the downloaded files of these items are there.
 * A completed download whose file is gone becomes "not downloaded", and a
 * toast offers to download it again. The item then plays from the server.
 */
export async function checkDownloadedFiles(ids: readonly (string | null | undefined)[]): Promise<boolean> {
  const list = ids.filter((id): id is string => !!id && downloadsState().records[id]?.state === 'completed');
  if (!list.length || !downloadManager.supported) return true;
  const missing = await downloadManager.checkFiles(list);
  if (missing.length) offerDownloadAgain(missing);
  return missing.length === 0;
}

// ---- Lookups (synchronous, for the players) --------------------------------------

/** The download record for a Jellyfin item id, or null. */
export function findDownload(itemId: string | null | undefined): DownloadRecord | null {
  if (!itemId) return null;
  return downloadsState().records[itemId] ?? null;
}

/** The document directory as a file:// URI, once downloads started; null on web. */
export function documentsDir(): string | null {
  return downloadsState().documentsDir;
}

/** The local media file (file:// URI) of a completed download, or null. */
export function localFileFor(itemId: string | null | undefined): string | null {
  return localMediaUri(findDownload(itemId), downloadsState().documentsDir);
}

/** A file in a download's folder (subtitles, lyrics), as a file:// URI. */
export function localExtraUri(record: DownloadRecord, file: string): string | null {
  const dir = downloadsState().documentsDir;
  return dir ? fileUri(dir, `${record.dir}/${file}`) : null;
}

/** Completed downloads of a container (album, playlist, season), in their order; null when there are none. */
export function downloadedChildren(containerId: string | null | undefined): BaseItemDto[] | null {
  if (!containerId) return null;
  const s = downloadsState();
  const c = s.collections[containerId];
  // Item ids are unique across servers, so a container's downloads are found on any server.
  const list = c
    ? c.itemIds.map((id) => s.records[id])
    : Object.values(s.records)
        .filter((r) => r.group.id === containerId)
        .sort((a, b) => a.sort - b.sort);
  const items = list.filter((r): r is DownloadRecord => !!r && r.state === 'completed').map((r) => r.item);
  return items.length ? items : null;
}

/** The saved item (or container) facts, for pages that open with no server. */
export function downloadedItem(id: string): BaseItemDto | null {
  const s = downloadsState();
  return s.records[id]?.item ?? s.collections[id]?.item ?? null;
}

// ---- Hooks -----------------------------------------------------------------------

/** One item's or container's download state, for buttons and row badges. */
export function useDownloadStatus(id: string | null | undefined): DownloadStatus {
  return useDownloadsStore(useShallow((s) => (id && downloadsSupported ? statusOf(id, s) : ({ state: 'none' } as DownloadStatus))));
}

/** A local image for a downloaded item, or null. */
export function useLocalImage(id: string | null | undefined, variant: 'poster' | 'landscape' | 'square' | 'backdrop'): string | null {
  return useDownloadsStore((s) => {
    if (!id || !downloadsSupported) return null;
    const holder = s.records[id] ?? s.collections[id];
    return holder ? localImageUri(holder, s.documentsDir, variant) : null;
  });
}

/**
 * The Downloads tab lists: in progress (every server, queue order), and the
 * completed downloads of every server (`sections`: the active server first,
 * then by server, then by show or album). `groups` are the active server's
 * groups only. `extensions`: the signed-in account's extension downloads,
 * one section per extension; another account's are hidden (`lists.ts`).
 * `appBytes` counts every file on the device, for the storage bar.
 */
export function useDownloadLists(): {
  inProgress: DownloadRecord[];
  groups: DownloadGroupView[];
  sections: ServerSection[];
  extensions: ExtensionSection[];
  appBytes: number;
  activeCount: number;
} {
  const records = useDownloadsStore((s) => s.records);
  const collections = useDownloadsStore((s) => s.collections);
  const serverId = useSessionStore((s) => s.session?.serverId ?? null);
  const account = useSessionStore((s) => (s.session ? `${s.session.serverId}.${s.session.userId}` : null));
  return useMemo(() => {
    const appBytes = Object.values(records).reduce((n, r) => n + r.bytesDone, 0);
    const all = buildLists(visibleTo(records, account), collections);
    const jf = jellyfinOnly(records);
    const sections = buildServerSections(jf, collections, serverId);
    const groups = buildLists(forServer(jf, serverId), forServer(collections, serverId)).groups;
    const extensions = buildExtensionSections(records, account);
    return { inProgress: all.inProgress, activeCount: all.activeCount, appBytes, groups, sections, extensions };
  }, [records, collections, serverId, account]);
}

const groupItems = new Map<string, BaseItemDto>();

/** The item that stands for a show or album group, made from one of its downloads (cached, so it stays the same object). */
function groupItem(r: DownloadRecord): BaseItemDto {
  const hit = groupItems.get(r.group.id);
  if (hit) return hit;
  const item: BaseItemDto =
    r.group.type === 'MusicAlbum'
      ? { Id: r.group.id, Name: r.group.name, Type: 'MusicAlbum', AlbumArtist: r.item.AlbumArtist, ImageTags: r.item.AlbumPrimaryImageTag ? { Primary: r.item.AlbumPrimaryImageTag } : undefined }
      : r.group.type === 'Series'
        ? { Id: r.group.id, Name: r.group.name, Type: 'Series' }
        : r.item;
  groupItems.set(r.group.id, item);
  return item;
}

/** True when a download (by item id) is from a server that is not the active one. */
export function isOtherServerDownload(itemId: string | null | undefined): boolean {
  const s = downloadsState();
  const r = itemId ? (s.records[itemId] ?? s.collections[itemId]) : null;
  const active = useSessionStore.getState().session?.serverId;
  return !!r && !onServer(r, active);
}

/** The download record or collection of another server for this id, or null (reactive). */
export function useOtherServerDownload(id: string | null | undefined): { serverId: string; item: BaseItemDto } | null {
  const active = useSessionStore((s) => s.session?.serverId ?? null);
  return useDownloadsStore(
    useShallow((s) => {
      if (!id) return null;
      const r = s.records[id] ?? s.collections[id];
      if (r) return !onServer(r, active) ? { serverId: r.serverId, item: r.item } : null;
      // A show or album group with no collection record: its items name it.
      const child = Object.values(s.records).find((x) => x.group.id === id);
      if (!child || onServer(child, active)) return null;
      return { serverId: child.serverId, item: groupItem(child) };
    }),
  );
}

/** Deletes every download of a server (when the user removes the server). */
export async function removeServerDownloads(serverId: string): Promise<void> {
  for (const r of Object.values(downloadsState().records)) {
    if (r.serverId === serverId) await downloadManager.remove(r.itemId);
  }
}

/** Free and total bytes on the device, read again every 10 s while shown. Null on web. */
export function useDiskSpace(): { free: number; total: number } | null {
  const [tick, setTick] = useState(0);
  const bytes = useDownloadsStore((s) => Object.values(s.records).reduce((n, r) => n + r.bytesDone, 0));
  useEffect(() => {
    if (!downloadsSupported) return;
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (downloadsSupported ? files.diskSpace() : null), [bytes, tick]);
}

export function canDownload(item: BaseItemDto | undefined): boolean {
  return !!item && downloadsSupported && isDownloadable(item);
}

// ---- Extension media ---------------------------------------------------------------

function activeAccount(): string | null {
  const s = useSessionStore.getState().session;
  return s ? `${s.serverId}.${s.userId}` : null;
}

/** The download state of one extension media entry, for its button (re-renders once per percent at most). */
export function useExtensionDownload(extId: string | null | undefined, mediaId: string | null | undefined): ExtensionMediaState {
  const account = useSessionStore((s) => (s.session ? `${s.session.serverId}.${s.session.userId}` : null));
  return useDownloadsStore(
    useShallow((s) => (extId && mediaId && downloadsSupported ? extensionMediaState(s.records, extId, mediaId, account) : ({ state: 'none' } as ExtensionMediaState))),
  );
}

type ExtensionRef = string | { manifest: { id: string } };
const extIdOf = (e: ExtensionRef) => (typeof e === 'string' ? e : e.manifest.id);

/** A message with no URL or token in it. */
function messageOf(e: unknown, fallback: string): string {
  const text = e instanceof Error ? e.message : '';
  return text && !/https?:|\/\/|token/i.test(text) ? text : fallback;
}

/** Queues an extension's media entry for download (see the top of this file). */
export async function downloadExtensionMedia(
  req: Omit<ExtensionDownloadInput, 'extension'> & { extension: ExtensionRef },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await downloadManager.downloadExtension({ ...req, extension: extIdOf(req.extension) }, downloadsSupported);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e, 'The download could not start.') };
  }
}

/** The choices of an entry's download description (see the top of this file). */
export async function extensionDownloadOptions(req: { extension: ExtensionRef; download: string }): Promise<{ ok: true; options: DownloadOption[] } | { ok: false; error: string }> {
  try {
    return { ok: true, options: await downloadManager.extensionOptions(extIdOf(req.extension), req.download, downloadsSupported) };
  } catch (e) {
    return { ok: false, error: messageOf(e, 'The extension did not send a download.') };
  }
}

/**
 * The player's request for a completed extension download of the signed-in
 * account, from the device; null when there is none.
 */
export function extensionLocalPlay(req: { extension: string; mediaId: string; startSeconds?: number }): ExternalPlayRequest | null {
  const r = findDownload(extensionRecordId(req.extension, req.mediaId));
  const account = activeAccount();
  if (!r || !account || !isExtensionRecord(r) || r.source.account !== account || r.state !== 'completed') return null;
  // The extension wiring loads on first use, so a Jellyfin-only session never loads it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appMediaDeps, reportOutbox } = require('@/extensions/media/play') as typeof import('@/extensions/media/play');
  return localPlayRequest(
    r,
    downloadsState().documentsDir,
    {
      ...appMediaDeps,
      savePosition: (id, position) => downloadManager.saveExtensionPosition(id, position),
      queueReport: (acc, report) => reportOutbox.add(acc, report),
    },
    req.startSeconds,
  );
}

/** The number of downloads an extension made for the signed-in account (asked before it is removed). */
export function extensionDownloadCount(extId: string): number {
  const account = activeAccount();
  return Object.values(downloadsState().records).filter((r) => isExtensionRecord(r) && r.source.extId === extId && r.source.account === account).length;
}

/** Deletes the downloads an extension made for the signed-in account. */
export async function removeExtensionDownloads(extId: string): Promise<void> {
  const account = activeAccount();
  if (account) await downloadManager.removeExtensionDownloads(extId, account);
}
