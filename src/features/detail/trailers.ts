/**
 * Trailers of a movie or a show: the trailer files on the server ("local",
 * they play in the app's player) and the trailer links from the metadata
 * ("remote", usually YouTube, they open outside the app). Pure, so it is
 * unit-tested.
 */
import type { BaseItemDto } from '@/api/types';

export type Trailer =
  | { kind: 'local'; key: string; label: string; item: BaseItemDto }
  | { kind: 'remote'; key: string; label: string; url: string };

/** True when the item says that it has a trailer. The local list loads only then. */
export function hasTrailers(item: BaseItemDto): boolean {
  return (item.LocalTrailerCount ?? 0) > 0 || remoteTrailers(item).length > 0;
}

/** A short name for the site of a link: "YouTube", "Vimeo", else the host name. */
export function siteName(url: string): string {
  const host = hostOf(url);
  if (!host) return 'Web';
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'YouTube';
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'Vimeo';
  return host.replace(/^www\./, '');
}

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** The YouTube video Id of a link, or null. Two links to one video are one trailer. */
export function youtubeId(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (host === 'youtu.be') return /^https?:\/\/[^/]+\/([\w-]{6,})/i.exec(url.trim())?.[1] ?? null;
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;
  return /[?&]v=([\w-]{6,})/.exec(url)?.[1] ?? /\/(?:embed|shorts|v)\/([\w-]{6,})/.exec(url)?.[1] ?? null;
}

/** The metadata links: http(s) only, no duplicates, in server order. */
export function remoteTrailers(item: BaseItemDto): Trailer[] {
  const seen = new Set<string>();
  const out: Trailer[] = [];
  for (const t of item.RemoteTrailers ?? []) {
    const url = t.Url?.trim();
    if (!url || !hostOf(url)) continue;
    const key = youtubeId(url) ? `yt:${youtubeId(url)}` : url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'remote', key, url, label: t.Name?.trim() || '' });
  }
  return out;
}

/**
 * Every trailer to offer, the files on the server first (they play in the
 * app). A trailer with no name gets "Trailer", or "Trailer 2" and so on, and
 * a link adds its site: "Trailer · YouTube".
 */
export function trailerChoices(item: BaseItemDto, local: readonly BaseItemDto[] | undefined): Trailer[] {
  const files: Trailer[] = (local ?? [])
    .filter((t) => !!t.Id)
    .map((t) => ({ kind: 'local', key: `local:${t.Id}`, label: t.Name?.trim() || '', item: t }));
  const all = [...files, ...remoteTrailers(item)];
  let n = 0;
  return all.map((t) => {
    const name = t.label || (all.length > 1 ? `Trailer ${++n}` : 'Trailer');
    return { ...t, label: t.kind === 'remote' ? `${name} · ${siteName(t.url)}` : name };
  });
}
