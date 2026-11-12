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
 *
 * Preparing (extension media, inside v3): an optional `prepare` field
 *   (`{ since, progress }`). A record in `preparing` is saved as `queued`
 *   with `retryAt` and `prepare` set (`storedRecords`); a queued record has no
 *   `retryAt` otherwise, so the load reads it back as `preparing`. An older
 *   app version reads a plain queued record and asks the extension again.
 *
 * Downgrade safety (`store.ts`): an older app (v2) keeps nothing of a
 * snapshot whose version it does not know. So the v3 snapshot is saved
 * under its own key, and the old key keeps a v2 copy of the Jellyfin
 * records (`legacySnapshot`) on every save. After a rollback the older app
 * finds its Jellyfin downloads; when this version comes back, `loadSnapshots`
 * takes the Jellyfin records from the old key (the older app may have
 * changed them) and the extension records from the v3 key.
 */
import type { BaseItemDto } from '@/api/types';

import { DOWNLOAD_SCHEMA_VERSION, type DownloadCollection, type DownloadRecord, type DownloadSource, type DownloadsSnapshot, type ExtensionDownloadSource, type DownloadState, type PrepareInfo } from './types';

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

/** A saved `prepare` field, or undefined when it is missing or damaged. */
export function readPrepare(raw: unknown): PrepareInfo | undefined {
  if (!isObject(raw)) return undefined;
  const since = num(raw.since);
  if (since === undefined) return undefined;
  const p = raw.progress;
  return { since, progress: typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null };
}

/**
 * The records as they are saved: `preparing` becomes `queued` (with
 * `retryAt` and `prepare` kept), a state every app version knows. Pure.
 */
export function storedRecords(records: Record<string, DownloadRecord>): Record<string, DownloadRecord> {
  if (!Object.values(records).some((r) => r.state === 'preparing')) return records;
  const out: Record<string, DownloadRecord> = {};
  for (const [id, r] of Object.entries(records)) out[id] = r.state === 'preparing' ? { ...r, state: 'queued', retryAt: r.retryAt ?? 0 } : r;
  return out;
}

/** The state of a saved record: a running one goes back to the queue; a saved wait is `preparing` again. */
function loadedState(v: { state: string; retryAt?: unknown }, prepare: PrepareInfo | undefined): DownloadState {
  if (v.state === 'downloading') return 'queued';
  if ((v.state === 'queued' || v.state === 'preparing') && prepare && typeof v.retryAt === 'number') return 'preparing';
  if (v.state === 'preparing') return 'queued';
  return v.state as DownloadState;
}

function isCollection(v: unknown): v is DownloadCollection {
  return isObject(v) && typeof v.id === 'string' && Array.isArray(v.itemIds) && isObject(v.item);
}

/** The schema version an older app reads (`legacySnapshot`). */
export const LEGACY_SCHEMA_VERSION = 2;

/** A saved value that one of the known versions wrote (v1 list, v1, v2 or v3 snapshot). */
function isKnownSnapshot(raw: unknown): boolean {
  if (Array.isArray(raw)) return true;
  return isObject(raw) && (raw.schemaVersion === 1 || raw.schemaVersion === 2 || raw.schemaVersion === DOWNLOAD_SCHEMA_VERSION);
}

const isJellyfin = (r: DownloadRecord) => r.source.kind === 'jellyfin';

/**
 * The v2 copy of a snapshot for the old key: the Jellyfin records with
 * `schemaVersion: 2` and no `source`, as a v2 app reads them, and the
 * collections (they hold Jellyfin items only). Pure.
 */
export function legacySnapshot(s: Pick<DownloadsSnapshot, 'records' | 'collections'>): { schemaVersion: typeof LEGACY_SCHEMA_VERSION; records: Record<string, unknown>; collections: Record<string, DownloadCollection> } {
  const records: Record<string, unknown> = {};
  for (const r of Object.values(s.records)) {
    if (!isJellyfin(r)) continue;
    const { source: _source, ...rest } = r;
    records[r.itemId] = { ...rest, schemaVersion: LEGACY_SCHEMA_VERSION };
  }
  const collections: Record<string, DownloadCollection> = {};
  for (const c of Object.values(s.collections)) {
    const itemIds = c.itemIds.filter((id) => !!records[id] || !s.records[id]);
    if (itemIds.length) collections[c.id] = itemIds.length === c.itemIds.length ? c : { ...c, itemIds };
  }
  return { schemaVersion: LEGACY_SCHEMA_VERSION, records, collections };
}

/**
 * The snapshot from both keys (see the top of this file). `legacyRaw` is the
 * old key, `currentRaw` the v3 key; either may be missing (null). The old
 * key is the truth for Jellyfin records and collections whenever a known
 * version wrote it; the v3 key adds the extension records. Never throws.
 */
export function loadSnapshots(legacyRaw: unknown, currentRaw: unknown): DownloadsSnapshot {
  try {
    const current = currentRaw == null ? null : migrateSnapshot(currentRaw);
    const legacy = isKnownSnapshot(legacyRaw) ? migrateSnapshot(legacyRaw) : null;
    if (!legacy) return current ?? EMPTY_SNAPSHOT;
    // The first start of this version: the old key holds everything (v1, v2, or an early v3).
    if (!current) return legacy;
    const records: Record<string, DownloadRecord> = {};
    for (const r of Object.values(legacy.records)) if (isJellyfin(r)) records[r.itemId] = r;
    for (const r of Object.values(current.records)) if (!isJellyfin(r) && !records[r.itemId]) records[r.itemId] = r;
    return { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records, collections: legacy.collections };
  } catch {
    return EMPTY_SNAPSHOT;
  }
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
      // A wait for the extension belongs to extension media only.
      const prepare = v.itemId.startsWith('ext:') ? readPrepare(v.prepare) : undefined;
      const state = loadedState(v, prepare);
      if (state === 'cancelled') continue;
      // A v2 snapshot may hold a v2 record only; a v3 snapshot reads each record's own version.
      const source = readSource(v.source, v.itemId, raw.schemaVersion === 2 ? 2 : v.schemaVersion);
      if (!source) continue;
      const { prepare: _raw, ...rest } = v;
      const record: DownloadRecord = { ...rest, schemaVersion: DOWNLOAD_SCHEMA_VERSION, source, state, speed: 0, progressAt: null };
      if (prepare) record.prepare = prepare;
      records[v.itemId] = record;
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
