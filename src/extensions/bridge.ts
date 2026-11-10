/**
 * The panel bridge. A panel page sends
 * `{ zoggyfin: 1, id, method, params }` with postMessage; the app answers
 * `{ zoggyfin: 1, id, result }` or `{ zoggyfin: 1, id, error }`. These
 * methods (`BRIDGE_METHODS`) are all a panel can do in the app.
 *
 * The schema version 2 methods keep the rules of the native paths:
 * - `playMedia`: the `playback` URL must be on the extension's origin, and
 *   the extension needs the `playback` permission and the user's grant
 *   (`playRefusal`). A picture on another origin is left out.
 * - `openEntry`: the `detail` URL must be on the extension's origin.
 * - `openPage`: the page must be one of the manifest's pages. The app loads
 *   the extension's feeds again first, so the page shows what the panel changed.
 * - `refreshPage`: loads the feeds of this extension only (its pages, Home
 *   rows and search results), not the rest of the app.
 * - `openExternal`: an `https` URL with no user name or password, opened in
 *   the system browser, with no confirm (as a feed card's `link` and a
 *   `target="_blank"` link in a web panel). It needs the `network`
 *   permission, which every extension has. The answer is `{ opened }`.
 * Panels are not on TV, so these methods are never the only way to content.
 *
 * Pure, so it is unit-tested.
 */
import { urlOnOrigin } from './match';

export const BRIDGE_METHODS = ['getContext', 'play', 'openItem', 'refreshLibrary', 'toast', 'close', 'playMedia', 'openEntry', 'openPage', 'refreshPage', 'openExternal'] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export interface BridgeRequest {
  id: number | string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export interface BridgeReply {
  zoggyfin: 1;
  id: number | string;
  result?: unknown;
  error?: string;
}

export interface BridgeDeps {
  context(): unknown;
  play(itemId: string): Promise<void> | void;
  openItem(itemId: string): Promise<void> | void;
  refreshLibrary(): void;
  toast(text: string): void;
  close(): void;
  /** The extension's `baseUrl`: the origin rule of `playMedia` and `openEntry`. */
  baseUrl: string;
  /** Why the extension cannot play media now (no permission, grant off), or null. */
  playRefusal(): string | null;
  /** Plays a media reference; `playback` and `image` are full URLs on the origin. */
  playMedia(media: BridgeMedia): Promise<void> | void;
  /** Opens an entry page; `detail` is a full URL on the origin. */
  openEntry(entry: { detail: string; title?: string }): void;
  /** True when the manifest has this page. */
  hasPage(pageId: string): boolean;
  openPage(pageId: string): void;
  /** Loads the feeds of this extension again. */
  refreshPage(): void;
  /** True when the extension has the `network` permission. */
  hasNetwork(): boolean;
  /** Opens a checked `https` URL in the system browser; true when it opened. */
  openExternal(url: string): Promise<boolean> | boolean;
}

export interface BridgeMedia {
  mediaId: string;
  playback: string;
  title?: string;
  image?: string;
}

/** Reads a message (an object or a JSON string). Returns null for anything that is not a bridge request. */
export function readBridgeMessage(raw: unknown): BridgeRequest | null {
  let data = raw;
  if (typeof raw === 'string') {
    if (raw.length > 10_000) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { zoggyfin?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (d.zoggyfin !== 1) return null;
  if (typeof d.id !== 'number' && typeof d.id !== 'string') return null;
  if (typeof d.method !== 'string' || !(BRIDGE_METHODS as readonly string[]).includes(d.method)) return null;
  const params = d.params && typeof d.params === 'object' && !Array.isArray(d.params) ? (d.params as Record<string, unknown>) : {};
  return { id: d.id, method: d.method as BridgeMethod, params };
}

/** True when a message comes from the extension's own origin. */
export function sameOrigin(url: string | null | undefined, baseUrl: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

const idParam = (p: Record<string, unknown>) => {
  const v = p.itemId;
  if (typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(v)) throw new Error('itemId is not valid');
  return v;
};

const textParam = (p: Record<string, unknown>, key: string, max: number): string | undefined => {
  const v = p[key];
  return typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;
};

/** A URL param on the extension's origin; the error names the param, never the URL. */
const onOrigin = (p: Record<string, unknown>, key: string, baseUrl: string): string => {
  const url = urlOnOrigin(baseUrl, textParam(p, key, 1000));
  if (!url) throw new Error(`${key} must be on the extension's origin`);
  return url;
};

/** Reads `playMedia` params. Throws for a bad id or a playback URL on another origin. */
export function readMediaParams(p: Record<string, unknown>, baseUrl: string): BridgeMedia {
  const mediaId = textParam(p, 'mediaId', 200);
  if (!mediaId) throw new Error('mediaId is required');
  const out: BridgeMedia = { mediaId, playback: onOrigin(p, 'playback', baseUrl) };
  const title = textParam(p, 'title', 200);
  if (title) out.title = title;
  const image = urlOnOrigin(baseUrl, textParam(p, 'image', 1000));
  if (image) out.image = image;
  return out;
}

export const MAX_EXTERNAL_URL = 2000;

/**
 * Reads the `url` of `openExternal`: `https` only, no user name or password,
 * 2000 characters at most. Throws an error that never holds the URL.
 */
export function readExternalUrl(p: Record<string, unknown>): string {
  const raw = p.url;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_EXTERNAL_URL) throw new Error('url is required');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('url is not valid');
  }
  if (u.protocol !== 'https:') throw new Error('url must use https');
  if (u.username || u.password) throw new Error('url must not hold a user name or a password');
  if (!u.hostname) throw new Error('url is not valid');
  return u.toString();
}

/** Runs one request and builds the reply. */
export async function handleBridgeRequest(req: BridgeRequest, deps: BridgeDeps): Promise<BridgeReply> {
  try {
    let result: unknown = true;
    switch (req.method) {
      case 'getContext':
        result = deps.context();
        break;
      case 'play':
        await deps.play(idParam(req.params));
        break;
      case 'openItem':
        await deps.openItem(idParam(req.params));
        break;
      case 'refreshLibrary':
        deps.refreshLibrary();
        break;
      case 'toast': {
        const text = req.params.text;
        if (typeof text !== 'string' || !text.trim()) throw new Error('text is required');
        deps.toast(text.slice(0, 200));
        break;
      }
      case 'close':
        deps.close();
        break;
      case 'playMedia': {
        const media = readMediaParams(req.params, deps.baseUrl);
        const why = deps.playRefusal();
        if (why) throw new Error(why);
        await deps.playMedia(media);
        break;
      }
      case 'openEntry': {
        const detail = onOrigin(req.params, 'detail', deps.baseUrl);
        const title = textParam(req.params, 'title', 200);
        deps.openEntry(title ? { detail, title } : { detail });
        break;
      }
      case 'openPage': {
        const page = textParam(req.params, 'page', 64);
        if (!page || !deps.hasPage(page)) throw new Error('page is not a page of this extension');
        deps.openPage(page);
        break;
      }
      case 'refreshPage':
        deps.refreshPage();
        break;
      case 'openExternal': {
        const url = readExternalUrl(req.params);
        if (!deps.hasNetwork()) throw new Error('The extension has no network permission');
        result = { opened: await deps.openExternal(url) };
        break;
      }
    }
    return { zoggyfin: 1, id: req.id, result };
  } catch (e) {
    return { zoggyfin: 1, id: req.id, error: e instanceof Error ? e.message : 'Failed' };
  }
}
