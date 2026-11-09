/**
 * The state of the "Play on…" sheet, as explicit phases:
 * closed → choosing → starting → closed (success) or choosing (failure).
 *
 * Each open takes a gate token (`@/lib/async-gate`). Close and a new open
 * make the old token stale, so a play request that ends after Cancel never
 * closes a sheet opened since. Only one request runs per open.
 *
 * No React in this file, so it is unit-tested.
 */
import { create } from 'zustand';

import type { BaseItemDto } from '@/api/types';
import { createGate } from '@/lib/async-gate';

export type PlayOnPhase =
  | { name: 'closed' }
  | { name: 'choosing'; token: number; item: BaseItemDto }
  | { name: 'starting'; token: number; item: BaseItemDto; target: string };

const CLOSED = { name: 'closed' } as const;
const gate = createGate();

export const usePlayOn = create<{ phase: PlayOnPhase }>(() => ({ phase: CLOSED }));

export function openPlayOn(item: BaseItemDto): void {
  if (item.Id) usePlayOn.setState({ phase: { name: 'choosing', token: gate.begin(), item } });
}

export function closePlayOn(): void {
  gate.cancel();
  usePlayOn.setState({ phase: CLOSED });
}

/** Starts a request for the session `target`. Null when closed or one already runs. */
export function beginPlayOn(target: string): { token: number; item: BaseItemDto } | null {
  const p = usePlayOn.getState().phase;
  if (p.name !== 'choosing') return null;
  usePlayOn.setState({ phase: { name: 'starting', token: p.token, item: p.item, target } });
  return { token: p.token, item: p.item };
}

/**
 * Ends a request. Returns false, and changes nothing, when the sheet was
 * closed or opened again since `beginPlayOn`. Success closes the sheet.
 */
export function endPlayOn(token: number, ok: boolean): boolean {
  const p = usePlayOn.getState().phase;
  if (!gate.current(token) || p.name !== 'starting') return false;
  if (ok) closePlayOn();
  else usePlayOn.setState({ phase: { name: 'choosing', token: p.token, item: p.item } });
  return true;
}
