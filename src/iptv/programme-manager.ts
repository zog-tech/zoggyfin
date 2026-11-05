/**
 * The programme index in the background: about once a day it downloads each
 * provider's full XMLTV guide and keeps the next 48 hours of titles in a file
 * (`programme-index.ts`), so Live TV search finds programmes. Search reads
 * only a two-hour slice of it, held in the store.
 *
 * Rules:
 * - Never on the plain web (no lasting files).
 * - On a phone only on Wi-Fi or Ethernet: a full guide can be large. The Mac
 *   app and TV run on any network.
 * - One provider at a time, in the providers' order. `needsIndexRefresh`
 *   decides when a provider is due (and waits after a failure).
 * - A failure keeps the old file and slice.
 * - M3U: the same download also gives the guide window for now and next.
 * - Nothing here logs a URL or a login.
 */
import { AppState, Platform } from 'react-native';

import { isNativeTV } from '@/platform/tv';
import { networkSource } from '@/servers/network-source';
import type { NetworkSnapshot } from '@/servers/wifi-rule';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { IptvError, iptvErrorText } from './errors';
import { iptvFiles } from './files';
import { bindSession, ensureLoaded, guideKeepFor, guideWindowOptions, providerById, saveGuideResult, xtreamLogin } from './manager';
import { INDEX_BACK_MS, INDEX_KEEP_MS, type IndexLedger, migrateProgrammeIndex, needsIndexRefresh, type ProgrammeIndex, ProgrammeIndexBuilder, sliceIndex } from './programme-index';
import { readSecrets } from './secrets';
import { iptvState, setIptvState } from './store';
import { transport } from './transport';
import { MAX_LIST_BYTES } from './transport-types';
import { xtreamGuideUrl } from './xtream';
import { parseXmltv } from './xmltv';

const MINUTE = 60_000;
/** How much of the index the store holds for search. */
const SLICE_MS = 120 * MINUTE;
/** Load a new slice when the one in memory ends within this time. */
const SLICE_RENEW_MS = 30 * MINUTE;

const indexPath = (id: string) => `iptv/${id}/programmes.json`;
const ledgerKey = (id: string) => `iptv.progidx.${id}`;

/** The I/O the refresh depends on; tests replace it. */
export interface ProgrammeIndexDeps {
  /** True on an iPhone, iPad or Android phone or tablet (not TV, not the Mac app). */
  isPhone(): boolean;
  network(): Promise<NetworkSnapshot | null>;
  now(): number;
}

const realDeps: ProgrammeIndexDeps = {
  isPhone: () => (Platform.OS === 'ios' || Platform.OS === 'android') && !isNativeTV,
  network: () => networkSource.snapshot(),
  now: () => Date.now(),
};

let deps: ProgrammeIndexDeps = realDeps;

/** Replaces some of the I/O (tests). */
export function setProgrammeIndexDeps(patch: Partial<ProgrammeIndexDeps>): void {
  deps = { ...realDeps, ...patch };
}

/** False on the plain web: there the guide would live only in memory. */
export function programmeIndexEnabled(): boolean {
  return iptvFiles.persistent;
}

/** The saved ledger, or null when missing or of another shape (then the index is built again). */
function readLedger(id: string): IndexLedger | null {
  const raw = readJson<unknown>(ledgerKey(id), null);
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const field = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { builtAt: field(r.builtAt), to: field(r.to), failedAt: field(r.failedAt) };
}

function setSlice(id: string, index: ProgrammeIndex, now: number): void {
  const to = now + SLICE_MS;
  setIptvState({ programmeSlices: { ...iptvState().programmeSlices, [id]: { from: now, to, programmes: sliceIndex(index, now, to) } } });
}

async function networkAllows(): Promise<boolean> {
  if (!deps.isPhone()) return true;
  try {
    const net = await deps.network();
    return net?.type === 'wifi' || net?.type === 'ethernet';
  } catch {
    return false;
  }
}

/** The full guide address of a provider, or null when it has none. */
function guideUrlOf(id: string): string | null {
  const record = providerById(id);
  if (!record) return null;
  const secrets = readSecrets(id);
  if (record.kind === 'xtream') {
    const login = xtreamLogin(record, secrets);
    return login ? xtreamGuideUrl(login) : null;
  }
  return secrets.guideUrl ?? secrets.playlistGuideUrl ?? null;
}

async function buildOne(id: string, url: string, now: number): Promise<void> {
  const ledger = readLedger(id);
  try {
    await ensureLoaded(id);
    const record = providerById(id);
    if (!record) return;
    const { keep, matchNames } = guideKeepFor(iptvState().data[id]?.channels ?? []);
    const builder = new ProgrammeIndexBuilder(id, now - INDEX_BACK_MS, now + INDEX_KEEP_MS);
    const isM3u = record.kind === 'm3u';
    // M3U: the same parse fills the now-and-next window. Xtream: no window (it asks per channel).
    const window = isM3u ? guideWindowOptions(now) : { from: 0, to: 0, maxPerChannel: 0 };
    const r = await parseXmltv(transport.text(url, { userAgent: record.userAgent, maxBytes: MAX_LIST_BYTES }), { ...window, keep, matchNames, collect: builder });
    if (!r.looksLikeXmltv) throw new IptvError('notXmltv');
    const index = builder.build(now);
    if (!Object.keys(index.channels).length) throw new IptvError('empty');
    // The provider may have gone while the guide loaded.
    if (!providerById(id)) return;
    if (isM3u) await saveGuideResult(id, r, matchNames);
    await iptvFiles.write(indexPath(id), JSON.stringify(index));
    writeJson(ledgerKey(id), { builtAt: now, to: index.to, failedAt: null } satisfies IndexLedger);
    setSlice(id, index, now);
  } catch (e) {
    if (!providerById(id)) return;
    writeJson(ledgerKey(id), { builtAt: ledger?.builtAt ?? null, to: ledger?.to ?? null, failedAt: now } satisfies IndexLedger);
    console.warn('[iptv] programme index failed:', iptvErrorText(e));
  }
}

let running: Promise<void> | null = null;

/** Builds the index of each provider that is due, one after another. Skips everything when the device or network does not allow it. */
export function refreshDue(now?: number): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!programmeIndexEnabled()) return;
    bindSession();
    const at = now ?? deps.now();
    let allowed: boolean | null = null;
    for (const id of iptvState().providers.order.slice()) {
      if (!needsIndexRefresh(readLedger(id), at)) continue;
      const url = guideUrlOf(id);
      if (!url) continue;
      allowed ??= await networkAllows();
      if (!allowed) return;
      await buildOne(id, url, at);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Loads the saved index files into the store's two-hour slices, where one is missing or ends within 30 minutes. */
export async function ensureSlices(now?: number): Promise<void> {
  if (!programmeIndexEnabled()) return;
  const at = now ?? deps.now();
  for (const id of iptvState().providers.order.slice()) {
    const slice = iptvState().programmeSlices[id];
    if (slice && slice.from <= at && slice.to - at > SLICE_RENEW_MS) continue;
    const raw = await iptvFiles.read(indexPath(id));
    if (!raw) continue;
    let index: ProgrammeIndex | null = null;
    try {
      index = migrateProgrammeIndex(JSON.parse(raw));
    } catch {
      index = null;
    }
    if (index && providerById(id)) setSlice(id, index, at);
  }
}

/** Removes a provider's programme index: the file, the ledger and the slice. */
export async function dropProgrammeIndex(providerId: string): Promise<void> {
  storage.remove(ledgerKey(providerId));
  const slices = iptvState().programmeSlices;
  if (slices[providerId]) {
    const { [providerId]: _gone, ...rest } = slices;
    setIptvState({ programmeSlices: rest });
  }
  await iptvFiles.remove(indexPath(providerId)).catch(() => undefined);
}

let started = false;

/** Starts the background refresh: now, and each time the app comes to the front. Safe to call often. */
export function startProgrammeIndex(): void {
  if (started || !programmeIndexEnabled()) return;
  started = true;
  void refreshDue();
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void refreshDue();
  });
}
