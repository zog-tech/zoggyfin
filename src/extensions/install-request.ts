/**
 * The state of the install confirm screen: which extensions it offers, which
 * are added, and the message after a failure.
 *
 * Rules:
 * - Each request takes a gate token (`@/lib/async-gate`). Cancel and a newer
 *   request make it stale, so a late load never brings a list back after
 *   Cancel or replaces a newer list.
 * - Confirm adds the extensions one by one. An extension that is added is
 *   marked done. When one fails, the screen keeps only the ones not added yet
 *   and says which were added and which failed. Confirm again adds the rest.
 * - Cancel during a confirm stops before the next extension.
 * - `source` says where the request came from: the user (an address or an
 *   invite) or the Jellyfin account (account sync offers extensions that
 *   another device added). The screen words its title and Cancel from it.
 *
 * The load and install steps come in as parameters, so this file is
 * unit-tested with no network and no router.
 */
import { create } from 'zustand';

import { createGate } from '@/lib/async-gate';

import type { Candidate } from './runtime';

export interface InstallEntry {
  input: string;
  candidate?: Candidate;
  error?: string;
  /** True once this extension is added. */
  done?: boolean;
}

/** Who asked: the user (an address, an invite, an update) or account sync. */
export type InstallSource = 'user' | 'account';

export interface InstallRequest {
  source: InstallSource;
  /** Addresses still loading or loaded. */
  entries: InstallEntry[];
  loading: boolean;
  installing: boolean;
  /** Set after a confirm that added only some of the extensions. */
  notice: string | null;
}

const EMPTY: InstallRequest = { source: 'user', entries: [], loading: false, installing: false, notice: null };
const gate = createGate();
let token = gate.begin();

export const useInstallRequest = create<InstallRequest>(() => EMPTY);

/** The extensions the screen still offers: loaded and not added yet. */
export function pendingCandidates(entries: readonly InstallEntry[]): Candidate[] {
  return entries.filter((e) => e.candidate && !e.done).map((e) => e.candidate as Candidate);
}

/** Starts a request: shows the addresses at once, then each loaded manifest or its error. */
export async function loadInstallRequest(inputs: readonly string[], load: (input: string) => Promise<Candidate>, source: InstallSource = 'user'): Promise<void> {
  const t = (token = gate.begin());
  useInstallRequest.setState({ ...EMPTY, source, entries: inputs.map((input) => ({ input })), loading: true });
  const entries = await Promise.all(
    inputs.map(async (input): Promise<InstallEntry> => {
      try {
        return { input, candidate: await load(input) };
      } catch (e) {
        return { input, error: e instanceof Error ? e.message : 'Cannot load this extension.' };
      }
    }),
  );
  if (!gate.current(t)) return;
  useInstallRequest.setState({ entries, loading: false });
}

/** Cancel or close: a late load or install of this request changes nothing. */
export function cancelInstallRequest(): void {
  gate.cancel();
  useInstallRequest.setState(EMPTY);
}

export type ConfirmResult =
  | { kind: 'done'; names: string[] }
  | { kind: 'partial'; added: string[]; failed: string; message: string }
  /** Nothing to do, a confirm already runs, or the request was cancelled. */
  | { kind: 'none' };

/** Adds every pending extension in order. Stops at the first failure. */
export async function confirmInstallRequest(installOne: (c: Candidate) => Promise<void>): Promise<ConfirmResult> {
  const t = token;
  const start = useInstallRequest.getState();
  if (!gate.current(t) || start.loading || start.installing) return { kind: 'none' };
  const pending = pendingCandidates(start.entries);
  if (!pending.length) return { kind: 'none' };
  useInstallRequest.setState({ installing: true, notice: null });
  const added: string[] = [];
  const markDone = (url: string) => {
    if (!gate.current(t)) return;
    const entries = useInstallRequest.getState().entries.map((e) => (e.candidate?.manifestUrl === url ? { ...e, done: true } : e));
    useInstallRequest.setState({ entries });
  };
  for (const cand of pending) {
    if (!gate.current(t)) return { kind: 'none' };
    try {
      await installOne(cand);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'The install failed.';
      const message = added.length
        ? `${added.join(', ')} ${added.length === 1 ? 'is' : 'are'} on. ${cand.manifest.name} could not be added: ${reason}`
        : `${cand.manifest.name} could not be added: ${reason}`;
      if (!gate.current(t)) return { kind: 'none' };
      useInstallRequest.setState({ installing: false, notice: message });
      return { kind: 'partial', added, failed: cand.manifest.name, message };
    }
    added.push(cand.manifest.name);
    markDone(cand.manifestUrl);
  }
  if (!gate.current(t)) return { kind: 'none' };
  useInstallRequest.setState({ installing: false });
  return { kind: 'done', names: added };
}
