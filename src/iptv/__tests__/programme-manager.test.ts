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
    read: async (p: string) => mockFiles.get(p) ?? null,
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
        const t = mockTexts.get(url);
        if (t === undefined) throw new IptvError('http', 404);
        return jest.requireActual('../test-utils/fixtures').inChunks(t, 100);
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
import { removeProvider, saveProvider } from '../manager';
// eslint-disable-next-line import/first
import { migrateProgrammeIndex } from '../programme-index';
// eslint-disable-next-line import/first
import { dropProgrammeIndex, ensureSlices, refreshDue, setProgrammeIndexDeps } from '../programme-manager';
// eslint-disable-next-line import/first
import { iptvState, setIptvState } from '../store';

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
const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  mockKv.clear();
  mockSecure.clear();
  mockFiles.clear();
  mockResponses.clear();
  mockTexts.clear();
  mockRequested.length = 0;
  setIptvState({ scope: null, programmeSlices: {} });
  (iptvFiles as { persistent: boolean }).persistent = true;
  net = { type: 'wifi', ssid: null };
  phone = true;
  setProgrammeIndexDeps({ isPhone: () => phone, network: async () => net, now: () => T0 });
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

  it('ensureSlices loads only the 2-hour slice into the store', async () => {
    const id = await addXtream();
    mockTexts.set(GUIDE, guide(['news.example', 'sport.example'], 60));
    await refreshDue(T0);
    setIptvState({ programmeSlices: {} });
    await ensureSlices(T0);
    const slice = iptvState().programmeSlices[id];
    expect(slice).toMatchObject({ from: T0, to: T0 + 2 * HOUR });
    // Two programmes per channel are on between T0 and T0 + 2 h.
    expect(slice.programmes).toHaveLength(4);
    for (const p of slice.programmes) {
      expect(p.stop).toBeGreaterThan(T0);
      expect(p.start).toBeLessThan(T0 + 2 * HOUR);
    }
    // Still good for more than 30 minutes: the same slice.
    await ensureSlices(T0 + 10 * 60_000);
    expect(iptvState().programmeSlices[id]).toBe(slice);
    // Ends within 30 minutes: a new slice.
    await ensureSlices(T0 + 100 * 60_000);
    expect(iptvState().programmeSlices[id]).not.toBe(slice);
    expect(iptvState().programmeSlices[id].from).toBe(T0 + 100 * 60_000);
  });
});
