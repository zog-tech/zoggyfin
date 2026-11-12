/**
 * The player's external source for an extension's media: it turns a media
 * reference (`{ extension, mediaId, playback }`) into what the video
 * session plays (`ExternalSource` in `@/player`).
 *
 * Rules:
 * - Every request goes through the extension HTTP layer: the origin lock,
 *   the manifest's headers, the Jellyfin token only with the grant
 *   (`http.ts` `buildHeaders`). The stream, its playlists and its subtitle
 *   files get the same headers; the Jellyfin client is never used.
 * - The extension needs the `playback` permission and must be on.
 * - Error text never holds a URL or a token.
 * - Progress reports (`report.ts`) are sent and forgotten: an error is
 *   ignored, as for Jellyfin reports.
 *
 * Pure apart from the injected dependencies, so it is unit-tested.
 */
import type { ExternalPlayRequest, ExternalRef, ExternalSource, ExternalStream, MediaPlayRequest, SkipMode } from '@/player/types';

import { hasGrant } from '../grants';
import { buildHeaders, ExtensionError, FEED_TIMEOUT_MS, fetchWithTimeout, type JellyfinAccount, send } from '../http';
import { urlOnOrigin } from '../match';
import type { Manifest } from '../schema';
import type { InstalledExtension } from '../store';
import type { TemplateContext } from '../template';
import { parseStreamDescription, type StreamDescription } from './describe';
import { buildReport } from './report';

export interface ExtensionMediaDeps {
  /** The installed extension, or undefined. */
  extension(id: string): InstalledExtension | undefined;
  /** The signed-in account, for the token headers (with the grant). */
  account(): JellyfinAccount | null;
  /** The template context for the manifest's headers (settings, account facts). */
  context(ext: InstalledExtension): TemplateContext;
  /** Sends a request and reads JSON (`http.ts` `send`). */
  sendJson?: typeof send;
  /** fetch with a time limit (`http.ts` `fetchWithTimeout`). */
  fetch?: typeof fetchWithTimeout;
}

/** The item id prefix of extension media (downloads use the same form). */
export const mediaItemId = (extId: string, mediaId: string) => `ext:${extId}:${mediaId}`;

/** Error text with no URL in it; else the general text. */
export function safeText(e: unknown, fallback: string): string {
  const text = e instanceof ExtensionError || e instanceof Error ? e.message : '';
  return text && !/https?:|\/\/|token/i.test(text) ? text : fallback;
}

/** The request headers of the stream: the extension's headers with no `Accept` (the player sets its own). */
export function streamHeaders(m: Manifest, ctx: TemplateContext, ext: Pick<InstalledExtension, 'grants'>, account: JellyfinAccount | null): Record<string, string> {
  const h = buildHeaders(m, ctx, ext.grants, account);
  delete h.Accept;
  return h;
}

/** The mode of each skip label of the manifest until the user changes it. */
export function skipDefaults(m: Manifest): Record<string, SkipMode> {
  const out: Record<string, SkipMode> = {};
  for (const l of m.contributes.skipLabels ?? []) out[l.id] = l.default;
  return out;
}

/** The title of a segment label: the manifest's title, else the label with a capital letter. */
export function skipTitle(m: Manifest, label: string): string {
  const spec = m.contributes.skipLabels?.find((l) => l.id === label);
  return spec?.title ?? label.charAt(0).toUpperCase() + label.slice(1);
}

const isHls = (url: string) => {
  try {
    return /\.m3u8$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

const none = (unsupported: string): ExternalStream => ({ candidates: [], userAgent: null, unsupported });

/**
 * Why the extension cannot play, or null when it can. It needs the
 * `playback` permission in its manifest and the user's grant (`hasGrant`).
 */
export function playRefusal(ext: InstalledExtension | undefined): string | null {
  if (!ext) return 'This extension is not installed any more.';
  if (!ext.enabled) return 'This extension is off. Turn it on in Settings, Extensions.';
  if (!ext.manifest.permissions.includes('playback')) return 'This extension cannot play media.';
  if (!hasGrant(ext, 'playback')) return `Playback is turned off for ${ext.manifest.name}. Turn it on in Settings → Extensions.`;
  return null;
}

/** The player's stream from a stream description. `refs` learns the playback URL of the next entry. */
export function streamFromDescription(d: StreamDescription, m: Manifest, headers: Record<string, string>, refs: Map<string, string>, post: (url: string, body: unknown) => Promise<void>, mediaId: string): ExternalStream {
  const out: ExternalStream = {
    candidates: d.streams.map((s) => ({ url: s.url, isHls: s.type === 'hls' })),
    userAgent: null,
    unsupported: null,
    headers,
    live: d.live,
    qualities: d.qualities.map((q) => ({ id: q.id, label: q.label, url: q.url, isHls: isHls(q.url) })),
    subtitles: d.subtitles.map((s) => ({ id: s.id, label: s.label, language: s.language ?? null, url: s.url })),
    segments: d.segments.map((s) => ({ label: s.label, title: skipTitle(m, s.label), start: s.start, end: s.end })),
    chapters: d.chapters.map((c) => ({ title: c.title, start: c.start })),
    skip: { scope: m.id, defaults: skipDefaults(m) },
  };
  if (d.title) out.title = d.title;
  if (d.subtitle) out.subtitle = d.subtitle;
  if (d.imageUrl) out.artwork = d.imageUrl;
  if (d.duration !== undefined) out.duration = d.duration;
  if (d.resume !== undefined) out.resume = d.resume;
  const next = d.next;
  if (next?.media?.playback) {
    refs.set(next.media.id, next.media.playback);
    const ref: ExternalRef = { id: next.media.id, kind: 'film', title: next.title ?? 'Next', poster: next.imageUrl ?? null };
    if (next.subtitle) ref.subtitle = next.subtitle;
    if (next.media.duration) ref.duration = next.media.duration;
    out.next = ref;
  }
  const report = d.report;
  if (report) {
    out.progress = {
      intervalMs: report.intervalSeconds * 1000,
      send: (event, snap) =>
        post(report.url, buildReport({ event, mediaId, position: snap.position, duration: snap.duration || null, rate: snap.rate, quality: snap.quality })),
    };
  }
  return out;
}

/**
 * The external source of one extension. It knows the playback URL of each
 * media id it was given or met as a `next` entry.
 */
export function extensionSource(extId: string, deps: ExtensionMediaDeps, refs = new Map<string, string>()): ExternalSource {
  const sendJson = deps.sendJson ?? send;
  const fetchFn = deps.fetch ?? fetchWithTimeout;
  /** The headers of a request now: the settings or the grant may have changed since the last one. */
  const headersNow = (ext: InstalledExtension) => streamHeaders(ext.manifest, deps.context(ext), ext, deps.account());
  // The account that opened the title. After a switch, Try again, a quality
  // reload or the next entry would send the other account's headers: refuse.
  const keyOf = (a: JellyfinAccount | null) => (a ? `${a.serverId}.${a.userId}` : null);
  const owner = keyOf(deps.account());
  const otherAccount = () => keyOf(deps.account()) !== owner;
  return {
    providerId: `ext:${extId}`,
    label: deps.extension(extId)?.manifest.name,
    // A video's last seconds are content, not credits: no countdown before the end.
    nextAtEnd: true,
    itemId: (ref) => mediaItemId(extId, ref.id),
    async resolve(ref) {
      if (otherAccount()) return none('This title was opened by another account. Open it again.');
      const ext = deps.extension(extId);
      const why = playRefusal(ext);
      if (why || !ext) return none(why ?? 'This extension is not installed any more.');
      const m = ext.manifest;
      const playback = urlOnOrigin(m.baseUrl, refs.get(ref.id));
      if (!playback) return none('This title is not available any more.');
      const headers = headersNow(ext);
      let d: StreamDescription;
      try {
        const data = await sendJson({ url: playback, method: 'GET', headers: { ...headers, Accept: 'application/json' } }, FEED_TIMEOUT_MS);
        d = parseStreamDescription(data, m.baseUrl);
      } catch (e) {
        return none(safeText(e, 'The extension did not send a stream.'));
      }
      const post = async (url: string, body: unknown) => {
        // Only to the extension's origin (the description was checked; this is the last guard).
        if (!urlOnOrigin(m.baseUrl, url)) return;
        try {
          await fetchFn(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, FEED_TIMEOUT_MS);
        } catch {
          // A lost report is not worth a message; the next one carries the position.
        }
      };
      return streamFromDescription(d, m, headers, refs, post, ref.id);
    },
    async loadText(url) {
      if (otherAccount()) throw new ExtensionError('This title was opened by another account.');
      const ext = deps.extension(extId);
      if (playRefusal(ext) || !ext) throw new ExtensionError('This extension cannot play media.');
      const target = urlOnOrigin(ext.manifest.baseUrl, url);
      if (!target) throw new ExtensionError("The subtitles are not on the extension's server.");
      const res = await fetchFn(target, { method: 'GET', headers: { ...headersNow(ext), Accept: 'text/vtt, text/plain, */*' } }, FEED_TIMEOUT_MS);
      if (!res.ok) throw new ExtensionError(`The subtitles did not load (error ${res.status}).`, res.status);
      return res.text();
    },
  };
}

/**
 * The play request for an extension's media reference, or the reason it
 * cannot play (never a URL).
 */
export function mediaPlayRequest(req: MediaPlayRequest, deps: ExtensionMediaDeps): { request: ExternalPlayRequest } | { error: string } {
  const ext = deps.extension(req.extension);
  const why = playRefusal(ext);
  if (why || !ext) return { error: why ?? 'This extension is not installed any more.' };
  const playback = urlOnOrigin(ext.manifest.baseUrl, req.playback);
  if (!req.mediaId || !playback) return { error: 'This title cannot play.' };
  const refs = new Map([[req.mediaId, playback]]);
  const ref: ExternalRef = { id: req.mediaId, kind: 'film', title: req.title || ext.manifest.name, poster: req.image ?? null };
  if (req.subtitle) ref.subtitle = req.subtitle;
  if (req.duration) ref.duration = req.duration;
  const request: ExternalPlayRequest = { items: [ref], index: 0, source: extensionSource(req.extension, deps, refs) };
  if (req.startSeconds !== undefined) request.startSeconds = req.startSeconds;
  return { request };
}
