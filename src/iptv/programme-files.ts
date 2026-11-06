/**
 * Where a provider's programme index lives: the file, the ledger in MMKV and
 * the providers that have no file. `manager.ts` and `programme-manager.ts`
 * both use it, so it imports only the store, the files and the key-value
 * store (no import cycle). The ledger holds no secret.
 */
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { iptvFiles } from './files';
import type { IndexLedger } from './programme-index';
import { iptvState, setIptvState } from './store';

export const indexPath = (id: string) => `iptv/${id}/programmes.json`;
const ledgerKey = (id: string) => `iptv.progidx.${id}`;

/** Providers with no saved index file, so `ensureSlices` does not read again until a build or a drop. */
export const noFile = new Set<string>();

/** The saved ledger, or null when missing or of another shape (then the index is built again). */
export function readLedger(id: string): IndexLedger | null {
  const raw = readJson<unknown>(ledgerKey(id), null);
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const field = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { builtAt: field(r.builtAt), to: field(r.to), failedAt: field(r.failedAt) };
}

/** Saves the ledger, or removes it for null. */
export function writeLedger(id: string, ledger: IndexLedger | null): void {
  if (ledger) writeJson(ledgerKey(id), ledger);
  else storage.remove(ledgerKey(id));
}

/** Removes a provider's programme index: the file, the ledger and the slice. */
export async function dropProgrammeIndex(providerId: string): Promise<void> {
  writeLedger(providerId, null);
  noFile.delete(providerId);
  const slices = iptvState().programmeSlices;
  if (slices[providerId]) {
    const { [providerId]: _gone, ...rest } = slices;
    setIptvState({ programmeSlices: rest });
  }
  await iptvFiles.remove(indexPath(providerId)).catch(() => undefined);
}
