/**
 * The background programme index with a fake provider, fake files, a fake
 * network and a fixed clock: it builds on Wi-Fi, skips on mobile data, waits
 * while the index is fresh or a build failed, shares one download with the
 * M3U guide window, and cleans up with the provider.
 */
import { SAMPLE_M3U, xmltvTime } from '../test-utils/fixtures';

const mockKv = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockResponses = new Map<string, unknown>();
const mockTexts = new Map<string, string>();
const mockRequested: string[] = [];
const mockReads: string[] = [];
const mockHook: { onText: ((url: string) => void) | null } = { onText: null };
/** While set, downloads wait for it (a slow provider). */
const mockHold: { promise: Promise<void> | null } = { promise: null };
async function* mockHeld(hold: Promise<void>, chunks: AsyncGenerator<string>): AsyncGenerator<string> {
  await hold;
  yield* chunks;
}

jest.mock('@/storage/kv', () => ({
  storage: {
    getString: (k: string) => mockKv.get(k),
    set: (k: string, v: string) => void mockKv.set(k, v),
    remove: (k: string) => void mockKv.delete(k),
    clearAll: () => mockKv.clear(),
  },
}));
jest.mock('@/storage/secure', () => ({
  secureStore: { get: (k: string) => mockSecure.get(k) ?? null, set: (k: string, v: string) => void mockSecure.set(k, v), remove: (k: string) => void mockSecure.delete(k) },
}));
jest.mock('../files', () => ({
  iptvFiles: {
    persistent: true,
    read: async (p: string) => {
      mockReads.push(p);
      return mockFiles.get(p) ?? null;
    },
    write: async (p: string, t: string) => void mockFiles.set(p, t),
    remove: async (p: string) => {
      for (const k of [...mockFiles.keys()]) if (k.startsWith(p)) mockFiles.delete(k);
    },
  },
}));
jest.mock('../transport', () => {
  const { IptvError } = jest.requireActual('../errors');
  return {
    transport: {
      sendsUserAgent: true,
      text(url: string) {
        mockRequested.push(url);
        mockHook.onText?.(url);
        const t = mockTexts.get(url);
        if (t === undefined) throw new IptvError('http', 404);
        const chunks = jest.requireActual('../test-utils/fixtures').inChunks(t, 100);
        return mockHold.promise ? mockHeld(mockHold.promise, chunks) : chunks;
      },
      async json(url: string) {
        mockRequested.push(url);
        if (!mockResponses.has(url)) throw new IptvError('network');
        return mockResponses.get(url);
      },
    },
  };
});
jest.mock('@/auth/session-store', () => {
  const { create: make } = jest.requireActual('zustand');
  return { useSessionStore: make(() => ({ session: { serverId: 's1', userId: 'u1' } })) };
});

// eslint-disable-next-line import/first
import type { NetworkSnapshot } from '@/servers/wifi-rule';
// eslint-disable-next-line import/first
import { iptvFiles } from '../files';
// eslint-disable-next-line import/first
import { loadGuide, refresh, removeProvider, saveProvider } from '../manager';
// eslint-disable-next-line import/first
import { migrateProgrammeIndex } from '../programme-index';
// eslint-disable-next-line import/first
import { dropProgrammeIndex, ensureSlices, LAUNCH_DELAY_MS, refreshDue, setProgrammeIndexDeps, startProgrammeIndex } from '../programme-manager';
// eslint-disable-next-line import/first
import { searchProgrammes } from '../programme-search';
// eslint-disable-next-line import/first
import { useSessionStore } from '@/auth/session-store';
// eslint-disable-next-line import/first
import { iptvState, patchData, setIptvState } from '../store';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 12);
const XTREAM = 'http://panel.example.com:8080';
const api = (q: string) => `${XTREAM}/player_api.php?username=jane&password=s3cret${q}`;
const GUIDE = `${XTREAM}/xmltv.php?username=jane&password=s3cret`;
const PLAYLIST = 'https://lists.example.com/get.php?token=t0ken';
const M3U_GUIDE = 'https://epg.example.com/guide.xml.gz';

/** Hour-long programmes from T0 − 1 h for `hours` hours on each channel id. */
function guide(ids: string[], hours: number): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
  for (const id of ids) out.push(`<channel id="${id}"><display-name>${id}</display-name></channel>`);
  for (const id of ids) {
    for (let h = 0; h < hours; h++) {
      const s = T0 - HOUR + h * HOUR;
      out.push(`<programme start="${xmltvTime(s)}" stop="${xmltvTime(s + HOUR)}" channel="${id}"><title>Show ${h}</title></programme>`);
    }
  }
  out.push('</tv>');
  return out.join('\n');
}

let net: NetworkSnapshot | null = { type: 'wifi', ssid: null };
let phone = true;
/** Runs that `refreshSoon` scheduled: the wait and the run. */
const scheduled: { ms: number; run: () => void }[] = [];
const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  mockKv.clear();
  mockSecure.clear();
  mockFiles.clear();
  mockResponses.clear();
  mockTexts.clear();
  mockRequested.length = 0;
  mockReads.length = 0;
  mockHook.onText = null;
  mockHold.promise = null;
  setIptvState({ scope: null, programmeSlices: {} });
  (iptvFiles as { persistent: boolean }).persistent = true;
  net = { type: 'wifi', ssid: null };
  phone = true;
  scheduled.length = 0;
  setProgrammeIndexDeps({ isPhone: () => phone, network: async () => net, now: () => T0, schedule: (ms, run) => void scheduled.push({ ms, run }) });
  warn.mockClear();
});

async function addXtream(): Promise<string> {
  mockResponses.set(api(''), { user_info: { auth: 1, status: 'Active' } });
  mockResponses.set(api('&action=get_live_categories'), [{ category_id: '1', category_name: 'News' }]);
  mockResponses.set(api('&action=get_live_streams'), [
    { name: 'Example News', stream_id: 5, category_id: '1', epg_channel_id: 'news.example' },
    { name: 'Sport One', stream_id: 6, category_id: '1', epg_channel_id: 'sport.example' },
  ]);
  const id = await saveProvider({ kind: 'xtream', name: 'Panel', server: XTREAM, username: 'jane', password: 's3cret', userAgent: null });
  mockRequested.length = 0;
  return id;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const ledgerOf = (id: string) => {
  const raw = mockKv.get(`iptv.progidx.${id}`);
  return raw ? (JSON.parse(raw) as { builtAt: number | null; to: number | null; failedAt: number | null }) : null;
};

describe('programme index refresh', () => {
  it('builds and saves an index for an Xtream provider on Wi-Fi', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example', 'sport.example', 'other.example'], 60));
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(1);
    expect(mockRequested[0].endsWith('/xmltv.php?username=jane&password=s3cret')).toBe(true);
    const index = migrateProgrammeIndex(JSON.parse(mockFiles.get(`iptv/${id}/programmes.json`) ?? 'null'));
    expect(index).not.toBeNull();
    expect(Object.keys(index?.channels ?? {}).sort()).toEqual(['news.example', 'sport.example']);
    expect(ledgerOf(id)).toMatchObject({ builtAt: T0, failedAt: null });
    expect(ledgerOf(id)?.to).toBeGreaterThanOrEqual(T0 + 47 * HOUR);
    // Nothing secret in MMKV.
    expect([...mockKv.values()].join('\n')).not.toMatch(/s3cret|jane/);
  });

  it('skips on mobile data on a phone', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    net = { type: 'cellular', ssid: null };
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(0);
    expect(ledgerOf(id)).toBeNull();
    net = null;
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(0);
  });

  it('runs on any network when the device is not a phone', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    phone = false;
    net = null;
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(1);
    expect(ledgerOf(id)?.builtAt).toBe(T0);
  });

  it('skips when the index is fresh', async () => {
    await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    await refreshDue(T0);
    mockRequested.length = 0;
    await refreshDue(T0 + HOUR);
    expect(mockRequested).toHaveLength(0);
  });

  it('a failure keeps the old index and waits 12 hours', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    await refreshDue(T0);
    const before = mockFiles.get(`iptv/${id}/programmes.json`);
    mockTexts.set(GUIDE, '<html>login</html>');
    mockRequested.length = 0;
    await refreshDue(T0 + 25 * HOUR);
    expect(mockRequested).toHaveLength(1);
    expect(mockFiles.get(`iptv/${id}/programmes.json`)).toBe(before);
    expect(ledgerOf(id)).toMatchObject({ builtAt: T0, failedAt: T0 + 25 * HOUR });
    expect(warn).toHaveBeenCalledWith('[iptv] programme index failed:', expect.any(String));
    expect(String(warn.mock.calls[0][1])).not.toMatch(/example|jane|s3cret/);
    mockRequested.length = 0;
    await refreshDue(T0 + 30 * HOUR);
    expect(mockRequested).toHaveLength(0);
    await refreshDue(T0 + 38 * HOUR);
    expect(mockRequested).toHaveLength(1);
  });

  it('M3U: one download feeds the guide window and the index', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    mockTexts.set(M3U_GUIDE, guide(['news.example', 'sport.example'], 60));
    mockFiles.delete(`iptv/${id}/guide.json`);
    mockRequested.length = 0;
    await refreshDue(T0);
    expect(mockRequested).toEqual([M3U_GUIDE]);
    expect(mockFiles.has(`iptv/${id}/guide.json`)).toBe(true);
    expect(mockFiles.has(`iptv/${id}/names.json`)).toBe(true);
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(true);
    expect(iptvState().guides[id]?.channels['news.example']?.length).toBeGreaterThan(0);
    expect(iptvState().guideStatus[id]).toBe('ready');
  });

  it('dropProgrammeIndex clears file, ledger and slice, and removeProvider calls it', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    await refreshDue(T0);
    await ensureSlices(T0);
    expect(iptvState().programmeSlices[id]).toBeDefined();
    await dropProgrammeIndex(id);
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(false);
    expect(ledgerOf(id)).toBeNull();
    expect(iptvState().programmeSlices[id]).toBeUndefined();

    await refreshDue(T0);
    await ensureSlices(T0);
    expect(ledgerOf(id)).not.toBeNull();
    await removeProvider(id);
    expect(ledgerOf(id)).toBeNull();
    expect(iptvState().programmeSlices[id]).toBeUndefined();
  });

  it('a changed login drops the index', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    await refreshDue(T0);
    expect(ledgerOf(id)).not.toBeNull();
    // The same login: the index stays.
    await saveProvider({ kind: 'xtream', name: 'Panel 2', server: XTREAM, username: 'jane', password: '', userAgent: null }, id);
    expect(ledgerOf(id)).not.toBeNull();
    const api2 = (q: string) => `${XTREAM}/player_api.php?username=sam&password=s3cret${q}`;
    mockResponses.set(api2(''), { user_info: { auth: 1, status: 'Active' } });
    mockResponses.set(api2('&action=get_live_categories'), []);
    mockResponses.set(api2('&action=get_live_streams'), [{ name: 'Example News', stream_id: 5, category_id: '1' }]);
    await saveProvider({ kind: 'xtream', name: 'Panel 2', server: XTREAM, username: 'sam', password: 's3cret', userAgent: null }, id);
    expect(ledgerOf(id)).toBeNull();
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(false);
  });

  it('plain web: nothing runs', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    (iptvFiles as { persistent: boolean }).persistent = false;
    await refreshDue(T0);
    await ensureSlices(T0);
    expect(mockRequested).toHaveLength(0);
    expect(ledgerOf(id)).toBeNull();
    expect(iptvState().programmeSlices[id]).toBeUndefined();
  });

  it('ensureSlices loads only the 3-hour slice into the store', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example', 'sport.example'], 60));
    await refreshDue(T0);
    setIptvState({ programmeSlices: {} });
    await ensureSlices(T0);
    const slice = iptvState().programmeSlices[id];
    expect(slice).toMatchObject({ from: T0, to: T0 + 3 * HOUR });
    // Three programmes per channel are on between T0 and T0 + 3 h.
    expect(slice.programmes).toHaveLength(6);
    for (const p of slice.programmes) {
      expect(p.stop).toBeGreaterThan(T0);
      expect(p.start).toBeLessThan(T0 + 3 * HOUR);
    }
    // Still good for more than 70 minutes: the same slice.
    await ensureSlices(T0 + 100 * 60_000);
    expect(iptvState().programmeSlices[id]).toBe(slice);
    // Ends within 70 minutes: a new slice.
    await ensureSlices(T0 + 115 * 60_000);
    expect(iptvState().programmeSlices[id]).not.toBe(slice);
    expect(iptvState().programmeSlices[id].from).toBe(T0 + 115 * 60_000);
  });

  it('M3U cold start: a stale saved guide and the index share one download', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    // A cold start: the list is in its file, the saved guide window has ended.
    mockFiles.set(`iptv/${id}/guide.json`, JSON.stringify({ schemaVersion: 1, from: 0, to: 0, channels: {} }));
    patchData(id, { status: 'idle', channels: [], index: null });
    setIptvState({ guides: {}, guideStatus: {}, guideNames: {} });
    mockTexts.set(M3U_GUIDE, guide(['news.example', 'sport.example'], 60));
    mockRequested.length = 0;
    await refreshDue(T0);
    await flush();
    await flush();
    expect(mockRequested.filter((u) => u === M3U_GUIDE)).toHaveLength(1);
    expect(iptvState().guideStatus[id]).toBe('ready');
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(true);
  });

  it('M3U: a failed download leaves the guide status as an error, not loading', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    mockTexts.set(M3U_GUIDE, '<html>login</html>');
    await refreshDue(T0);
    expect(iptvState().guideStatus[id]).toBe('error');
  });

  it('a login change during the download discards the old index', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    mockHook.onText = () => {
      const secrets = JSON.parse(mockSecure.get(`iptv.${id}`) ?? '{}');
      mockSecure.set(`iptv.${id}`, JSON.stringify({ ...secrets, password: 'n3w' }));
    };
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(1);
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(false);
    expect(ledgerOf(id)).toBeNull();
    expect(iptvState().programmeSlices[id]).toBeUndefined();
  });

  it('stops after the current provider when the phone leaves Wi-Fi', async () => {
    const x = await addXtream();
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const m = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    mockTexts.set(M3U_GUIDE, guide(['news.example'], 60));
    mockHook.onText = () => {
      net = { type: 'cellular', ssid: null };
    };
    mockRequested.length = 0;
    await refreshDue(T0);
    expect(mockRequested).toEqual([GUIDE]);
    expect(ledgerOf(x)?.builtAt).toBe(T0);
    expect(ledgerOf(m)).toBeNull();
  });

  it('a provider added during a run is built right after it', async () => {
    const x = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    let release!: () => void;
    mockHold.promise = new Promise<void>((r) => (release = r));
    const first = refreshDue(T0);
    await flush();
    expect(mockRequested).toEqual([GUIDE]);
    // The new provider's downloads are not held.
    mockHold.promise = null;
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    mockTexts.set(M3U_GUIDE, guide(['news.example'], 60));
    const m = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    const second = refreshDue(T0);
    release();
    await Promise.all([first, second]);
    expect(ledgerOf(x)?.builtAt).toBe(T0);
    expect(ledgerOf(m)?.builtAt).toBe(T0);
  });

  it('ensureSlices does no file read on a repeat call', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    // A second provider with no index file.
    const m = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    await refreshDue(T0);
    expect(mockFiles.has(`iptv/${m}/programmes.json`)).toBe(false);
    setIptvState({ programmeSlices: {} });
    await ensureSlices(T0);
    expect(iptvState().programmeSlices[id]).toBeDefined();
    mockReads.length = 0;
    await ensureSlices(T0 + 5 * 60_000);
    expect(mockReads).toEqual([]);
    // A built index is read again (its slice is set by the build).
    await dropProgrammeIndex(m);
    mockReads.length = 0;
    await ensureSlices(T0 + 5 * 60_000);
    expect(mockReads).toEqual([`iptv/${m}/programmes.json`]);
  });

  it('the slice always holds the 60-minute look-ahead of the search', async () => {
    const id = await addXtream();
    const MIN = 60_000;
    const xml = [
      '<tv>',
      `<programme start="${xmltvTime(T0 - HOUR)}" stop="${xmltvTime(T0 + 140 * MIN)}" channel="news.example"><title>Long Show</title></programme>`,
      `<programme start="${xmltvTime(T0 + 140 * MIN)}" stop="${xmltvTime(T0 + 240 * MIN)}" channel="news.example"><title>Late Match</title></programme>`,
      '</tv>',
    ].join('\n');
    mockTexts.set(GUIDE, xml);
    await refreshDue(T0);
    setIptvState({ programmeSlices: {} });
    await ensureSlices(T0);
    for (const at of [T0 + 85 * MIN, T0 + 90 * MIN]) {
      await ensureSlices(at);
      const channels = iptvState().data[id]?.channels ?? [];
      const byId = new Map([['news.example', channels.filter((c) => c.epgId === 'news.example')]]);
      const hits = searchProgrammes([{ providerId: id, programmes: iptvState().programmeSlices[id].programmes, channelsByGuideId: byId }], 'late match', at);
      expect(hits.map((h) => h.start)).toEqual([T0 + 140 * MIN]);
    }
  });

  it('waits for a channel list that is still loading, and never keeps the whole guide', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example', 'sport.example', 'other.example'], 60));
    // The list is loading (another caller started it) when the refresh runs.
    patchData(id, { status: 'idle', channels: [], index: null });
    const load = refresh(id);
    expect(iptvState().data[id]?.status).toBe('loading');
    await refreshDue(T0);
    await load;
    const index = migrateProgrammeIndex(JSON.parse(mockFiles.get(`iptv/${id}/programmes.json`) ?? 'null'));
    expect(Object.keys(index?.channels ?? {}).sort()).toEqual(['news.example', 'sport.example']);
  });

  it('a provider with no channels is skipped without a download or a failure', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    patchData(id, { status: 'error', channels: [], index: null });
    await refreshDue(T0);
    expect(mockRequested).toHaveLength(0);
    expect(ledgerOf(id)).toBeNull();
  });

  it('a run killed during the download is not tried again for 12 hours', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    // The ledger as it is when the download starts: what a kill at that moment leaves.
    let atDownload: string | undefined;
    mockHook.onText = () => {
      atDownload = mockKv.get(`iptv.progidx.${id}`);
    };
    await refreshDue(T0);
    expect(JSON.parse(atDownload ?? 'null')).toEqual({ builtAt: null, to: null, failedAt: T0 });
    // A good run clears the marker.
    expect(ledgerOf(id)).toMatchObject({ builtAt: T0, failedAt: null });
    // The process "restarts" with only the marker saved.
    mockKv.set(`iptv.progidx.${id}`, atDownload ?? '');
    mockHook.onText = null;
    mockRequested.length = 0;
    await refreshDue(T0 + HOUR);
    await refreshDue(T0 + 11 * HOUR);
    expect(mockRequested).toHaveLength(0);
    await refreshDue(T0 + 13 * HOUR);
    expect(mockRequested).toHaveLength(1);
  });

  it('a new guide address in the M3U playlist drops the index', async () => {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    mockTexts.set(M3U_GUIDE, guide(['news.example', 'sport.example'], 60));
    await refreshDue(T0);
    expect(ledgerOf(id)).not.toBeNull();
    // The same playlist again: the index stays.
    await refresh(id);
    expect(ledgerOf(id)).not.toBeNull();
    mockTexts.set(PLAYLIST, SAMPLE_M3U.replace(/guide\.xml\.gz/g, 'other.xml'));
    await refresh(id);
    expect(ledgerOf(id)).toBeNull();
    expect(mockFiles.has(`iptv/${id}/programmes.json`)).toBe(false);
  });

  it('ensureSlices calls made together share one file read', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    await refreshDue(T0);
    setIptvState({ programmeSlices: {} });
    mockReads.length = 0;
    await Promise.all([ensureSlices(T0), ensureSlices(T0), ensureSlices(T0)]);
    expect(mockReads).toEqual([`iptv/${id}/programmes.json`]);
  });

  it('waits after the start, and runs again on sign-in and when a provider is added', async () => {
    startProgrammeIndex();
    // The first run waits for the launch delay; nothing downloads during the start.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(LAUNCH_DELAY_MS);
    scheduled.shift()?.run();
    await refreshDue();

    // A new provider asks for a run (one at a time).
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example'], 60));
    expect(scheduled).toHaveLength(1);
    expect(mockRequested).toHaveLength(0);
    scheduled.shift()?.run();
    // The run it started (refreshDue returns the one that runs).
    await refreshDue();
    expect(mockRequested).toHaveLength(1);
    expect(ledgerOf(id)?.builtAt).toBe(T0);

    // Another account signs in.
    const signIn = (userId: string) =>
      useSessionStore.setState({ session: { serverUrl: 'http://jf.example', serverId: 's1', serverName: 'Home', serverVersion: null, userId, userName: 'Jane Doe', userImageTag: null, token: 't' } });
    signIn('u2');
    expect(scheduled.length).toBeGreaterThanOrEqual(1);
    signIn('u1');
  });
});


describe('guide window owner', () => {
  const NEW_GUIDE = 'https://epg.example.com/other.xml';

  async function addM3u(): Promise<string> {
    mockTexts.set(PLAYLIST, SAMPLE_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'L', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    await flush();
    await flush();
    mockRequested.length = 0;
    return id;
  }

  it('a new guide address during the index build loads the new guide after it; the status never stays loading', async () => {
    const id = await addM3u();
    mockTexts.set(M3U_GUIDE, guide(['news.example', 'sport.example'], 60));
    mockTexts.set(NEW_GUIDE, guide(['news.example', 'sport.example'], 60));
    let refreshing: Promise<void> | null = null;
    mockHook.onText = (url) => {
      if (url !== M3U_GUIDE || refreshing) return;
      // The playlist now names another guide; a refresh runs during the build.
      mockTexts.set(PLAYLIST, SAMPLE_M3U.replace(/guide\.xml\.gz/g, 'other.xml'));
      refreshing = refresh(id);
    };
    await refreshDue(T0);
    await refreshing;
    for (let i = 0; i < 5; i++) await flush();
    expect(mockRequested.filter((u) => u === NEW_GUIDE)).toHaveLength(1);
    expect(iptvState().guideStatus[id]).toBe('ready');
  });

  it('two guide loads at once download once', async () => {
    const id = await addM3u();
    mockTexts.set(M3U_GUIDE, guide(['news.example'], 60));
    await Promise.all([loadGuide(id, true), loadGuide(id, true), loadGuide(id, false)]);
    expect(mockRequested.filter((u) => u === M3U_GUIDE)).toHaveLength(1);
    expect(iptvState().guideStatus[id]).toBe('ready');
  });

  it('a provider removed during a guide load gets no guide written', async () => {
    const id = await addM3u();
    mockTexts.set(M3U_GUIDE, guide(['news.example'], 60));
    let removing: Promise<void> | null = null;
    mockHook.onText = (url) => {
      if (url === M3U_GUIDE && !removing) removing = removeProvider(id);
    };
    await loadGuide(id, true);
    await removing;
    await flush();
    expect([...mockFiles.keys()].filter((k) => k.startsWith(`iptv/${id}/`))).toEqual([]);
    expect(iptvState().guides[id]).toBeUndefined();
    expect(iptvState().guideStatus[id]).toBeUndefined();
  });
});
