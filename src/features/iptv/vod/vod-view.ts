/**
 * What the film and series screens show: tile data, the metadata line, the
 * runtime. Pure, so it is unit-tested.
 */
import type { Episode, FilmInfo, SeriesInfo, VodFavourite, VodItem, VodKind, VodPosition } from '@/iptv';

import type { PlainTileData } from '@/components/plain-tile';

/** A plain tile of a film, a series or an episode. */
export type VodTileData = PlainTileData & { kind: 'film' | 'series' | 'episode' };

/** "2 h 1 min", "45 min". */
export function runtimeText(seconds: number | undefined): string | null {
  if (!seconds || seconds < 60) return null;
  const min = Math.round(seconds / 60);
  const h = Math.floor(min / 60);
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

export function ratingText(rating: number | undefined): string | null {
  return rating ? `★ ${rating.toFixed(1).replace(/\.0$/, '')}` : null;
}

/** The facts line of a detail page: year, genre, runtime or seasons, rating. */
export function factsOf(kind: VodKind, item: Pick<VodItem, 'year' | 'rating'> | null, info: FilmInfo | SeriesInfo | null): string[] {
  const year = info?.year ?? item?.year;
  const facts: (string | null)[] = [year ? String(year) : null, info?.genre ?? null];
  if (kind === 'film') facts.push(runtimeText((info as FilmInfo | null)?.duration));
  else {
    const n = (info as SeriesInfo | null)?.seasons.filter((s) => s.number > 0).length ?? 0;
    facts.push(n ? `${n} season${n === 1 ? '' : 's'}` : null);
  }
  facts.push(ratingText(info?.rating ?? item?.rating));
  return facts.filter((f): f is string => !!f);
}

export function tileOfItem(kind: VodKind, item: VodItem, progress: number | null = null): VodTileData {
  return {
    key: `${kind}:${item.id}`,
    id: item.id,
    kind,
    title: item.name,
    subtitle: [item.year ? String(item.year) : null, ratingText(item.rating)].filter(Boolean).join(' · ') || null,
    poster: item.poster ?? null,
    progress,
  };
}

export function tileOfFavourite(f: VodFavourite): VodTileData {
  return { key: `fav:${f.kind}:${f.id}`, id: f.id, kind: f.kind, title: f.name, subtitle: null, poster: f.poster ?? null, progress: null };
}

/** A Continue watching tile: a film, or an episode under its series name. */
export function tileOfPosition(p: VodPosition): VodTileData {
  const progress = p.duration > 0 ? Math.min(1, p.position / p.duration) : null;
  if (p.kind === 'film') return { key: `pos:film:${p.id}`, id: p.id, kind: 'film', title: p.title, subtitle: remaining(p), poster: p.poster ?? null, progress };
  const code = p.season !== undefined && p.episode !== undefined ? `S${p.season} E${p.episode}` : null;
  return {
    key: `pos:episode:${p.id}`,
    id: p.id,
    kind: 'episode',
    title: p.seriesName ?? p.title,
    subtitle: [code, remaining(p)].filter(Boolean).join(' · ') || null,
    poster: p.poster ?? null,
    progress,
  };
}

function remaining(p: VodPosition): string | null {
  if (!(p.duration > 0)) return null;
  const left = Math.max(0, Math.round((p.duration - p.position) / 60));
  return left ? `${left} min left` : null;
}

/** "S1 E2 · 45 min" for an episode row. */
export function episodeLine(ep: Episode): string {
  return [`S${ep.season} E${ep.number}`, runtimeText(ep.duration)].filter(Boolean).join(' · ');
}
