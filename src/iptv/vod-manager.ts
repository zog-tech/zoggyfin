/**
 * Films and series: the catalogues of a provider (categories, the titles of a
 * category, all titles for search), the details of a title, favourites,
 * positions, and playing. Screens reach it through `vod-hooks.ts` (exported
 * by `index.ts`). The pure rules live in their own files; this file does the
 * I/O. Nothing here logs a URL or a secret.
 *
 * Xtream catalogues load per category when a category opens, and all titles
 * only for a search. Each answer is saved to a file
 * (`<documents>/iptv/<providerId>/vod/`), shown at once on the next visit,
 * and loaded again when it is a day old or on a refresh. M3U films and series
 * come with the channel list (`m3u-vod.ts`).
 */
import type { VodPlayRequest, VodRef, VodSource } from '@/player';

import { IptvError, iptvErrorText } from './errors';
import { iptvFiles } from './files';
import type { IptvFiles } from './files-types';
import { hashId } from './m3u';
import { seasonsFromEpisodes } from './m3u-vod';
import { ensureLoaded, providerById, refresh, streamPlatform, xtreamLogin } from './manager';
import { readSecrets } from './secrets';
import { iptvState } from './store';
import { transport } from './transport';
import { MAX_JSON_BYTES } from './transport-types';
import { EMPTY_VOD_LISTS, toggleVodFavourite, withPosition } from './vod-lists';
import { isInfo, isNamedList, migrateVodCache } from './vod-migrate';
import { buildTitleIndex } from './vod-search';
import {
  catalogueKey,
  categoryKey,
  EMPTY_ALL,
  EMPTY_CATEGORIES,
  EMPTY_INFO,
  EMPTY_LIST,
  infoKey,
  loadVodLists,
  type Loaded,
  patchVod,
  saveVodLists,
  setVodState,
  type VodInfo,
  vodState,
} from './vod-store';
import { m3uVodStream, xtreamEpisodeStream, xtreamFilmStream } from './vod-stream';
import {
  type Episode,
  type Film,
  type FilmInfo,
  type Series,
  type SeriesInfo,
  VOD_CACHE_SCHEMA_VERSION,
  type VodCacheFile,
  type VodCategory,
  type VodItem,
  type VodKind,
  type VodLists,
} from './vod-types';
import { parseSeriesInfo, parseSeriesList, parseVodCategories, parseVodInfo, parseVodStreams } from './xtream-vod';
import { xtreamApiUrl } from './xtream';

const HOUR = 3_600_000;
/** A saved catalogue older than this loads again in the background when it shows. */
export const STALE_CATALOGUE_MS = 24 * HOUR;
/** Saved details older than this load again. */
const STALE_INFO_MS = 7 * 24 * HOUR;
/** The category id for every title of a kind. */
export const ALL_CATEGORY = '*';

// ---- Files -------------------------------------------------------------------------

/** The plain web has no files: catalogues stay in memory (the browser's storage is too small for them). */
const memory = new Map<string, string>();
const memoryFiles: IptvFiles = {
  persistent: false,
  read: async (p) => memory.get(p) ?? null,
  write: async (p, t) => void memory.set(p, t),
  remove: async (p) => {
    for (const k of [...memory.keys()]) if (k === p || k.startsWith(`${p}/`)) memory.delete(k);
  },
};
const files: IptvFiles = iptvFiles.persistent ? iptvFiles : memoryFiles;

const safe = (id: string) => (/^[\w-]{1,40}$/.test(id) ? id : hashId(id));
const vodDir = (pid: string) => `iptv/${pid}/vod`;
const catsPath = (pid: string, kind: VodKind) => `${vodDir(pid)}/${kind}-cats.json`;
const listPath = (pid: string, kind: VodKind, cat: string) => (cat === ALL_CATEGORY ? `${vodDir(pid)}/${kind}-all.json` : `${vodDir(pid)}/${kind}-c-${safe(cat)}.json`);
const infoPath = (pid: string, kind: VodKind, id: string) => `${vodDir(pid)}/${kind}-i-${safe(id)}.json`;

async function readCache<T>(path: string, pid: string, isData: (v: unknown) => v is T): Promise<VodCacheFile<T> | null> {
  const raw = await files.read(path);
  if (!raw) return null;
  try {
    return migrateVodCache(JSON.parse(raw), pid, isData);
  } catch {
    return null;
  }
}

async function writeCache<T>(path: string, pid: string, data: T): Promise<number> {
  const savedAt = Date.now();
  const file: VodCacheFile<T> = { schemaVersion: VOD_CACHE_SCHEMA_VERSION, providerId: pid, savedAt, data };
  try {
    await files.write(path, JSON.stringify(file));
  } catch (e) {
    console.warn('[iptv] the catalogue was not saved', e instanceof Error ? e.name : 'error');
  }
  return savedAt;
}

/** Removes the saved catalogues of a provider (the provider folder goes with `removeProvider` too). */
export async function removeVodFiles(pid: string): Promise<void> {
  await files.remove(vodDir(pid));
}

// ---- Provider access -------------------------------------------------------------------

function xtreamOf(pid: string) {
  const record = providerById(pid);
  if (!record || record.kind !== 'xtream') return null;
  const login = xtreamLogin(record, readSecrets(pid));
  return login ? { record, login } : null;
}

async function xtreamJson(pid: string, action: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const x = xtreamOf(pid);
  if (!x) throw new IptvError('denied');
  return transport.json(xtreamApiUrl(x.login, action, params), { userAgent: x.record.userAgent, maxBytes: MAX_JSON_BYTES });
}

/** M3U: the films and series come with the channel list. */
async function m3uVodOf(pid: string) {
  if (!vodState().m3u[pid] && iptvState().data[pid]?.status !== 'ready') await ensureLoaded(pid);
  return vodState().m3u[pid] ?? null;
}

const inFlight = new Map<string, { job: Promise<void>; force: boolean }>();

/**
 * Runs `job` once per key at a time. A normal load joins whatever runs. A
 * forced load joins a forced one, and runs after a normal one: run side by
 * side, the normal load's saved copy could land after the fresh data and
 * replace it. So the newest data always lands last.
 */
function once(key: string, force: boolean, job: () => Promise<void>): Promise<void> {
  const running = inFlight.get(key);
  if (running && (running.force || !force)) return running.job;
  const start = running ? running.job.catch(() => undefined).then(job) : job();
  const entry = {
    job: start.finally(() => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    }),
    force,
  };
  inFlight.set(key, entry);
  return entry.job;
}

/**
 * The shared load rule: the memory copy, else the file (shown at once, and
 * loaded again in the background when stale), else the provider.
 */
async function loadInto<T>(opts: {
  section: 'categories' | 'lists' | 'all' | 'info';
  key: string;
  empty: Loaded<T>;
  path: string;
  pid: string;
  isData: (v: unknown) => v is T;
  fetch: () => Promise<T>;
  staleMs: number;
  force: boolean;
  toState?: (data: T) => unknown;
}): Promise<void> {
  const { section, key, empty, path, pid, isData, fetch, staleMs, force } = opts;
  const toState = opts.toState ?? ((d: T) => d);
  const get = () => (vodState()[section] as Record<string, Loaded<unknown>>)[key] as Loaded<unknown> | undefined;
  const set = (patch: Partial<Loaded<unknown>>) => patchVod(section, key, empty as never, patch as never);
  let current = get();
  if (!force && current && current.status !== 'idle' && current.status !== 'error') {
    // Shown and fresh, or loading: nothing to do. Stale in memory (the app stayed open a day): load it again behind the shown copy.
    const stale = current.status === 'ready' && !current.refreshing && Date.now() - current.savedAt > staleMs;
    if (!stale) return;
  }
  if (!force && (!current || current.status === 'idle')) {
    set({ status: 'loading', error: null });
    const saved = await readCache(path, pid, isData);
    if (saved) {
      set({ status: 'ready', data: toState(saved.data), savedAt: saved.savedAt, error: null });
      if (Date.now() - saved.savedAt <= staleMs) return;
    }
    current = get();
  }
  const shown = current?.status === 'ready';
  set(shown ? { refreshing: true, error: null } : { status: 'loading', error: null });
  try {
    const data = await fetch();
    const savedAt = await writeCache(path, pid, data);
    set({ status: 'ready', data: toState(data), savedAt, error: null, refreshing: false });
  } catch (e) {
    const text = iptvErrorText(e);
    // A refresh that fails keeps the saved copy; the error shows above it.
    set(get()?.status === 'ready' ? { refreshing: false, error: text } : { status: 'error', error: text, refreshing: false });
  }
}

// ---- Catalogues -------------------------------------------------------------------------

/** The categories of films or series. */
export function loadCategories(pid: string, kind: VodKind, force = false): Promise<void> {
  const key = catalogueKey(pid, kind);
  return once(`cats:${key}`, force, async () => {
    const record = providerById(pid);
    if (!record) return;
    if (record.kind === 'm3u') {
      const vod = await m3uVodOf(pid);
      const data = kind === 'film' ? (vod?.filmCategories ?? []) : (vod?.seriesCategories ?? []);
      patchVod('categories', key, EMPTY_CATEGORIES, { status: 'ready', data, error: null, savedAt: Date.now(), refreshing: false });
      return;
    }
    await loadInto<VodCategory[]>({
      section: 'categories',
      key,
      empty: EMPTY_CATEGORIES,
      path: catsPath(pid, kind),
      pid,
      isData: isNamedList,
      fetch: async () => parseVodCategories(await xtreamJson(pid, kind === 'film' ? 'get_vod_categories' : 'get_series_categories')),
      staleMs: STALE_CATALOGUE_MS,
      force,
    });
  });
}

function parseTitles(kind: VodKind, json: unknown): VodItem[] {
  return kind === 'film' ? parseVodStreams(json) : parseSeriesList(json);
}

/** The titles of one category (or `ALL_CATEGORY`). Uses the full catalogue when it is loaded. */
export function loadCategory(pid: string, kind: VodKind, categoryId: string, force = false): Promise<void> {
  if (categoryId === ALL_CATEGORY) return loadAll(pid, kind, force);
  const key = categoryKey(pid, kind, categoryId);
  return once(`list:${key}`, force, async () => {
    const record = providerById(pid);
    if (!record) return;
    const all = vodState().all[catalogueKey(pid, kind)];
    if (record.kind === 'm3u' || (!force && all?.status === 'ready')) {
      if (record.kind === 'm3u') await loadAll(pid, kind, false);
      const items = (vodState().all[catalogueKey(pid, kind)]?.data.items ?? []).filter((x) => x.categoryId === categoryId);
      patchVod('lists', key, EMPTY_LIST, { status: 'ready', data: items, error: null, savedAt: Date.now(), refreshing: false });
      return;
    }
    await loadInto<VodItem[]>({
      section: 'lists',
      key,
      empty: EMPTY_LIST,
      path: listPath(pid, kind, categoryId),
      pid,
      isData: isNamedList,
      fetch: async () => parseTitles(kind, await xtreamJson(pid, kind === 'film' ? 'get_vod_streams' : 'get_series', { category_id: categoryId })),
      staleMs: STALE_CATALOGUE_MS,
      force,
    });
  });
}

/** Every title of a kind, with a search index (a search, the "All" category). */
export function loadAll(pid: string, kind: VodKind, force = false): Promise<void> {
  const key = catalogueKey(pid, kind);
  return once(`all:${key}`, force, async () => {
    const record = providerById(pid);
    if (!record) return;
    if (record.kind === 'm3u') {
      const vod = await m3uVodOf(pid);
      const items: VodItem[] = kind === 'film' ? (vod?.films ?? []) : (vod?.series ?? []);
      const current = vodState().all[key];
      if (current?.status === 'ready' && current.data.items === items) return;
      patchVod('all', key, EMPTY_ALL, { status: 'ready', data: { items, index: buildTitleIndex(items) }, error: null, savedAt: Date.now(), refreshing: false });
      return;
    }
    await loadInto<VodItem[]>({
      section: 'all',
      key,
      empty: EMPTY_ALL as unknown as Loaded<VodItem[]>,
      path: listPath(pid, kind, ALL_CATEGORY),
      pid,
      isData: isNamedList,
      fetch: async () => parseTitles(kind, await xtreamJson(pid, kind === 'film' ? 'get_vod_streams' : 'get_series')),
      staleMs: STALE_CATALOGUE_MS,
      force,
      toState: (items) => ({ items, index: buildTitleIndex(items) }),
    });
  });
}

/** Loads the catalogue of a kind again: the categories and every category that has loaded. */
export async function refreshCatalogue(pid: string, kind: VodKind): Promise<void> {
  const record = providerById(pid);
  if (!record) return;
  if (record.kind === 'm3u') {
    // The films and series come with the channel list.
    await refresh(pid);
    const st = vodState();
    const drop = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith(`${pid}:${kind}`)));
    setVodState({ all: drop(st.all), lists: drop(st.lists) });
    await loadCategories(pid, kind, true);
    return;
  }
  const prefix = `${pid}:${kind}:`;
  const loaded = Object.keys(vodState().lists).filter((k) => k.startsWith(prefix));
  const jobs: Promise<void>[] = [loadCategories(pid, kind, true)];
  if (vodState().all[catalogueKey(pid, kind)]?.status === 'ready') jobs.push(loadAll(pid, kind, true));
  for (const k of loaded) jobs.push(loadCategory(pid, kind, k.slice(prefix.length), true));
  await Promise.all(jobs);
}

// ---- Details ------------------------------------------------------------------------------

export const findFilm = (pid: string, id: string) => findTitle(pid, 'film', id) as Film | null;
export const findSeries = (pid: string, id: string) => findTitle(pid, 'series', id) as Series | null;

/** A title from any loaded catalogue of the provider, or null. */
export function findTitle(pid: string, kind: VodKind, id: string): VodItem | null {
  const st = vodState();
  const fromAll = st.all[catalogueKey(pid, kind)]?.data.items.find((x) => x.id === id);
  if (fromAll) return fromAll;
  const prefix = `${pid}:${kind}:`;
  for (const [k, list] of Object.entries(st.lists)) {
    if (!k.startsWith(prefix)) continue;
    const hit = list.data.find((x) => x.id === id);
    if (hit) return hit;
  }
  const m3u = st.m3u[pid];
  if (m3u) return (kind === 'film' ? m3u.films : m3u.series).find((x) => x.id === id) ?? null;
  return null;
}

function isSeriesInfo(v: unknown): v is SeriesInfo {
  return isInfo<SeriesInfo>(v) && Array.isArray((v as { seasons?: unknown }).seasons);
}

/** The details of a film or a series. */
export function loadInfo(pid: string, kind: VodKind, id: string, force = false): Promise<void> {
  const key = infoKey(pid, kind, id);
  return once(`info:${key}`, force, async () => {
    const record = providerById(pid);
    if (!record) return;
    if (record.kind === 'm3u') {
      await m3uVodOf(pid);
      let data: VodInfo | null = null;
      if (kind === 'series') {
        const s = findSeries(pid, id);
        if (s) data = { seasons: seasonsFromEpisodes(s.episodes ?? []), ...(s.poster ? { poster: s.poster } : {}), ...(s.year ? { year: s.year } : {}) };
      } else {
        const f = findFilm(pid, id);
        if (f) data = { ...(f.ext ? { ext: f.ext } : {}) };
      }
      patchVod('info', key, EMPTY_INFO, data ? { status: 'ready', data, error: null, savedAt: Date.now() } : { status: 'error', data: null, error: 'This title is not in the list any more.' });
      return;
    }
    const name = findTitle(pid, kind, id)?.name;
    await loadInto<VodInfo>({
      section: 'info',
      key,
      empty: EMPTY_INFO as Loaded<VodInfo>,
      path: infoPath(pid, kind, id),
      pid,
      isData: kind === 'film' ? (v): v is VodInfo => isInfo<FilmInfo>(v) : isSeriesInfo,
      fetch: async () => {
        const json = await xtreamJson(pid, kind === 'film' ? 'get_vod_info' : 'get_series_info', kind === 'film' ? { vod_id: id } : { series_id: id });
        // A film with no details still plays: an empty answer is no details, not an error.
        const info = kind === 'film' ? (parseVodInfo(json) ?? {}) : parseSeriesInfo(json, name);
        if (!info) throw new IptvError('answer');
        return info;
      },
      staleMs: STALE_INFO_MS,
      force,
    });
  });
}

// ---- Favourites and positions --------------------------------------------------------------

export function vodListsOf(pid: string): VodLists {
  const st = vodState();
  const have = st.vodLists[pid];
  if (have) return have;
  const lists = loadVodLists(pid);
  setVodState({ vodLists: { ...st.vodLists, [pid]: lists } });
  return lists;
}

function setVodLists(pid: string, update: (l: VodLists) => VodLists): void {
  const current = vodListsOf(pid);
  const next = update(current);
  if (next === current) return;
  setVodState({ vodLists: { ...vodState().vodLists, [pid]: next } });
  saveVodLists(pid, next);
}

/** Adds or removes a favourite film or series. True when it is now a favourite. */
export function toggleFavouriteTitle(pid: string, item: { kind: VodKind; id: string; name: string; poster?: string }): boolean {
  setVodLists(pid, (l) => toggleVodFavourite(l, { kind: item.kind, id: item.id, name: item.name, ...(item.poster ? { poster: item.poster } : {}) }, Date.now()));
  return (vodState().vodLists[pid] ?? EMPTY_VOD_LISTS).favourites.some((f) => f.kind === item.kind && f.id === item.id);
}

/** Removes a title from Continue watching (its position goes). */
export function forgetPosition(pid: string, kind: 'film' | 'episode', id: string): void {
  setVodLists(pid, (l) => {
    const key = `${kind}:${id}`;
    if (!l.positions[key]) return l;
    const { [key]: _gone, ...positions } = l.positions;
    return { ...l, positions };
  });
}

// ---- Playing ----------------------------------------------------------------------------------

/** What the source needs to build a stream URL (kept out of the player state: an M3U URL can hold a token). */
interface Playable {
  ext?: string;
  url?: string;
  streamId?: number;
}

function sourceFor(pid: string, playables: Map<string, Playable>): VodSource {
  return {
    providerId: pid,
    async resolve(ref: VodRef) {
      const record = providerById(pid);
      const p = playables.get(`${ref.kind}:${ref.id}`) ?? {};
      if (!record) return { candidates: [], userAgent: null, unsupported: 'This provider was removed.' };
      if (record.kind === 'm3u') {
        if (!p.url) return { candidates: [], userAgent: null, unsupported: 'This title is not in the list any more.' };
        return m3uVodStream(p.url, streamPlatform, ref.kind, record.userAgent);
      }
      const login = xtreamLogin(record, readSecrets(pid));
      if (!login) return { candidates: [], userAgent: null, unsupported: 'Sign in to the provider again (Providers, Edit).' };
      return ref.kind === 'film'
        ? xtreamFilmStream({ id: ref.id, streamId: p.streamId, ext: p.ext }, login, streamPlatform, record.userAgent)
        : xtreamEpisodeStream({ id: ref.id, ext: p.ext }, login, streamPlatform, record.userAgent);
    },
    savePosition(ref, position, duration, ended) {
      setVodLists(pid, (l) =>
        withPosition(
          l,
          {
            kind: ref.kind,
            id: ref.id,
            position,
            duration,
            title: ref.title,
            ...(ref.poster ? { poster: ref.poster } : {}),
            ...(ref.seriesId ? { seriesId: ref.seriesId } : {}),
            ...(ref.seriesName ? { seriesName: ref.seriesName } : {}),
            ...(ref.season !== undefined ? { season: ref.season } : {}),
            ...(ref.episode !== undefined ? { episode: ref.episode } : {}),
            ...(playables.get(`${ref.kind}:${ref.id}`)?.ext ? { ext: playables.get(`${ref.kind}:${ref.id}`)?.ext } : {}),
          },
          Date.now(),
          ended,
        ),
      );
    },
  };
}

/** The play request for a film. */
export function filmRequest(pid: string, film: Film, info: FilmInfo | null, startSeconds: number): VodPlayRequest {
  const playables = new Map<string, Playable>([[`film:${film.id}`, { ext: info?.ext ?? film.ext, url: film.url, streamId: film.streamId }]]);
  const poster = film.poster ?? info?.poster ?? null;
  const ref: VodRef = { id: film.id, kind: 'film', title: film.name, poster, ...(film.year ?? info?.year ? { year: film.year ?? info?.year } : {}), ...(info?.duration ? { duration: info.duration } : {}) };
  return { items: [ref], index: 0, source: sourceFor(pid, playables), startSeconds };
}

/** The play request for an episode; Next plays the episodes after it, across seasons. */
export function episodeRequest(pid: string, series: Pick<Series, 'id' | 'name' | 'poster'>, episodes: readonly Episode[], episode: Episode, startSeconds: number): VodPlayRequest {
  const playables = new Map<string, Playable>();
  const items: VodRef[] = episodes.map((ep) => {
    playables.set(`episode:${ep.id}`, { ext: ep.ext, url: ep.url });
    return {
      id: ep.id,
      kind: 'episode',
      title: ep.title,
      poster: ep.still ?? series.poster ?? null,
      seriesId: series.id,
      seriesName: series.name,
      season: ep.season,
      episode: ep.number,
      ...(ep.duration ? { duration: ep.duration } : {}),
    };
  });
  const index = Math.max(0, episodes.findIndex((ep) => ep.id === episode.id));
  return { items, index, source: sourceFor(pid, playables), startSeconds };
}
