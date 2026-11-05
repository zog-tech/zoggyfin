/**
 * The programme index in the background: about once a day it downloads each
 * provider's full XMLTV guide and keeps the next 48 hours of titles in a file
 * (`programme-index.ts`), so Live TV search finds programmes. Search reads
 * only a three-hour slice of it, held in the store.
 *
 * Rules:
 * - Never on the plain web (no lasting files).
 * - On a phone only on Wi-Fi or Ethernet: a full guide can be large. The Mac
 *   app and TV run on any network.
 * - One provider at a time, in the providers' order. `needsIndexRefresh`
 *   decides when a provider is due (and waits after a failure, and 20 hours
 *   after a good build).
 * - A build writes an attempt marker (`failedAt`) before the download, so a
 *   kill during the download or the parse counts as a failure: the panel is
 *   not asked again at every start.
 * - Never during the app start: the first run waits about 45 seconds and
 *   for an idle moment. The work after the parse yields to the event loop.
 * - A failure keeps the old file and slice.
 * - M3U: the same download also gives the guide window for now and next.
 * - Nothing here logs a URL or a login.
 */
import { AppState, Platform } from 'react-native';

import { useSessionStore } from '@/auth/session-store';
import { isNativeTV } from '@/platform/tv';
import { networkSource } from '@/servers/network-source';
import type { NetworkSnapshot } from '@/servers/wifi-rule';

import { IptvError, iptvErrorText } from './errors';
import { iptvFiles } from './files';
import { bindSession, channelsWhenLoaded, guideKeepFor, guideWindowOptions, providerById, saveGuideResult, xtreamLogin } from './manager';
import { indexPath, noFile, readLedger, writeLedger } from './programme-files';
import { INDEX_BACK_MS, INDEX_KEEP_MS, type IndexLedger, migrateProgrammeIndex, needsIndexRefresh, type ProgrammeIndex, ProgrammeIndexBuilder, sliceIndex } from './programme-index';
import { ON_NOW_AHEAD_MS } from './programme-search';
import { readSecrets } from './secrets';
import { iptvState, type LoadStatus, setIptvState, useIptvStore } from './store';
import { transport } from './transport';
import { MAX_LIST_BYTES } from './transport-types';
import { xtreamGuideUrl } from './xtream';
import { parseXmltv } from './xmltv';

export { dropProgrammeIndex } from './programme-files';

const MINUTE = 60_000;
/** How much of the index the store holds for search. */
export const SLICE_MS = 180 * MINUTE;
/**
 * Load a new slice when the one in memory ends within this time. It is more
 * than the search look-ahead, so a programme that starts within the hour is
 * always in the slice.
 */
export const SLICE_RENEW_MS = ON_NOW_AHEAD_MS + 10 * MINUTE;
/** The first background run waits this long after the app starts. */
export const LAUNCH_DELAY_MS = 45_000;

/** The I/O the refresh depends on; tests replace it. */
export interface ProgrammeIndexDeps {
  /** True on an iPhone, iPad or Android phone or tablet (not TV, not the Mac app). */
  isPhone(): boolean;
  network(): Promise<NetworkSnapshot | null>;
  now(): number;
  /** Runs `run` after `ms`, at an idle moment. */
  schedule(ms: number, run: () => void): void;
  /** Gives the event loop a turn (a macrotask), so a long step does not block input. */
  yieldNow(): Promise<void>;
}

type IdleCallback = (run: () => void, options?: { timeout: number }) => unknown;

/** `requestIdleCallback` where the runtime has it (React Native, browsers), else at once. */
function whenIdle(run: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: IdleCallback }).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 10_000 });
  else run();
}

const realDeps: ProgrammeIndexDeps = {
  isPhone: () => (Platform.OS === 'ios' || Platform.OS === 'android') && !isNativeTV,
  network: () => networkSource.snapshot(),
  now: () => Date.now(),
  schedule: (ms, run) => void setTimeout(() => whenIdle(run), ms),
  yieldNow: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

let deps: ProgrammeIndexDeps = realDeps;
/** True while a `refreshSoon` run waits. */
let scheduled = false;

/** Replaces some of the I/O (tests). Also forgets a scheduled run. */
export function setProgrammeIndexDeps(patch: Partial<ProgrammeIndexDeps>): void {
  deps = { ...realDeps, ...patch };
  scheduled = false;
}

/** False on the plain web: there the guide would live only in memory. */
export function programmeIndexEnabled(): boolean {
  return iptvFiles.persistent;
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

function setGuideStatus(id: string, status: LoadStatus): void {
  setIptvState({ guideStatus: { ...iptvState().guideStatus, [id]: status } });
}

const sameLedger = (a: IndexLedger | null, b: IndexLedger | null) =>
  a === b || (!!a && !!b && a.builtAt === b.builtAt && a.to === b.to && a.failedAt === b.failedAt);

async function buildOne(id: string, url: string, now: number): Promise<void> {
  const ledger = readLedger(id);
  const isM3u = providerById(id)?.kind === 'm3u';
  // M3U: mark the guide as loading first, so `loadGuide` (from `ensureLoaded`) does not download it a second time.
  const before = iptvState().guideStatus[id];
  if (isM3u) setGuideStatus(id, 'loading');
  // A changed login or guide address during the download: the result is of the old one.
  const current = () => !!providerById(id) && guideUrlOf(id) === url;
  let marker: IndexLedger | null = null;
  let ok = false;
  try {
    // Wait for a channel list another caller is loading. With no channels there is nothing to link a guide to:
    // skip this provider without a failure (the next run tries again), never keep the whole guide.
    const channels = await channelsWhenLoaded(id);
    const record = providerById(id);
    if (!record || !channels.length || !current()) return;
    const { keep, matchNames } = guideKeepFor(channels);
    if (!keep) return;
    // The attempt marker: a kill from here on counts as a failure, so the next start does not download again.
    marker = { builtAt: ledger?.builtAt ?? null, to: ledger?.to ?? null, failedAt: now };
    writeLedger(id, marker);
    const builder = new ProgrammeIndexBuilder(id, now - INDEX_BACK_MS, now + INDEX_KEEP_MS);
    // M3U: the same parse fills the now-and-next window. Xtream: no window (it asks per channel).
    const window = isM3u ? guideWindowOptions(now) : { from: 0, to: 0, maxPerChannel: 0 };
    const r = await parseXmltv(transport.text(url, { userAgent: record.userAgent, maxBytes: MAX_LIST_BYTES }), { ...window, keep, matchNames, collect: builder });
    if (!r.looksLikeXmltv) throw new IptvError('notXmltv');
    await deps.yieldNow();
    const index = builder.build(now);
    if (!Object.keys(index.channels).length) throw new IptvError('empty');
    await deps.yieldNow();
    if (!current()) return;
    const text = JSON.stringify(index);
    await deps.yieldNow();
    if (!current()) return;
    ok = true;
    if (isM3u) await saveGuideResult(id, r, matchNames);
    await iptvFiles.write(indexPath(id), text);
    writeLedger(id, { builtAt: now, to: index.to, failedAt: null });
    noFile.delete(id);
    setSlice(id, index, now);
  } catch (e) {
    if (!current()) return;
    if (marker) writeLedger(id, marker);
    console.warn('[iptv] programme index failed:', iptvErrorText(e));
  } finally {
    // The source changed: our marker goes (a drop since then has removed it already).
    if (!ok && marker && !current() && sameLedger(readLedger(id), marker)) writeLedger(id, ledger);
    // Not saved: the status we set goes back, unless someone else has changed it since. A skip (no attempt) restores it as it was.
    if (isM3u && !ok && iptvState().guideStatus[id] === 'loading' && current()) {
      setGuideStatus(id, before === 'ready' ? 'ready' : marker ? 'error' : (before ?? 'idle'));
    }
  }
}

let running: Promise<void> | null = null;

/** Builds the index of each provider that is due, one after another. Stops when the device or network does not allow it (checked before each download). */
export function refreshDue(now?: number): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!programmeIndexEnabled()) return;
    bindSession();
    const at = now ?? deps.now();
    for (const id of iptvState().providers.order.slice()) {
      if (!needsIndexRefresh(readLedger(id), at)) continue;
      const url = guideUrlOf(id);
      if (!url) continue;
      if (!(await networkAllows())) return;
      await buildOne(id, url, at);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

let slicing: Promise<void> | null = null;

/**
 * Loads the saved index files into the store's three-hour slices, where one
 * is missing or ends within 70 minutes. Cheap on repeat calls: a valid slice
 * is kept, a provider with no file is not read again until a build or a
 * drop, and calls made while one runs share it.
 */
export function ensureSlices(now?: number): Promise<void> {
  if (slicing) return slicing;
  slicing = loadSlices(now).finally(() => {
    slicing = null;
  });
  return slicing;
}

async function loadSlices(now?: number): Promise<void> {
  if (!programmeIndexEnabled()) return;
  const at = now ?? deps.now();
  for (const id of iptvState().providers.order.slice()) {
    const slice = iptvState().programmeSlices[id];
    if (slice && slice.from <= at && slice.to - at > SLICE_RENEW_MS) continue;
    if (noFile.has(id)) continue;
    const raw = await iptvFiles.read(indexPath(id));
    let index: ProgrammeIndex | null = null;
    try {
      index = raw ? migrateProgrammeIndex(JSON.parse(raw)) : null;
    } catch {
      index = null;
    }
    if (!index) noFile.add(id);
    else if (providerById(id)) setSlice(id, index, at);
  }
}

let started = false;
let startedAt = 0;

/**
 * Runs `refreshDue` soon: never in the first 45 seconds after the start, and
 * at an idle moment. Calls made while a run waits share it. Does nothing
 * before `startProgrammeIndex`.
 */
export function refreshSoon(): void {
  if (!started || scheduled || !programmeIndexEnabled()) return;
  scheduled = true;
  const wait = Math.max(0, startedAt + LAUNCH_DELAY_MS - deps.now());
  deps.schedule(wait, () => {
    scheduled = false;
    void refreshDue();
  });
}

/**
 * Starts the background refresh: after the start, each time the app comes
 * to the front, when another account signs in and when a provider is added
 * (by hand, by account sync or by a share). Safe to call often.
 */
export function startProgrammeIndex(): void {
  if (started || !programmeIndexEnabled()) return;
  started = true;
  startedAt = deps.now();
  refreshSoon();
  AppState.addEventListener('change', (st) => {
    if (st === 'active') refreshSoon();
  });
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.serverId !== prev.session?.serverId || s.session?.userId !== prev.session?.userId) refreshSoon();
  });
  useIptvStore.subscribe((s, prev) => {
    if (s.scope !== prev.scope || s.providers.order.some((id) => !prev.providers.order.includes(id))) refreshSoon();
  });
}
