/**
 * The state of the "Add to playlist" and rename sheets, as explicit phases.
 *
 * Add sheet: closed → choosing ⇄ naming → submitting → closed (success) or
 * back to choosing / naming (failure). Rename sheet: closed → editing →
 * saving → closed or editing.
 *
 * Each open takes a gate token (`@/lib/async-gate`). Close and a new open make
 * the old token stale. A request that ends late (the user pressed Cancel,
 * then opened the sheet for another item) does nothing: it must not close
 * the new sheet or end its submit. Only one submit runs per open, and the
 * check reads the store, not a render's closure.
 *
 * No React in this file, so it is unit-tested.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';
import { createGate } from '@/lib/async-gate';

export type AddPhase =
  | { name: 'closed' }
  | { name: 'choosing' | 'naming'; token: number; items: BaseItemDto[] }
  | { name: 'submitting'; token: number; items: BaseItemDto[]; target: string; back: 'choosing' | 'naming' };

export type RenamePhase =
  | { name: 'closed' }
  | { name: 'editing' | 'saving'; token: number; playlist: BaseItemDto };

interface SheetState {
  add: AddPhase;
  rename: RenamePhase;
}

const CLOSED = { name: 'closed' } as const;
const addGate = createGate();
const renameGate = createGate();

export const useSheets = create<SheetState>(() => ({ add: CLOSED, rename: CLOSED }));

/** Opens the add sheet for one item, a container, or several items (a queue). */
export function openAddToPlaylist(items: BaseItemDto | BaseItemDto[]): void {
  const list = (Array.isArray(items) ? items : [items]).filter((i) => i.Id);
  if (!list.length) return;
  useSheets.setState({ add: { name: 'choosing', token: addGate.begin(), items: list } });
}

export function closeAddSheet(): void {
  addGate.cancel();
  useSheets.setState({ add: CLOSED });
}

/** "New playlist": shows the name field. Not during a submit. */
export function startNaming(): void {
  const add = useSheets.getState().add;
  if (add.name === 'choosing') useSheets.setState({ add: { ...add, name: 'naming' } });
}

/**
 * Starts a submit for `target` (a playlist Id, or "new"). Returns the token
 * and the items, or null when the sheet is closed or a submit already runs.
 */
export function beginAdd(target: string): { token: number; items: BaseItemDto[] } | null {
  const add = useSheets.getState().add;
  if (add.name !== 'choosing' && add.name !== 'naming') return null;
  useSheets.setState({ add: { name: 'submitting', token: add.token, items: add.items, target, back: add.name } });
  return { token: add.token, items: add.items };
}

/**
 * Ends a submit. Returns false, and changes nothing, when the sheet was
 * closed or opened again since `beginAdd`. Success closes the sheet; a
 * failure goes back to the phase before the submit.
 */
export function endAdd(token: number, ok: boolean): boolean {
  const add = useSheets.getState().add;
  if (!addGate.current(token) || add.name !== 'submitting') return false;
  if (ok) closeAddSheet();
  else useSheets.setState({ add: { name: add.back, token: add.token, items: add.items } });
  return true;
}

export function openRenamePlaylist(playlist: BaseItemDto): void {
  useSheets.setState({ rename: { name: 'editing', token: renameGate.begin(), playlist } });
}

export function closeRenameSheet(): void {
  renameGate.cancel();
  useSheets.setState({ rename: CLOSED });
}

/** Starts a save. Null when the sheet is closed or a save already runs. */
export function beginRename(): { token: number; playlist: BaseItemDto } | null {
  const r = useSheets.getState().rename;
  if (r.name !== 'editing') return null;
  useSheets.setState({ rename: { ...r, name: 'saving' } });
  return { token: r.token, playlist: r.playlist };
}

/** Ends a save. Same rules as `endAdd`. */
export function endRename(token: number, ok: boolean): boolean {
  const r = useSheets.getState().rename;
  if (!renameGate.current(token) || r.name !== 'saving') return false;
  if (ok) closeRenameSheet();
  else useSheets.setState({ rename: { ...r, name: 'editing' } });
  return true;
}
