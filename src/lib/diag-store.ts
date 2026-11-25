/**
 * Holds the player log (`diag-log.ts`) and saves it, so it survives an app
 * kill. It is on in every build. The log is written to the key-value store
 * at most every 2 s and when the app goes to the background, never on every
 * entry. `diag()` never throws: a log must not break the code it watches.
 *
 * The store comes in with `startDiagLog` (the app root), so this module
 * imports no native storage and the code it watches stays testable. Entries
 * from before the start stay in memory and join the saved log at the start.
 */
import { AppState } from 'react-native';

import type { KeyValueStore } from '@/storage/kv-types';

import { appendEntry, type DiagEntry, makeEntry, parseLog, serializeLog } from './diag-log';

export const DIAG_KEY = 'diag.log.v1';
const SAVE_DELAY_MS = 2000;

let entries: DiagEntry[] = [];
let store: KeyValueStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** Adds an entry. `data` holds only ids, kinds, counts, flags and times (see `diag-log.ts`). */
export function diag(area: string, event: string, data?: Record<string, unknown>): void {
  try {
    entries = appendEntry(entries, makeEntry(Date.now(), area, event, data));
    dirty = true;
    if (store && !saveTimer) saveTimer = setTimeout(flushDiag, SAVE_DELAY_MS);
  } catch {
    // Never break the caller.
  }
}

/** Writes the log now, when it changed. */
export function flushDiag(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !store) return;
  dirty = false;
  try {
    store.set(DIAG_KEY, serializeLog(entries));
  } catch {
    // Storage full or gone: the log stays in memory.
  }
}

/** The log, oldest first. */
export function diagEntries(): readonly DiagEntry[] {
  return entries;
}

/**
 * Loads the saved log into the store's memory, logs app state changes and
 * writes the log when the app leaves the foreground. Returns the stop function.
 */
export function startDiagLog(kv: KeyValueStore): () => void {
  if (!store) {
    store = kv;
    let saved: DiagEntry[] = [];
    try {
      saved = parseLog(kv.getString(DIAG_KEY));
    } catch {
      saved = [];
    }
    let merged = saved;
    for (const e of entries) merged = appendEntry(merged, e);
    entries = merged;
  }
  diag('app', 'start', { state: AppState.currentState ?? null });
  const sub = AppState.addEventListener('change', (state) => {
    diag('app', 'state', { state });
    if (state !== 'active') flushDiag();
  });
  return () => sub.remove();
}

/** Tests only: forget the log and the store. */
export function resetDiagForTests(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  entries = [];
  store = null;
  dirty = false;
}
