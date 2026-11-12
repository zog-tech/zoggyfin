/**
 * Download records. They are versioned from day one: `migrate.ts` turns any
 * older saved shape into the current one, so an app update never loses what
 * is on the device.
 */
import type { BaseItemDto } from '@/api/types';

export const DOWNLOAD_SCHEMA_VERSION = 3;

/**
 * queued → downloading → completed
 *            ↓  ↑
 *          paused        failed (retry with backoff) → queued
 * Any state that is not completed → cancelled (the record is then removed).
 * `preparing` (extension media only): the extension makes the file first;
 * the app asks again at `retryAt` (see `state-machine.ts`). It is saved as
 * `queued` with `retryAt` and `prepare` set (`storedRecords` in `migrate.ts`),
 * so an older app version reads a state it knows.
 */
export type DownloadState = 'queued' | 'preparing' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** An extension that makes the file first (`preparing`): since when, and how far (0..1) when it says. */
export interface PrepareInfo {
  /** Epoch ms of the first "preparing" reply; the wait has an upper bound from it. */
  since: number;
  /** 0..1, or null when the extension does not say. */
  progress: number | null;
}

export type MediaKind = 'video' | 'audio';

/** What the Downloaded list groups by: a show, an album, or a single item. */
export interface DownloadGroup {
  id: string;
  name: string;
  type: 'Series' | 'MusicAlbum' | 'Single';
}

export interface LocalSubtitle {
  index: number;
  label: string;
  language: string | null;
  isDefault: boolean;
  isForced: boolean;
  /** File name in the item folder (WebVTT). */
  file: string;
}

export interface LocalImages {
  /** File names in the item folder. */
  primary?: string;
  backdrop?: string;
}

/**
 * Where a download comes from (schema version 3). Every record before v3 is
 * a Jellyfin item; `migrate.ts` sets `jellyfin` on them.
 */
export type DownloadSource = JellyfinDownloadSource | ExtensionDownloadSource;

export interface JellyfinDownloadSource {
  kind: 'jellyfin';
}

/**
 * A file of an extension's media entry. The record id is
 * `ext:<extId>:<mediaId>` (`extensionRecordId`), so it never matches a
 * Jellyfin item id. The record's `serverId` and `userId` are the account
 * that made it; only that account lists, plays and continues it.
 */
export interface ExtensionDownloadSource {
  kind: 'extension';
  /** The extension's manifest id. */
  extId: string;
  /** `media.id` of the entry. */
  mediaId: string;
  /** The account that made the download (`serverId.userId`, `accountKey`). */
  account: string;
  /** `media.download`: the download description, a full URL on the extension's origin. */
  download: string;
  /** The chosen option id, when the description offers options. */
  option?: string;
  /** What the rows and the player show with no connection. */
  title: string;
  subtitle?: string;
  /** The entry's image on the extension's origin; the copy on the device is `images.primary`. */
  imageUrl?: string;
  /** Seconds. */
  duration?: number;
  /** The file's container (`mp4`), from the description. */
  container?: string;
  /** The size the description named, in bytes. */
  bytes?: number;
  /** The quality label of the description or of the chosen option (`720p`). */
  label?: string;
  /** `media.playback`, when known: the stream description that names the report URL. */
  playback?: string;
  /** Where progress reports go, learnt from the stream description when the file was saved. */
  report?: { url: string; intervalSeconds: number };
  /** Where the user stopped in the file, seconds. Kept on the device only. */
  position?: number;
}

/** One downloadable item: a movie, an episode, a song or an audiobook, or an extension's file. */
export interface DownloadRecord {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION;
  itemId: string;
  /** Jellyfin, or an extension's media (see `DownloadSource`). */
  source: DownloadSource;
  serverId: string;
  userId: string;
  kind: MediaKind;
  /** The slim item, so lists, search and the players work with no server. */
  item: BaseItemDto;
  group: DownloadGroup;
  /** Sort order inside the group (season * 10000 + episode, disc * 1000 + track). */
  sort: number;
  state: DownloadState;
  bytesTotal: number | null;
  bytesDone: number;
  /** Bytes per second, measured while downloading. */
  speed: number;
  /** Epoch ms of the last progress event (for the speed). */
  progressAt: number | null;
  /** Failed attempts in a row; the next retry waits longer each time. */
  attempts: number;
  /** Epoch ms when a failed download may start again by itself, or when a preparing one asks again. */
  retryAt: number | null;
  /** Set while the extension prepares the file (and kept until the file is named). */
  prepare?: PrepareInfo;
  error: string | null;
  /** Folder of this item, relative to the app's document directory. */
  dir: string;
  /** File name of the media inside `dir`, once known. */
  mediaFile: string;
  mediaSourceId: string;
  /** ETag or Last-Modified of the media response: a resume sends it as If-Range. */
  validator?: string | null;
  /** Direct play keeps the original file; transcode is a server copy at the download quality. */
  method: 'original' | 'transcode';
  /** The download quality that was chosen (0 = original). */
  quality: number;
  images: LocalImages;
  subtitles: LocalSubtitle[];
  hasLyrics: boolean;
  /** Queue order: lower starts first. */
  order: number;
  createdAt: number;
  completedAt: number | null;
}

/** A container the user downloaded as a whole (album, playlist, season, show). */
export interface DownloadCollection {
  id: string;
  serverId: string;
  type: string;
  name: string;
  item: BaseItemDto;
  itemIds: string[];
  images: LocalImages;
  dir: string;
  createdAt: number;
}

export interface DownloadsSnapshot {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION;
  records: Record<string, DownloadRecord>;
  collections: Record<string, DownloadCollection>;
}

/** What a row or a button shows for one item or container. */
export type DownloadStatus =
  | { state: 'none' }
  | { state: 'queued' | 'downloading' | 'paused'; progress: number }
  /** `missing`: it was downloaded, but the file is gone; a retry downloads it again. */
  | { state: 'failed'; progress: number; missing?: boolean }
  | { state: 'completed' };

/** Download quality: 0 is the original file; other values are a maximum video height. */
export type DownloadQuality = 0 | 1080 | 720 | 480;
