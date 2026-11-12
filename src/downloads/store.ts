/**
 * The downloads store: every record and collection, saved to MMKV. Screens
 * read it through the hooks in `index.ts`; only the manager writes it.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

import { EMPTY_SNAPSHOT, legacySnapshot, loadSnapshots, storedRecords } from './migrate';
import { fraction, isFileMissing } from './state-machine';
import {
  DOWNLOAD_SCHEMA_VERSION,
  type DownloadCollection,
  type DownloadRecord,
  type DownloadsSnapshot,
  type DownloadStatus,
} from './types';

/**
 * The old key: v1 and v2 snapshots, and now a v2 copy of the Jellyfin
 * records on every save, so an older app version (a rollback) keeps them.
 */
export const STORE_KEY = 'downloads.records';
/** The v3 snapshot with every record (Jellyfin and extension media). See `migrate.ts`. */
export const STORE_KEY_V3 = 'downloads.records.v3';

export interface DownloadsState {
  records: Record<string, DownloadRecord>;
  collections: Record<string, DownloadCollection>;
  /** The document directory (file:// URI), once the engine starts. */
  documentsDir: string | null;
}

function load(): DownloadsSnapshot {
  try {
    return loadSnapshots(readJson<unknown>(STORE_KEY, null), readJson<unknown>(STORE_KEY_V3, null));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

const initial = load();

export const useDownloadsStore = create<DownloadsState>(() => ({
  records: initial.records,
  collections: initial.collections,
  documentsDir: null,
}));

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveNow() {
  saveTimer = null;
  const { records, collections } = useDownloadsStore.getState();
  // `preparing` is saved as `queued` (see `storedRecords`).
  writeJson(STORE_KEY_V3, { schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: storedRecords(records), collections } satisfies DownloadsSnapshot);
  // The copy an older app version reads (see `migrate.ts`).
  writeJson(STORE_KEY, legacySnapshot({ records, collections }));
}

/** Saves at once for state changes, and at most every 2 s for progress. */
export function persist(soon = false): void {
  if (soon) {
    if (saveTimer) clearTimeout(saveTimer);
    saveNow();
    return;
  }
  if (!saveTimer) saveTimer = setTimeout(saveNow, 2000);
}

export function downloadsState(): DownloadsState {
  return useDownloadsStore.getState();
}

export function putRecord(r: DownloadRecord, soon = true): void {
  useDownloadsStore.setState((s) => ({ records: { ...s.records, [r.itemId]: r } }));
  persist(soon);
}

export function patchRecord(itemId: string, fn: (r: DownloadRecord) => DownloadRecord, soon = true): DownloadRecord | null {
  const cur = useDownloadsStore.getState().records[itemId];
  if (!cur) return null;
  const next = fn(cur);
  if (next === cur) return cur;
  putRecord(next, soon);
  return next;
}

export function dropRecord(itemId: string): void {
  useDownloadsStore.setState((s) => {
    const records = { ...s.records };
    delete records[itemId];
    // A collection keeps only the items that are still here.
    const collections: Record<string, DownloadCollection> = {};
    for (const c of Object.values(s.collections)) {
      const ids = c.itemIds.filter((id) => id !== itemId && records[id]);
      if (ids.length) collections[c.id] = ids.length === c.itemIds.length ? c : { ...c, itemIds: ids };
    }
    return { records, collections };
  });
  persist(true);
}

/**
 * The server answered with another id for an item (for example a catalog
 * song that the server saved to its library on the first request): the
 * record moves to the new id, in a new folder `dir`, with no partial bytes
 * (the caller removes the old folder). Collections that list the old id list
 * the new one. When a record of the new id is there already, the old record
 * is dropped and the existing one stays as it is. Pure.
 */
export function rekeySnapshot(
  s: Pick<DownloadsState, 'records' | 'collections'>,
  oldId: string,
  newId: string,
  dir: string,
): Pick<DownloadsState, 'records' | 'collections'> & { result: 'moved' | 'exists' | 'missing' } {
  const old = s.records[oldId];
  if (!old || !newId || oldId === newId) return { records: s.records, collections: s.collections, result: 'missing' };
  const cur = s.records[newId];
  const exists = !!cur && cur.state !== 'cancelled';
  const records = { ...s.records };
  delete records[oldId];
  if (!exists) {
    records[newId] = {
      ...old,
      itemId: newId,
      item: { ...old.item, Id: newId },
      group: old.group.type === 'Single' && old.group.id === oldId ? { ...old.group, id: newId } : old.group,
      dir,
      mediaSourceId: old.mediaSourceId === oldId ? newId : old.mediaSourceId,
      bytesDone: 0,
      bytesTotal: null,
      validator: null,
      speed: 0,
      progressAt: null,
    };
  }
  const collections: Record<string, DownloadCollection> = {};
  for (const c of Object.values(s.collections)) {
    collections[c.id] = c.itemIds.includes(oldId) ? { ...c, itemIds: [...new Set(c.itemIds.map((id) => (id === oldId ? newId : id)))] } : c;
  }
  return { records, collections, result: exists ? 'exists' : 'moved' };
}

/** `rekeySnapshot` on the store, saved at once. */
export function rekeyRecord(oldId: string, newId: string, dir: string): 'moved' | 'exists' | 'missing' {
  const { records, collections, result } = rekeySnapshot(useDownloadsStore.getState(), oldId, newId, dir);
  if (result === 'missing') return result;
  useDownloadsStore.setState({ records, collections });
  persist(true);
  return result;
}

export function putCollection(c: DownloadCollection): void {
  useDownloadsStore.setState((s) => ({ collections: { ...s.collections, [c.id]: c } }));
  persist(true);
}

export function dropCollection(id: string): void {
  useDownloadsStore.setState((s) => {
    const collections = { ...s.collections };
    delete collections[id];
    return { collections };
  });
  persist(true);
}

// ---- Status (pure, unit-tested) ------------------------------------------------

/** Rounded to whole percent, so rows re-render once per percent at most. */
function pct(f: number): number {
  return Math.round(f * 100) / 100;
}

export function recordStatus(r: DownloadRecord | undefined): DownloadStatus {
  if (!r || r.state === 'cancelled') return { state: 'none' };
  if (r.state === 'completed') return { state: 'completed' };
  if (isFileMissing(r)) return { state: 'failed', progress: 0, missing: true };
  // Only extension media prepares; a button shows it as waiting.
  if (r.state === 'preparing') return { state: 'queued', progress: 0 };
  return { state: r.state, progress: pct(fraction(r)) };
}

/** A container: done when every item is done; else the state of the busiest item and the byte progress. */
export function collectionStatus(c: DownloadCollection | undefined, records: Record<string, DownloadRecord>): DownloadStatus {
  if (!c) return { state: 'none' };
  const list = c.itemIds.map((id) => records[id]).filter((r): r is DownloadRecord => !!r && r.state !== 'cancelled');
  if (!list.length) return { state: 'none' };
  if (list.every((r) => r.state === 'completed')) return { state: 'completed' };
  const done = list.reduce((n, r) => n + (r.state === 'completed' ? 1 : fraction(r)), 0);
  const progress = pct(done / list.length);
  if (list.some((r) => r.state === 'downloading')) return { state: 'downloading', progress };
  if (list.some((r) => r.state === 'queued')) return { state: 'queued', progress };
  if (list.some((r) => r.state === 'failed')) return { state: 'failed', progress };
  return { state: 'paused', progress };
}

/** How many items of a container are on the device, of how many: "3 of 12" on the album's button. */
export interface CollectionCounts {
  done: number;
  total: number;
}

/** The counts of a container's downloads; null for an id that is not a downloaded container. Cancelled items do not count. */
export function collectionCounts(c: DownloadCollection | undefined, records: Record<string, DownloadRecord>): CollectionCounts | null {
  if (!c) return null;
  let done = 0;
  let total = 0;
  for (const id of c.itemIds) {
    const r = records[id];
    if (!r || r.state === 'cancelled') continue;
    total += 1;
    if (r.state === 'completed') done += 1;
  }
  return total ? { done, total } : null;
}

/** The status of any item id: a record, or a collection. */
export function statusOf(id: string, s: Pick<DownloadsState, 'records' | 'collections'>): DownloadStatus {
  const r = s.records[id];
  if (r) return recordStatus(r);
  return collectionStatus(s.collections[id], s.records);
}
