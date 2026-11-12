/**
 * Requests to an extension. Every request goes to the manifest's origin
 * only, has a time limit, and never throws past the caller's error toast.
 */
import { resolveOnOrigin } from './match';
import type { Manifest, RequestSpec } from './schema';
import { render, renderJson, type TemplateContext } from './template';

export const ACTION_TIMEOUT_MS = 15_000;
export const FEED_TIMEOUT_MS = 8_000;

export class ExtensionError extends Error {
  status?: number;
  /** True when no answer came at all (no connection, or a browser refused the request, for example by CORS); not a time-out. */
  unreachable?: boolean;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ExtensionError';
    this.status = status;
  }
}

/** What the user allowed this extension to receive. */
export interface Grants {
  itemPath: boolean;
  jellyfinToken: boolean;
  /** Schema version 2: the app may play the extension's media. */
  playback: boolean;
  /** Schema version 2: the app may save the extension's files on the device. */
  downloads: boolean;
}

/** The signed-in account, for the token headers. */
export interface JellyfinAccount {
  serverUrl: string;
  serverId: string;
  userId: string;
  userName: string;
  token: string;
}

/**
 * Headers for every request: the manifest's own headers (templates), then,
 * only when the user allowed `jellyfinToken`, the user's Jellyfin token and
 * server. The extension can check the token against its own Jellyfin server.
 */
export function buildHeaders(m: Manifest, ctx: TemplateContext, grants: Grants, account: JellyfinAccount | null): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  for (const [k, v] of Object.entries(m.headers ?? {})) {
    const value = render(v, ctx).trim();
    if (value) h[k] = value;
  }
  if (grants.jellyfinToken && m.permissions.includes('jellyfinToken') && account) {
    h.Authorization = `MediaBrowser Token="${account.token}"`;
    h['X-Emby-Token'] = account.token;
    h['X-Jellyfin-Server-Url'] = account.serverUrl;
    h['X-Jellyfin-Server-Id'] = account.serverId;
    h['X-Jellyfin-User-Id'] = account.userId;
  }
  return h;
}

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Fills the request templates and checks the origin. Throws `OriginError` for another origin. */
export function buildRequest(
  m: Manifest,
  spec: Pick<RequestSpec, 'method' | 'path' | 'query' | 'body'>,
  ctx: TemplateContext,
  grants: Grants,
  account: JellyfinAccount | null,
): BuiltRequest {
  const safe = grants.itemPath ? ctx : withoutPath(ctx);
  const url = resolveOnOrigin(m.baseUrl, render(spec.path, safe, encodeURIComponent));
  for (const [k, v] of Object.entries(spec.query ?? {})) url.searchParams.set(k, render(v, safe));
  const headers = buildHeaders(m, safe, grants, account);
  const method = spec.method ?? 'POST';
  let body: string | undefined;
  if (spec.body && method !== 'GET') {
    body = JSON.stringify(renderJson(spec.body, safe));
    headers['Content-Type'] = 'application/json';
  }
  return { url: url.toString(), method, headers, body };
}

function withoutPath(ctx: TemplateContext): TemplateContext {
  if (!ctx.item || !('path' in ctx.item)) return ctx;
  const { path: _path, ...item } = ctx.item;
  return { ...ctx, item };
}

/** fetch with a time limit. */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new ExtensionError('The extension did not answer in time.');
    const err = new ExtensionError(e instanceof Error && e.message ? `Cannot reach the extension (${e.message}).` : 'Cannot reach the extension.');
    err.unreachable = true;
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Sends a built request and reads the JSON answer. An error status throws with the server's `error` text. */
export async function send(req: BuiltRequest, ms = ACTION_TIMEOUT_MS): Promise<unknown> {
  const res = await fetchWithTimeout(req.url, { method: req.method, headers: req.headers, body: req.body }, ms);
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : `The extension answered with error ${res.status}.`;
    throw new ExtensionError(msg.slice(0, 200), res.status);
  }
  return data;
}

/** Reads choice options: `{ "options": [{ value, label }] }`, a list of those, or a list of strings. */
export function parseOptions(data: unknown): { value: string; label: string }[] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { options?: unknown }).options) ? (data as { options: unknown[] }).options : null;
  if (!list) throw new ExtensionError('The extension sent a list in a format the app cannot read.');
  const out: { value: string; label: string }[] = [];
  for (const o of list.slice(0, 200)) {
    if (typeof o === 'string') out.push({ value: o, label: o });
    else if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') {
      const v = (o as { value: string; label?: unknown }).value;
      const l = (o as { label?: unknown }).label;
      out.push({ value: v, label: typeof l === 'string' && l ? l : v });
    }
  }
  return out;
}
