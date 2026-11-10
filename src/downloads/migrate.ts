/**
 * Migrations for saved download records. Every saved snapshot goes through
 * `migrateSnapshot` when the app starts; it never throws, and a record it
 * cannot read is dropped (its files are found again as orphans and removed).
 *
 * v1 (phase 1 stub): { schemaVersion: 1, itemId, serverId, title, state:
 *   'queued'|'downloading'|'paused'|'failed'|'done', bytesTotal, bytesDone,
 *   localPath, createdAt } in a flat list.
 * v2: records keyed by item id, plus collections. Every record is a Jellyfin item.
 * v3: see types.ts. Each record has a `source`: `{ kind: 'jellyfin' }` or an
 *   extension's media (`{ kind: 'extension', extId, mediaId, account, … }`).
 *   v2 → v3 sets `jellyfin` on every record. A v3 record with a damaged
 *   extension source cannot be listed or played, so it is dropped (its folder
 *   is then an orphan and is removed); a missing source on a Jellyfin id is
 *   read as `jellyfin`.
 */
import type { BaseItemDto } from '@/api/types';

import { DOWNLOAD_SCHEMA_VERSION, type DownloadCollection, type DownloadRecord, type DownloadSource, type DownloadsSnapshot, type ExtensionDownloadSource, type DownloadState } from './types';

export const EMPTY_SNAPSHOT: DownloadsSnapshot = { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: {}, collections: {} };

interface V1Record {
  schemaVersion: 1;
  itemId: string;
  serverId: string;
  title?: string;
  state?: string;
  bytesTotal?: number | null;
  bytesDone?: number;
  localPath?: string | null;
  createdAt?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const V1_STATES: Record<string, DownloadState> = {
  queued: 'queued',
  downloading: 'queued',
  paused: 'paused',
  failed: 'failed',
  done: 'completed',
};

/** A v1 path was absolute; v2 keeps paths relative to the document directory. */
export function relativeDir(path: string | null | undefined, itemId: string): { dir: string; file: string } {
  if (!path) return { dir: `downloads/${itemId}`, file: '' };
  const clean = path.replace(/^file:\/\//, '');
  const at = clean.indexOf('/downloads/');
  const rel = at >= 0 ? clean.slice(at + 1) : `downloads/${itemId}/${clean.split('/').pop() ?? ''}`;
  const parts = rel.split('/');
  const file = parts.pop() ?? '';
  return { dir: parts.join('/'), file };
}

function fromV1(v: V1Record, order: number): DownloadRecord | null {
  if (typeof v.itemId !== 'string' || !v.itemId || typeof v.serverId !== 'string') return null;
  const state = V1_STATES[v.state ?? ''] ?? 'failed';
  const { dir, file } = relativeDir(v.localPath, v.itemId);
  const created = v.createdAt ? Date.parse(v.createdAt) : NaN;
  const item: BaseItemDto = { Id: v.itemId, Name: v.title ?? 'Download', ServerId: v.serverId };
  return {
    schemaVersion: DOWNLOAD_SCHEMA_VERSION,
    itemId: v.itemId,
    source: JELLYFIN,
    serverId: v.serverId,
    userId: '',
    kind: 'video',
    item,
    group: { id: v.itemId, name: v.title ?? 'Download', type: 'Single' },
    sort: 0,
    // A completed v1 record without a file cannot play: download it again.
    state: state === 'completed' && !file ? 'failed' : state,
    bytesTotal: typeof v.bytesTotal === 'number' ? v.bytesTotal : null,
    bytesDone: typeof v.bytesDone === 'number' ? v.bytesDone : 0,
    speed: 0,
    progressAt: null,
    attempts: 0,
    retryAt: null,
    error: state === 'completed' && !file ? 'Download again' : null,
    dir,
    mediaFile: file,
    mediaSourceId: v.itemId,
    method: 'original',
    quality: 0,
    images: {},
    subtitles: [],
    hasLyrics: false,
    order,
    createdAt: Number.isFinite(created) ? created : 0,
    completedAt: state === 'completed' && Number.isFinite(created) ? created : null,
  };
}

const JELLYFIN: DownloadSource = { kind: 'jellyfin' };

/** The record versions this file reads as a whole record (v2 has no `source`). */
const RECORD_VERSIONS: readonly unknown[] = [2, DOWNLOAD_SCHEMA_VERSION];

function isRecordShape(v: unknown): v is Omit<DownloadRecord, 'schemaVersion' | 'source'> & { schemaVersion: number; source?: unknown } {
  return (
    isObject(v) &&
    RECORD_VERSIONS.includes(v.schemaVersion) &&
    typeof v.itemId === 'string' &&
    typeof v.state === 'string' &&
    typeof v.dir === 'string' &&
    isObject(v.item)
  );
}

const str = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * The source of a saved record. A v2 record, or a v3 record with no source
 * and a Jellyfin id, is `jellyfin`. An extension source needs its ids, its
 * account and its download URL; the display facts are read one by one and a
 * bad one is left out. Null: a damaged extension source.
 */
export function readSource(raw: unknown, itemId: string, version: unknown): DownloadSource | null {
  if (version === 2) return JELLYFIN;
  if (!isObject(raw)) return itemId.startsWith('ext:') ? null : JELLYFIN;
  if (raw.kind === 'jellyfin') return JELLYFIN;
  if (raw.kind !== 'extension') return null;
  const extId = str(raw.extId, 200);
  const mediaId = str(raw.mediaId, 200);
  const account = str(raw.account, 400);
  const download = str(raw.download);
  if (!extId || !mediaId || !account || !download) return null;
  const out: ExtensionDownloadSource = { kind: 'extension', extId, mediaId, account, download, title: str(raw.title, 400) ?? 'Download' };
  const option = str(raw.option, 200);
  if (option) out.option = option;
  const subtitle = str(raw.subtitle, 400);
  if (subtitle) out.subtitle = subtitle;
  const imageUrl = str(raw.imageUrl);
  if (imageUrl) out.imageUrl = imageUrl;
  const container = str(raw.container, 20);
  if (container) out.container = container;
  const label = str(raw.label, 200);
  if (label) out.label = label;
  const playback = str(raw.playback);
  if (playback) out.playback = playback;
  const duration = num(raw.duration);
  if (duration !== undefined) out.duration = duration;
  const bytes = num(raw.bytes);
  if (bytes !== undefined) out.bytes = bytes;
  const position = num(raw.position);
  if (position !== undefined) out.position = position;
  const report = isObject(raw.report) ? raw.report : null;
  const reportUrl = report ? str(report.url) : undefined;
  const interval = report ? num(report.intervalSeconds) : undefined;
  if (reportUrl && interval) out.report = { url: reportUrl, intervalSeconds: interval };
  return out;
}

function isCollection(v: unknown): v is DownloadCollection {
  return isObject(v) && typeof v.id === 'string' && Array.isArray(v.itemIds) && isObject(v.item);
}

/**
 * Any saved value to the current snapshot. Downloads that were running when
 * the app stopped go back to `queued`; the manager re-attaches them to the
 * native tasks, or starts them again.
 */
export function migrateSnapshot(raw: unknown): DownloadsSnapshot {
  // v1: a plain list of records.
  if (Array.isArray(raw)) {
    const records: Record<string, DownloadRecord> = {};
    raw.forEach((v, i) => {
      if (isObject(v) && v.schemaVersion === 1) {
        const r = fromV1(v as unknown as V1Record, i);
        if (r) records[r.itemId] = r;
      }
    });
    return { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections: {} };
  }
  if (!isObject(raw)) return EMPTY_SNAPSHOT;
  if (raw.schemaVersion === 1 && Array.isArray(raw.records)) return migrateSnapshot(raw.records);
  if (raw.schemaVersion !== 2 && raw.schemaVersion !== DOWNLOAD_SCHEMA_VERSION) {
    // A newer app wrote this (a downgrade). Keep nothing rather than misread it.
    return EMPTY_SNAPSHOT;
  }
  const records: Record<string, DownloadRecord> = {};
  for (const v of Object.values(isObject(raw.records) ? raw.records : {})) {
    try {
      if (!isRecordShape(v)) continue;
      const state: DownloadState = v.state === 'downloading' ? 'queued' : v.state === 'cancelled' ? 'cancelled' : v.state;
      if (state === 'cancelled') continue;
      // A v2 snapshot may hold a v2 record only; a v3 snapshot reads each record's own version.
      const source = readSource(v.source, v.itemId, raw.schemaVersion === 2 ? 2 : v.schemaVersion);
      if (!source) continue;
      records[v.itemId] = { ...v, schemaVersion: DOWNLOAD_SCHEMA_VERSION, source, state, speed: 0, progressAt: null };
    } catch {
      // One unreadable record never stops the others.
    }
  }
  const collections: Record<string, DownloadCollection> = {};
  for (const v of Object.values(isObject(raw.collections) ? raw.collections : {})) {
    if (isCollection(v)) collections[v.id] = v;
  }
  return { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections };
}
