/**
 * Films and series with a fake provider, fake files and a fake store:
 * catalogues load per category and only once, saved files show at once,
 * positions stay on the device per provider, M3U films leave the channel
 * list, and removing a provider cleans up.
 */
import { useSessionStore } from '@/auth/session-store';

import { SERIES_INFO, SERIES_LIST, VOD_CATEGORIES, VOD_INFO, VOD_M3U, VOD_STREAMS } from '../test-utils/vod-fixtures';

const mockKv = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockResponses = new Map<string, unknown>();
const mockTexts = new Map<string, string>();
const mockRequested: string[] = [];
/** While set, file reads wait for it (a slow disk). */
const mockReadHold: { promise: Promise<void> | null } = { promise: null };

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
      // The read sees the file as it is now, and answers late.
      const text = mockFiles.get(p) ?? null;
      if (mockReadHold.promise) await mockReadHold.promise;
      return text;
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
import { bindSession, removeProvider, saveProvider } from '../manager';
// eslint-disable-next-line import/first
import { iptvState, setIptvState } from '../store';
// eslint-disable-next-line import/first
import { ALL_CATEGORY, episodeRequest, filmRequest, findFilm, findSeries, loadAll, loadCategories, loadCategory, loadInfo, refreshCatalogue, toggleFavouriteTitle, vodListsOf } from '../vod-manager';
// eslint-disable-next-line import/first
import { catalogueKey, categoryKey, infoKey, resetVodState, vodState } from '../vod-store';
// eslint-disable-next-line import/first
import { type SeriesInfo, VOD_CACHE_SCHEMA_VERSION } from '../vod-types';

const XTREAM = 'http://panel.example.com:8080';
const api = (q: string) => `${XTREAM}/player_api.php?username=jane&password=s3cret${q}`;
const PLAYLIST = 'https://lists.example.com/get.php?token=t0ken';

beforeEach(() => {
  mockKv.clear();
  mockSecure.clear();
  mockFiles.clear();
  mockResponses.clear();
  mockTexts.clear();
  mockRequested.length = 0;
  mockReadHold.promise = null;
  setIptvState({ scope: null });
  resetVodState();
});

async function addXtream(): Promise<string> {
  mockResponses.set(api(''), { user_info: { auth: 1, status: 'Active' } });
  mockResponses.set(api('&action=get_live_categories'), []);
  mockResponses.set(api('&action=get_live_streams'), [{ name: 'Example News', stream_id: 5, category_id: '1' }]);
  mockResponses.set(api('&action=get_vod_categories'), VOD_CATEGORIES);
  mockResponses.set(api('&action=get_vod_streams&category_id=10'), VOD_STREAMS.filter((s) => s?.category_id === '10'));
  mockResponses.set(api('&action=get_vod_streams'), VOD_STREAMS);
  mockResponses.set(api('&action=get_vod_info&vod_id=501'), VOD_INFO);
  mockResponses.set(api('&action=get_series_categories'), [{ category_id: '20', category_name: 'Drama' }]);
  mockResponses.set(api('&action=get_series&category_id=20'), SERIES_LIST);
  mockResponses.set(api('&action=get_series_info&series_id=77'), SERIES_INFO);
  const id = await saveProvider({ kind: 'xtream', name: 'Panel', server: XTREAM, username: 'jane', password: 's3cret', userAgent: null });
  mockRequested.length = 0;
  return id;
}

const asked = (q: string) => mockRequested.filter((u) => u === api(q)).length;

describe('IPTV films and series', () => {
  it('loads categories and a category on demand, saves them, and shows the saved copy next time', async () => {
    const id = await addXtream();
    await loadCategories(id, 'film');
    expect(vodState().categories[catalogueKey(id, 'film')]).toMatchObject({ status: 'ready', data: [{ id: '10', name: 'Action' }, { id: '11', name: 'Drama' }, { id: '12', name: 'Other' }] });
    // No category loads until it opens.
    expect(mockRequested.some((u) => u.includes('get_vod_streams'))).toBe(false);
    await loadCategory(id, 'film', '10');
    expect(vodState().lists[categoryKey(id, 'film', '10')].data.map((f) => f.name)).toEqual(['The Long Night', 'Sea of Glass']);
    expect(mockFiles.has(`iptv/${id}/vod/film-c-10.json`)).toBe(true);
    // Twice: one request.
    await loadCategory(id, 'film', '10');
    expect(asked('&action=get_vod_streams&category_id=10')).toBe(1);

    // A new launch: the files show at once, with no request.
    resetVodState();
    mockRequested.length = 0;
    await loadCategories(id, 'film');
    await loadCategory(id, 'film', '10');
    expect(vodState().lists[categoryKey(id, 'film', '10')].status).toBe('ready');
    expect(mockRequested).toEqual([]);
    // Nothing secret in the files or MMKV keys.
    expect([...mockFiles.keys()].join()).not.toMatch(/s3cret|jane/);
  });

  it('loads a stale saved catalogue again behind the saved copy, and keeps it when that fails', async () => {
    const id = await addXtream();
    await loadCategories(id, 'film');
    const path = `iptv/${id}/vod/film-cats.json`;
    const file = JSON.parse(mockFiles.get(path) ?? '{}');
    mockFiles.set(path, JSON.stringify({ ...file, savedAt: Date.now() - 2 * 24 * 3_600_000 }));
    resetVodState();
    mockRequested.length = 0;
    mockResponses.delete(api('&action=get_vod_categories'));
    await loadCategories(id, 'film');
    const cats = vodState().categories[catalogueKey(id, 'film')];
    expect(cats.status).toBe('ready');
    expect(cats.data).toHaveLength(3);
    expect(cats.error).toMatch(/./);
    expect(asked('&action=get_vod_categories')).toBe(1);
  });

  it('loads all titles for a search, and then needs no request for a category', async () => {
    const id = await addXtream();
    await loadAll(id, 'film');
    const all = vodState().all[catalogueKey(id, 'film')];
    expect(all.data.items).toHaveLength(3);
    expect(all.data.index?.folded).toContain('the long night');
    await loadCategory(id, 'film', '11');
    expect(vodState().lists[categoryKey(id, 'film', '11')].data.map((f) => f.id)).toEqual(['502']);
    expect(asked('&action=get_vod_streams&category_id=11')).toBe(0);
    await loadCategory(id, 'film', ALL_CATEGORY);
    expect(asked('&action=get_vod_streams')).toBe(1);
    expect(findFilm(id, '503')?.name).toBe('Sea of Glass');
  });

  it('loads details, plays a film through the player request and keeps its position on the device', async () => {
    const id = await addXtream();
    await loadCategory(id, 'film', '10');
    await loadInfo(id, 'film', '501');
    const info = vodState().info[infoKey(id, 'film', '501')];
    expect(info.data).toMatchObject({ duration: 7260, ext: 'mkv' });
    const film = findFilm(id, '501');
    if (!film) throw new Error('no film');
    const req = filmRequest(id, film, info.data, 0);
    expect(req.items[0]).toMatchObject({ id: '501', kind: 'film', title: 'The Long Night', year: 2019, duration: 7260, poster: 'https://img.example.com/posters/501.jpg' });
    // The request holds no stream URL (it can hold credentials).
    expect(JSON.stringify(req.items)).not.toMatch(/s3cret/);
    const stream = await req.source.resolve(req.items[0]);
    // Jest runs as iOS: an MKV film tries its HLS form, and else says why.
    expect(stream.candidates).toEqual([{ url: `${XTREAM}/movie/jane/s3cret/501.m3u8`, isHls: true }]);
    expect(stream.unsupported).toMatch(/MKV/);

    req.source.savePosition(req.items[0], 1800, 7260, false);
    expect(vodListsOf(id).positions['film:501']).toMatchObject({ position: 1800, finished: false, title: 'The Long Night', ext: 'mkv' });
    const saved = JSON.parse(mockKv.get(`iptv.vod.${id}`) ?? '{}');
    expect(saved.positions['film:501'].position).toBe(1800);
    // Never to Jellyfin: no request at all.
    expect(mockRequested.filter((u) => !u.startsWith(XTREAM))).toEqual([]);
  });

  it('loads a series with its seasons and plays episodes in order across seasons', async () => {
    const id = await addXtream();
    await loadCategory(id, 'series', '20');
    await loadInfo(id, 'series', '77');
    const info = vodState().info[infoKey(id, 'series', '77')].data as SeriesInfo;
    expect(info.seasons.map((s) => s.number)).toEqual([1, 2, 0]);
    const series = findSeries(id, '77');
    if (!series) throw new Error('no series');
    const order = info.seasons.flatMap((s) => s.episodes);
    const req = episodeRequest(id, series, order, order[1], 60);
    expect(req.index).toBe(1);
    expect(req.startSeconds).toBe(60);
    expect(req.items.map((r) => `${r.season}:${r.episode}`)).toEqual(['1:1', '1:2', '2:1', '0:1']);
    expect(req.items[2]).toMatchObject({ kind: 'episode', seriesId: '77', seriesName: 'Harbour Lights', poster: 'https://img.example.com/ep/9003.jpg' });
    const s2 = await req.source.resolve(req.items[2]);
    expect(s2.candidates).toEqual([{ url: `${XTREAM}/series/jane/s3cret/9003.mp4`, isHls: false }]);
    req.source.savePosition(req.items[1], 2660, 2670, true);
    expect(vodListsOf(id).positions['episode:9002']).toMatchObject({ finished: true, seriesId: '77', season: 1, episode: 2 });
  });

  it('refreshes the categories and the categories that loaded', async () => {
    const id = await addXtream();
    await loadCategories(id, 'film');
    await loadCategory(id, 'film', '10');
    mockRequested.length = 0;
    await refreshCatalogue(id, 'film');
    expect(asked('&action=get_vod_categories')).toBe(1);
    expect(asked('&action=get_vod_streams&category_id=10')).toBe(1);
  });

  it('M3U: films and series leave the channel list and show as categories', async () => {
    mockTexts.set(PLAYLIST, VOD_M3U);
    const id = await saveProvider({ kind: 'm3u', name: 'List', playlistUrl: PLAYLIST, guideUrl: null, userAgent: null });
    expect(iptvState().data[id].channels.map((c) => c.name)).toEqual(['Example News', 'Radio Example']);
    expect(iptvState().providers.providers[id].channelCount).toBe(2);
    await loadCategories(id, 'film');
    const cats = vodState().categories[catalogueKey(id, 'film')].data;
    expect(cats.map((c) => c.name)).toEqual(['Films | Action', 'Films | Drama', 'Series | Drama']);
    await loadCategory(id, 'film', cats[1].id);
    expect(vodState().lists[categoryKey(id, 'film', cats[1].id)].data.map((f) => f.name)).toEqual(['Quiet Harbour']);
    await loadCategories(id, 'series');
    const series = vodState().m3u[id].series[0];
    await loadInfo(id, 'series', series.id);
    expect((vodState().info[infoKey(id, 'series', series.id)].data as SeriesInfo).seasons[0].episodes).toHaveLength(2);
    const film = findFilm(id, vodState().m3u[id].films[1].id);
    if (!film) throw new Error('no film');
    const stream = await filmRequest(id, film, null, 0).source.resolve(filmRequest(id, film, null, 0).items[0]);
    expect(stream.candidates).toEqual([{ url: 'https://cdn.example.com/vod/quiet-harbour.mp4?token=abc', isHls: false }]);
    // The M3U URL stays in the files, never in MMKV.
    toggleFavouriteTitle(id, { kind: 'film', id: film.id, name: film.name });
    expect([...mockKv.values()].join()).not.toMatch(/token=abc/);
  });

  it('removing a provider removes its favourites, positions and catalogue files', async () => {
    const id = await addXtream();
    await loadCategories(id, 'film');
    expect(toggleFavouriteTitle(id, { kind: 'film', id: '501', name: 'The Long Night' })).toBe(true);
    expect(mockKv.has(`iptv.vod.${id}`)).toBe(true);
    await removeProvider(id);
    expect(mockKv.has(`iptv.vod.${id}`)).toBe(false);
    expect([...mockFiles.keys()]).toEqual([]);
    expect(Object.keys(vodState().categories)).toEqual([]);
  });

  it('a forced load during a normal load wins: the saved copy never replaces the fresh data', async () => {
    const id = await addXtream();
    const old = { schemaVersion: VOD_CACHE_SCHEMA_VERSION, providerId: id, savedAt: Date.now(), data: [{ id: '99', name: 'Old' }] };
    mockFiles.set(`iptv/${id}/vod/film-cats.json`, JSON.stringify(old));
    let release!: () => void;
    mockReadHold.promise = new Promise<void>((r) => (release = r));
    const normal = loadCategories(id, 'film');
    const forced = loadCategories(id, 'film', true);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    mockReadHold.promise = null;
    release();
    await Promise.all([normal, forced]);
    expect(vodState().categories[catalogueKey(id, 'film')]?.data.map((c) => c.name)).toEqual(['Action', 'Drama', 'Other']);
    // A normal load during the forced one joins it: no third request.
    await Promise.all([loadCategories(id, 'film', true), loadCategories(id, 'film')]);
    expect(asked('&action=get_vod_categories')).toBe(2);
  });

  it('another account starts with no catalogues in memory', async () => {
    bindSession();
    const id = await addXtream();
    await loadCategories(id, 'film');
    (useSessionStore as unknown as { setState(s: unknown): void }).setState({ session: { serverId: 's1', userId: 'u2' } });
    expect(Object.keys(vodState().categories)).toEqual([]);
    (useSessionStore as unknown as { setState(s: unknown): void }).setState({ session: { serverId: 's1', userId: 'u1' } });
  });
});
