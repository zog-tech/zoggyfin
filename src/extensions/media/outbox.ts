/**
 * The extension report outbox: `stop` and `finished` reports of downloads
 * played with no connection wait here, and go to the extension when its
 * origin answers again. Other events of offline play are not kept.
 *
 * Rules:
 * - Saved under `extensions.reports` with a version (`OUTBOX_VERSION`).
 *   `readOutbox` reads any saved value and never throws; an entry it cannot
 *   read is dropped.
 * - Per account (`serverId.userId`): a report goes only with the headers of
 *   the account that played, so only that account sends it.
 * - Bounded: at most `MAX_PER_ACCOUNT` entries per account (the oldest go
 *   first) and `MAX_ACCOUNTS` accounts; an entry older than 30 days is dropped.
 * - Replay is oldest first. When an extension does not answer, its other
 *   entries wait (their order stays); other extensions still send.
 * - An answer with any status ends the entry: an error answer is not worth
 *   keeping. Only no answer (or a 5xx) keeps it.
 *
 * The rules are pure, so they are unit-tested; `createReportOutbox` adds the
 * storage and the sender.
 */
import { createSerialRunner } from '@/lib/async-gate';

import { FEED_TIMEOUT_MS, fetchWithTimeout } from '../http';
import { urlOnOrigin } from '../match';
import type { ReportBody } from './report';
import { type ExtensionMediaDeps, streamHeaders } from './source';

export const OUTBOX_KEY = 'extensions.reports';
export const OUTBOX_VERSION = 1;
export const MAX_PER_ACCOUNT = 100;
export const MAX_ACCOUNTS = 20;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReportEntry {
  extId: string;
  /** The report URL, on the extension's origin (checked again when it is sent). */
  url: string;
  body: ReportBody;
  /** Epoch ms when the report was made. */
  at: number;
}

export interface ReportOutbox {
  version: typeof OUTBOX_VERSION;
  accounts: Record<string, ReportEntry[]>;
}

export const EMPTY_OUTBOX: ReportOutbox = { version: OUTBOX_VERSION, accounts: {} };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readEntry(v: unknown): ReportEntry | null {
  if (!isObject(v) || !isObject(v.body)) return null;
  const { extId, url, at, body } = v;
  if (typeof extId !== 'string' || !extId || typeof url !== 'string' || !/^https?:\/\//i.test(url) || typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (typeof body.event !== 'string' || typeof body.mediaId !== 'string' || typeof body.position !== 'number') return null;
  return { extId, url, at, body: body as unknown as ReportBody };
}

/** Any saved value to the current outbox. Never throws. */
export function readOutbox(raw: unknown, now: number): ReportOutbox {
  try {
    if (!isObject(raw) || raw.version !== OUTBOX_VERSION || !isObject(raw.accounts)) return EMPTY_OUTBOX;
    const accounts: Record<string, ReportEntry[]> = {};
    for (const [key, list] of Object.entries(raw.accounts)) {
      if (!Array.isArray(list)) continue;
      const entries = list.map(readEntry).filter((e): e is ReportEntry => !!e);
      if (entries.length) accounts[key] = entries;
    }
    return prune({ version: OUTBOX_VERSION, accounts }, now);
  } catch {
    return EMPTY_OUTBOX;
  }
}

/** Drops old entries and keeps every list in time order and inside the bounds. */
export function prune(box: ReportOutbox, now: number): ReportOutbox {
  const accounts: Record<string, ReportEntry[]> = {};
  const kept = Object.entries(box.accounts)
    .map(([key, list]) => [key, list.filter((e) => now - e.at <= MAX_AGE_MS && e.at <= now + 60_000).sort((a, b) => a.at - b.at)] as const)
    .filter(([, list]) => list.length > 0)
    // The accounts with the newest reports stay.
    .sort((a, b) => b[1][b[1].length - 1]!.at - a[1][a[1].length - 1]!.at)
    .slice(0, MAX_ACCOUNTS);
  for (const [key, list] of kept) accounts[key] = list.slice(-MAX_PER_ACCOUNT);
  return { version: OUTBOX_VERSION, accounts };
}

/** The outbox with one more report for an account. */
export function addReport(box: ReportOutbox, account: string, entry: ReportEntry, now: number): ReportOutbox {
  return prune({ ...box, accounts: { ...box.accounts, [account]: [...(box.accounts[account] ?? []), entry] } }, now);
}

/** The reports of an account, oldest first. */
export function pendingReports(box: ReportOutbox, account: string): ReportEntry[] {
  return box.accounts[account] ?? [];
}

/** True when the extension answered (any status but 5xx), false when it did not. */
export type ReportSender = (entry: ReportEntry) => Promise<boolean>;

/**
 * Sends an account's reports, oldest first. Returns the reports that must
 * wait: the ones of extensions that did not answer, in their order.
 */
export async function replay(entries: readonly ReportEntry[], sendOne: ReportSender): Promise<ReportEntry[]> {
  const silent = new Set<string>();
  const left: ReportEntry[] = [];
  for (const e of entries) {
    if (silent.has(e.extId)) {
      left.push(e);
      continue;
    }
    let ok = false;
    try {
      ok = await sendOne(e);
    } catch {
      ok = false;
    }
    if (!ok) {
      silent.add(e.extId);
      left.push(e);
    }
  }
  return left;
}

/**
 * The app's sender: one POST to the report URL with the extension's headers
 * now. An extension that is gone or off, or a URL that left its origin,
 * counts as sent: there is nothing to keep it for.
 */
export function reportSender(deps: Pick<ExtensionMediaDeps, 'extension' | 'account' | 'context' | 'fetch'>): ReportSender {
  return async (entry) => {
    const ext = deps.extension(entry.extId);
    if (!ext || !ext.enabled) return true;
    const target = urlOnOrigin(ext.manifest.baseUrl, entry.url);
    if (!target) return true;
    const fetchFn = deps.fetch ?? fetchWithTimeout;
    try {
      const headers = { ...streamHeaders(ext.manifest, deps.context(ext), ext, deps.account()), 'Content-Type': 'application/json' };
      const res = await fetchFn(target, { method: 'POST', headers, body: JSON.stringify(entry.body) }, FEED_TIMEOUT_MS);
      return res.status < 500;
    } catch {
      return false;
    }
  };
}

export interface OutboxStorage {
  read(): unknown;
  write(value: ReportOutbox): void;
}

/**
 * The outbox with its storage. `flush()` sends the reports of the signed-in
 * account; one run at a time, and a call during a run gets one more run
 * after it (`createSerialRunner`).
 */
export function createReportOutbox(storage: OutboxStorage, deps: { account(): string | null; send: ReportSender }, clock: () => number = Date.now) {
  const load = () => readOutbox(storage.read(), clock());
  const same = (a: ReportEntry, b: ReportEntry) => a.at === b.at && a.extId === b.extId && a.body.mediaId === b.body.mediaId && a.body.event === b.body.event;
  const runner = createSerialRunner(async () => {
    const account = deps.account();
    if (!account) return;
    const entries = pendingReports(load(), account);
    if (!entries.length) return;
    // An account switch during the run: the rest waits for its own account
    // (the sender reads the signed-in account's extension and token).
    const left = await replay(entries, (e) => (deps.account() === account ? deps.send(e) : Promise.resolve(false)));
    const done = entries.filter((e) => !left.includes(e));
    // Read again: a report may have come in while this run sent.
    const cur = load();
    const keep = pendingReports(cur, account).filter((e) => !done.some((d) => same(d, e)));
    const accounts = { ...cur.accounts };
    if (keep.length) accounts[account] = keep;
    else delete accounts[account];
    storage.write(prune({ ...cur, accounts }, clock()));
  });
  return {
    add(account: string, entry: Omit<ReportEntry, 'at'> & { at?: number }): void {
      const now = clock();
      storage.write(addReport(load(), account, { ...entry, at: entry.at ?? now }, now));
    },
    pending(account: string): ReportEntry[] {
      return pendingReports(load(), account);
    },
    /** Sends what waits for the signed-in account. Never rejects. */
    flush(): Promise<void> {
      return runner.request().catch(() => undefined);
    },
  };
}
