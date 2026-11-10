/**
 * Pure checks: which items an action shows on, which links a share target
 * takes, and the origin rule for extension requests.
 */
import type { When } from './schema';

export interface ItemFacts {
  type?: string | null;
  mediaType?: string | null;
  /** The name of the item's library, when known. */
  libraryName?: string | null;
  /** The file path on the server, when the extension may read it. */
  path?: string | null;
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * True when the item passes the filter. A field the filter names but the
 * item does not have (for example an unknown library) fails the match.
 */
export function matchesWhen(when: When | undefined, item: ItemFacts): boolean {
  if (!when) return true;
  if (when.types?.length && !when.types.includes(item.type ?? '')) return false;
  if (when.mediaTypes?.length && !when.mediaTypes.includes(item.mediaType ?? '')) return false;
  if (when.libraries?.length) {
    const lib = item.libraryName ? lower(item.libraryName) : null;
    if (!lib || !when.libraries.some((l) => lower(l) === lib)) return false;
  }
  if (when.pathPrefixes?.length) {
    const p = item.path ?? '';
    if (!p || !when.pathPrefixes.some((pre) => p.startsWith(pre))) return false;
  }
  return true;
}

/** The first http(s) link in some shared text, or null. */
export function findLink(text: string): string | null {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!m) return null;
  try {
    return new URL(m[0].replace(/[),.;!?]+$/, '')).toString();
  } catch {
    return null;
  }
}

/** True when the link's host is one of `hosts` or a subdomain of one. Empty `hosts`: any http(s) link. */
export function matchesHosts(link: string, hosts: readonly string[] | undefined): boolean {
  let host: string;
  try {
    const u = new URL(link);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hosts?.length) return true;
  return hosts.some((h) => {
    const want = lower(h).replace(/^\*\./, '');
    return host === want || host.endsWith(`.${want}`);
  });
}

export class OriginError extends Error {
  constructor(url: string, origin: string) {
    super(`The extension asked for ${url}, which is not on ${origin}.`);
    this.name = 'OriginError';
  }
}

/**
 * Resolves a path or URL against the extension's base URL. The result must
 * have the same origin (scheme, host and port) as the base URL.
 */
export function resolveOnOrigin(baseUrl: string, pathOrUrl: string): URL {
  const base = new URL(baseUrl);
  // "/api/x" goes under the base path too: "http://h/ext" + "/api/x" = "http://h/ext/api/x".
  const basePath = base.pathname.replace(/\/+$/, '');
  let u: URL;
  try {
    u = /^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith('//')
      ? new URL(pathOrUrl, base.origin)
      : new URL(`${basePath}/${pathOrUrl.replace(/^\/+/, '')}`, base.origin);
  } catch {
    throw new OriginError(pathOrUrl, base.origin);
  }
  if (u.origin !== base.origin) throw new OriginError(u.toString(), base.origin);
  return u;
}

/**
 * The full URL of a path or URL from an extension's reply, or undefined when
 * it is empty or not on the extension's origin. Replies use it for every
 * URL, so a value on another origin is left out, never followed.
 */
export function urlOnOrigin(baseUrl: string, pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  try {
    return resolveOnOrigin(baseUrl, pathOrUrl).toString();
  } catch {
    return undefined;
  }
}

/**
 * The manifest URLs to try for what the user typed. A full manifest URL is
 * used as it is. A site address ("host:port" or "http://host/") also gets
 * `/zoggyfin-extension.json` at its end.
 */
export function manifestCandidates(input: string): string[] {
  let raw = input.trim();
  if (!raw) return [];
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return [];
  }
  if (/\.json$/i.test(u.pathname)) return [u.toString()];
  const base = u.toString().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return [`${base}/zoggyfin-extension.json`, `${base}/.well-known/zoggyfin-extension.json`];
}
