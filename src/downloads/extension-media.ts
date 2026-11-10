/**
 * Downloads of an extension's media: the rules of the second record source
 * (`source.kind === 'extension'`). The manager does the transfer; this file
 * decides who may download, which file to save, which headers go with it,
 * what the record holds and how a saved file plays with no connection.
 *
 * Rules:
 * - The extension must be installed for the signed-in account, turned on,
 *   and have the `downloads` grant (`hasGrant`). The plain web build and TV
 *   have no downloads (`features.downloads`).
 * - Every URL (the description, the file, the subtitles, the image, the
 *   report) must be on the extension's origin. The description refuses an
 *   `.m3u8` file: one progressive file only.
 * - The file request gets the extension's headers (`streamHeaders`): the
 *   manifest's headers, and the Jellyfin token headers only with the
 *   `jellyfinToken` grant. Never the Jellyfin `Authorization` header that a
 *   Jellyfin download sends.
 * - A description with `options` needs a choice first (`extensionDownloadOptions`).
 * - A file URL can expire: a transfer that fails with 401, 403, 404 or 410
 *   asks the description again once (`isExpiredStatus`).
 * - Record ids are `ext:<extId>:<mediaId>`, so they never match a Jellyfin id.
 * - Error text never holds a URL or a token (`safeText`).
 *
 * Pure apart from the injected dependencies, so it is unit-tested.
 */
import type { ExtensionMediaDeps } from '@/extensions/media';
import { parseDownloadDescription, type DownloadDescription, type DownloadOption } from '@/extensions/media/download';
import { reportSender } from '@/extensions/media/outbox';
import { buildReport, type ReportEvent } from '@/extensions/media/report';
import { parseStreamDescription } from '@/extensions/media/describe';
import { mediaItemId, safeText, streamHeaders } from '@/extensions/media/source';
import { hasGrant } from '@/extensions/grants';
import { ExtensionError, FEED_TIMEOUT_MS, send } from '@/extensions/http';
import { urlOnOrigin } from '@/extensions/match';
import type { InstalledExtension } from '@/extensions/types';
import { accountKey } from '@/extensions/types';
import type { ExternalPlayRequest, ExternalRef, ExternalSource, ExternalStream } from '@/player/types';

import { fileUri, localImageUri } from './local';
import { extensionOf, type MediaPlan } from './plan';
import { fraction } from './state-machine';
import { DOWNLOAD_SCHEMA_VERSION, type DownloadRecord, type ExtensionDownloadSource, type LocalSubtitle } from './types';

export type { DownloadOption } from '@/extensions/media/download';

/** The dependencies of extension downloads: the installed extensions, the account and the requests. */
export type ExtensionDownloadDeps = ExtensionMediaDeps;

/** What a screen passes to download an extension's media entry. */
export interface ExtensionDownloadInput {
  /** The extension's manifest id. */
  extension: string;
  /** `media.id`. */
  mediaId: string;
  /** `media.download`: the download description, a full URL on the extension's origin. */
  download: string;
  /** The entry's title, shown in the Downloads tab and the player. */
  title: string;
  subtitle?: string;
  /** The entry's image (`imageUrl`); saved on the device for offline display. */
  image?: string;
  /** Seconds. */
  duration?: number;
  /** The id of the chosen option, when `extensionDownloadOptions` gave a list. */
  option?: string;
  /** `media.playback`, when the entry has one: the app learns the report URL from it. */
  playback?: string;
  /** `media.kind`; `audio` lists with songs' words. Default `video`. */
  kind?: 'video' | 'audio';
}

const ROOT = 'downloads';

/** The record id of an extension's media: `ext:<extId>:<mediaId>` (the same id the player uses). */
export function extensionRecordId(extId: string, mediaId: string): string {
  return mediaItemId(extId, mediaId);
}

/** True for a record of an extension's media. */
export function isExtensionRecord(r: Pick<DownloadRecord, 'source'>): r is DownloadRecord & { source: ExtensionDownloadSource } {
  return r.source?.kind === 'extension';
}

/** A short hash (FNV-1a, base 36), so two ids that clean to the same folder name stay apart. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The folder of an extension download: `downloads/ext-<safe id>-<hash>`.
 * A media id can hold any character; a folder name keeps only safe ones.
 */
export function extensionDir(extId: string, mediaId: string): string {
  const id = extensionRecordId(extId, mediaId);
  const safe = `${extId}-${mediaId}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  return `${ROOT}/ext-${safe}-${hash(id)}`;
}

/** Why this extension cannot download now, or null when it can. Never holds a URL. */
export function downloadRefusal(ext: InstalledExtension | undefined, supported: boolean): string | null {
  if (!supported) return 'Downloads are not available here. Use the iPhone, iPad, Android or Mac app.';
  if (!ext) return 'This extension is not installed any more.';
  if (!ext.enabled) return 'This extension is off. Turn it on in Settings, Extensions.';
  if (!ext.manifest.permissions.includes('downloads')) return 'This extension cannot save files on the device.';
  if (!hasGrant(ext, 'downloads')) return 'Downloads are off for this extension. Turn them on in Settings, Extensions.';
  return null;
}

/** HTTP statuses of a file URL that is no longer valid: ask the description for a new one. */
export function isExpiredStatus(code: number): boolean {
  return code === 401 || code === 403 || code === 404 || code === 410;
}

/** The headers of a request to the extension now (the settings or the grant may have changed). */
export function extensionHeaders(ext: InstalledExtension, deps: ExtensionDownloadDeps): Record<string, string> {
  return streamHeaders(ext.manifest, deps.context(ext), ext, deps.account());
}

/** Reads a download description from a URL on the extension's origin. Throws `ExtensionError` with no URL. */
async function readDescription(ext: InstalledExtension, url: string, deps: ExtensionDownloadDeps): Promise<DownloadDescription> {
  const target = urlOnOrigin(ext.manifest.baseUrl, url);
  if (!target) throw new ExtensionError("This download is not on the extension's server.");
  const sendJson = deps.sendJson ?? send;
  const data = await sendJson({ url: target, method: 'GET', headers: { ...extensionHeaders(ext, deps), Accept: 'application/json' } }, FEED_TIMEOUT_MS);
  return parseDownloadDescription(data, ext.manifest.baseUrl);
}

/** The installed extension that may download, or throws with the reason. */
function allowed(extId: string, deps: ExtensionDownloadDeps, supported: boolean): InstalledExtension {
  const ext = deps.extension(extId);
  const why = downloadRefusal(ext, supported);
  if (why || !ext) throw new ExtensionError(why ?? 'This extension is not installed any more.');
  return ext;
}

/**
 * The choices of a download description (`options`), for a quality picker.
 * Empty: the description names one file, so no choice is needed.
 */
export async function downloadOptions(extId: string, download: string, deps: ExtensionDownloadDeps, supported: boolean): Promise<DownloadOption[]> {
  const ext = allowed(extId, deps, supported);
  try {
    return (await readDescription(ext, download, deps)).options;
  } catch (e) {
    throw new ExtensionError(safeText(e, 'The extension did not send a download.'));
  }
}

/** The file to save: its description (after the option choice) and the request headers. */
export interface ResolvedFile {
  description: DownloadDescription & { url: string };
  headers: Record<string, string>;
  /** The quality label: the file's own, else the chosen option's. */
  label?: string;
}

/**
 * Asks the extension which file to save now. With `option`, the chosen
 * option's own description names the file. With no option and only options
 * in the reply, the user must choose first.
 */
export async function resolveFile(source: Pick<ExtensionDownloadSource, 'extId' | 'download' | 'option'>, deps: ExtensionDownloadDeps, supported: boolean): Promise<ResolvedFile> {
  const ext = allowed(source.extId, deps, supported);
  try {
    let d = await readDescription(ext, source.download, deps);
    let label = d.label;
    if (source.option) {
      const choice = d.options.find((o) => o.id === source.option);
      if (choice) {
        d = await readDescription(ext, choice.download, deps);
        label = d.label ?? choice.label;
      } else if (!d.url) throw new ExtensionError('This quality is not offered any more. Choose another one.');
    }
    if (!d.url) throw new ExtensionError('Choose a quality first.');
    const out: ResolvedFile = { description: { ...d, url: d.url }, headers: extensionHeaders(ext, deps) };
    if (label) out.label = label;
    return out;
  } catch (e) {
    throw new ExtensionError(safeText(e, 'The extension did not send a download.'), e instanceof ExtensionError ? e.status : undefined);
  }
}

/** The file's name in the record's folder: `media.<container>`, else the URL's extension, else `media.mp4`. */
export function mediaFileName(d: Pick<DownloadDescription, 'container' | 'url'>): string {
  let fromUrl: string | undefined;
  try {
    fromUrl = d.url ? /\.([a-z0-9]{2,5})$/i.exec(new URL(d.url).pathname)?.[1] : undefined;
  } catch {
    fromUrl = undefined;
  }
  return `media.${extensionOf(d.container ?? fromUrl, 'mp4')}`;
}

/** The transfer plan of an extension file: always the original file, so a stop can continue with Range. */
export function extensionPlan(id: string, f: ResolvedFile): MediaPlan {
  return { url: f.description.url, method: 'original', file: mediaFileName(f.description), mediaSourceId: id, expectedBytes: f.description.bytes ?? null };
}

/**
 * A new queued record for an extension's media. `account` is the signed-in
 * account; only it lists, plays and continues the download.
 */
export function newExtensionRecord(input: ExtensionDownloadInput, ctx: { serverId: string; userId: string; baseUrl: string; kind: 'video' | 'audio'; order: number; now: number }): DownloadRecord {
  const id = extensionRecordId(input.extension, input.mediaId);
  const source: ExtensionDownloadSource = {
    kind: 'extension',
    extId: input.extension,
    mediaId: input.mediaId,
    account: accountKey(ctx),
    download: input.download,
    title: input.title || 'Download',
  };
  if (input.option) source.option = input.option;
  if (input.subtitle) source.subtitle = input.subtitle;
  const image = urlOnOrigin(ctx.baseUrl, input.image);
  if (image) source.imageUrl = image;
  if (input.duration && input.duration > 0) source.duration = input.duration;
  const playback = urlOnOrigin(ctx.baseUrl, input.playback);
  if (playback) source.playback = playback;
  return {
    schemaVersion: DOWNLOAD_SCHEMA_VERSION,
    itemId: id,
    source,
    serverId: ctx.serverId,
    userId: ctx.userId,
    kind: ctx.kind,
    item: extensionItem(id, source, ctx.kind),
    group: { id: `ext:${input.extension}`, name: input.extension, type: 'Single' },
    sort: 0,
    state: 'queued',
    bytesTotal: null,
    bytesDone: 0,
    speed: 0,
    progressAt: null,
    attempts: 0,
    retryAt: null,
    error: null,
    dir: extensionDir(input.extension, input.mediaId),
    mediaFile: '',
    mediaSourceId: id,
    method: 'original',
    quality: 0,
    images: {},
    subtitles: [],
    hasLyrics: false,
    order: ctx.order,
    createdAt: ctx.now,
    completedAt: null,
  };
}

/** The slim item the rows and the player show for an extension download (no Jellyfin facts). */
export function extensionItem(id: string, s: Pick<ExtensionDownloadSource, 'title' | 'subtitle' | 'duration'>, kind: 'video' | 'audio'): DownloadRecord['item'] {
  const item: DownloadRecord['item'] = { Id: id, Name: s.title, Type: kind === 'audio' ? 'Audio' : 'Video', MediaType: kind === 'audio' ? 'Audio' : 'Video' };
  if (s.subtitle) item.Overview = s.subtitle;
  if (s.duration) item.RunTimeTicks = Math.round(s.duration * 10_000_000);
  return item;
}

/** The record facts after the description answered: the file, the size and the label. */
export function withResolvedFile(r: DownloadRecord, f: ResolvedFile, plan: MediaPlan): DownloadRecord {
  if (!isExtensionRecord(r)) return r;
  const source: ExtensionDownloadSource = { ...r.source };
  if (f.description.container) source.container = f.description.container;
  if (f.description.bytes) source.bytes = f.description.bytes;
  if (f.label) source.label = f.label;
  // The description's image is the better one; the entry's image stays the fallback.
  if (f.description.imageUrl) source.imageUrl = f.description.imageUrl;
  return { ...r, source, mediaFile: plan.file, method: 'original', mediaSourceId: plan.mediaSourceId, bytesTotal: r.bytesTotal ?? plan.expectedBytes };
}

/** The subtitle files to save next to the media: `subtitle-<n>.vtt`. */
export function subtitleTargets(d: Pick<DownloadDescription, 'subtitles'>): { url: string; sub: LocalSubtitle }[] {
  return d.subtitles.map((s, index) => ({
    url: s.url,
    sub: { index, label: s.label, language: s.language ?? null, isDefault: false, isForced: false, file: `subtitle-${index}.vtt` },
  }));
}

/** The report URL of the stream description, so offline play can report. Null when there is none. */
export async function learnReport(ext: InstalledExtension, playback: string, deps: ExtensionDownloadDeps): Promise<ExtensionDownloadSource['report'] | null> {
  const target = urlOnOrigin(ext.manifest.baseUrl, playback);
  if (!target) return null;
  try {
    const sendJson = deps.sendJson ?? send;
    const data = await sendJson({ url: target, method: 'GET', headers: { ...extensionHeaders(ext, deps), Accept: 'application/json' } }, FEED_TIMEOUT_MS);
    const d = parseStreamDescription(data, ext.manifest.baseUrl);
    return d.report ? { url: d.report.url, intervalSeconds: d.report.intervalSeconds } : null;
  } catch {
    return null;
  }
}

// ---- State for a button -------------------------------------------------------------

/** What a download button shows for an extension's media entry. */
export type ExtensionMediaState =
  | { state: 'none' }
  | { state: 'queued' }
  | { state: 'downloading' | 'paused'; progress: number }
  | { state: 'done' }
  | { state: 'failed'; error: string };

/** The state of one extension media entry for an account; another account's download is `none`. */
export function extensionMediaState(records: Record<string, DownloadRecord>, extId: string, mediaId: string, account: string | null): ExtensionMediaState {
  const r = records[extensionRecordId(extId, mediaId)];
  if (!r || !account || !isExtensionRecord(r) || r.source.account !== account || r.state === 'cancelled') return { state: 'none' };
  switch (r.state) {
    case 'completed':
      return { state: 'done' };
    case 'queued':
      return { state: 'queued' };
    case 'failed':
      return { state: 'failed', error: r.error ?? 'The download stopped' };
    default:
      // Whole percent, so a button re-renders once per percent at most.
      return { state: r.state, progress: Math.round(fraction(r) * 100) / 100 };
  }
}

// ---- Offline play -------------------------------------------------------------------

/** A report that could not go now: `stop` and `finished` wait in the extension outbox. */
export interface QueuedReport {
  extId: string;
  url: string;
  body: ReturnType<typeof buildReport>;
}

/** What local play of an extension download needs from the app. */
export interface LocalPlayDeps extends ExtensionDownloadDeps {
  /** Saves where the user stopped (seconds; null: played to the end). */
  savePosition(recordId: string, position: number | null): void;
  /** Keeps a `stop` or `finished` report for later (`extensions/media/outbox.ts`). */
  queueReport(account: string, report: QueuedReport): void;
}

const FINAL: readonly ReportEvent[] = ['stop', 'finished'];

/** The local files of a completed extension download, for the player. Null when it is not on the device. */
export function localStream(r: DownloadRecord, documentsDir: string | null): ExternalStream | null {
  if (!isExtensionRecord(r) || r.state !== 'completed' || !r.mediaFile || !documentsDir) return null;
  const s = r.source;
  const out: ExternalStream = {
    candidates: [{ url: fileUri(documentsDir, `${r.dir}/${r.mediaFile}`), isHls: false }],
    userAgent: null,
    unsupported: null,
    title: s.title,
    subtitles: r.subtitles.map((x) => ({ id: String(x.index), label: x.label, language: x.language, url: fileUri(documentsDir, `${r.dir}/${x.file}`) })),
  };
  if (s.subtitle) out.subtitle = s.subtitle;
  // The lock screen loads only http art; the player's own art comes from the local copy (`useLocalImage`).
  if (s.imageUrl) out.artwork = s.imageUrl;
  if (s.duration) out.duration = s.duration;
  if (s.position && s.position > 0) out.resume = s.position;
  return out;
}

/**
 * The player's request for a completed extension download: the external
 * path with the local file. No network is needed to play. Reports go to the
 * extension when it answers; `stop` and `finished` that cannot go wait in
 * the outbox. The position is kept on the device.
 */
export function localPlayRequest(r: DownloadRecord, documentsDir: string | null, deps: LocalPlayDeps, startSeconds?: number): ExternalPlayRequest | null {
  const stream = localStream(r, documentsDir);
  if (!stream || !isExtensionRecord(r)) return null;
  const s = r.source;
  const ref: ExternalRef = { id: s.mediaId, kind: 'film', title: s.title, poster: s.imageUrl ?? null };
  if (s.subtitle) ref.subtitle = s.subtitle;
  if (s.duration) ref.duration = s.duration;
  const report = s.report;
  if (report) {
    stream.progress = {
      intervalMs: report.intervalSeconds * 1000,
      send: async (event, snap) => {
        const body = buildReport({ event, mediaId: s.mediaId, position: snap.position, duration: snap.duration || null, rate: snap.rate, quality: s.label ?? null, offline: true });
        const sent = await postReport(s.extId, report.url, body, deps);
        if (!sent && FINAL.includes(event)) deps.queueReport(s.account, { extId: s.extId, url: report.url, body });
      },
    };
  }
  const source: ExternalSource = {
    providerId: `ext:${s.extId}`,
    label: deps.extension(s.extId)?.manifest.name ?? 'Download',
    itemId: (x) => extensionRecordId(s.extId, x.id),
    resolve: async () => stream,
    savePosition: (_ref, position, duration, ended) => deps.savePosition(r.itemId, ended || (duration > 0 && position >= duration - 5) ? null : position),
  };
  const request: ExternalPlayRequest = { items: [ref], index: 0, source };
  if (startSeconds !== undefined) request.startSeconds = startSeconds;
  return request;
}

/** Sends one report now. True when the extension answered (any status but 5xx). */
export function postReport(extId: string, url: string, body: ReturnType<typeof buildReport>, deps: ExtensionDownloadDeps): Promise<boolean> {
  return reportSender(deps)({ extId, url, body, at: 0 });
}

/** The local image of an extension download, as a URI, or null. */
export function extensionImage(r: DownloadRecord, documentsDir: string | null): string | null {
  return localImageUri(r, documentsDir, 'poster') ?? (isExtensionRecord(r) ? (r.source.imageUrl ?? null) : null);
}
