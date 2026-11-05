/**
 * The programme index: the titles of the next 48 hours of a provider's
 * XMLTV guide, packed small enough to save and search. Per guide id it keeps
 * a flat list `[startMin, stopMin, titleIdx, ...]` (minutes since `from`,
 * sorted by start). Each distinct title is stored once. `sliceIndex` turns a
 * time range back into programmes with a folded title for matching.
 * Pure, so it is unit-tested.
 */
import type { XmltvCollect } from './xmltv';
import { foldText } from './search';

export const PROGRAMME_INDEX_SCHEMA_VERSION = 1;

const HOUR = 3_600_000;
/** How far ahead the index reaches. */
export const INDEX_KEEP_MS = 48 * HOUR;
/** How far back from the build time it starts, so a programme on air now is in. */
export const INDEX_BACK_MS = 30 * 60_000;
/** Rebuild when the index covers less than this much of the future. */
const MIN_AHEAD_MS = 24 * HOUR;
/** After a failed build, wait this long before trying again. */
const RETRY_AFTER_FAIL_MS = 12 * HOUR;

export interface ProgrammeIndex {
  schemaVersion: number;
  providerId: string;
  builtAt: number;
  from: number;
  to: number;
  titles: string[];
  /** Per guide id: flat `[startMin, stopMin, titleIdx, ...]`, minutes since `from`, sorted by start. */
  channels: Record<string, number[]>;
}

export class ProgrammeIndexBuilder implements XmltvCollect {
  private readonly titles: string[] = [];
  private readonly titleIds = new Map<string, number>();
  private readonly rows = new Map<string, Map<number, [number, number]>>();
  private latestStop = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly providerId: string,
    readonly from: number,
    readonly to: number,
  ) {}

  add(guideId: string, start: number, stop: number, title: string): void {
    let byStart = this.rows.get(guideId);
    if (!byStart) this.rows.set(guideId, (byStart = new Map()));
    const s = Math.round((start - this.from) / 60_000);
    if (byStart.has(s)) return;
    let idx = this.titleIds.get(title);
    if (idx === undefined) {
      idx = this.titles.length;
      this.titles.push(title);
      this.titleIds.set(title, idx);
    }
    byStart.set(s, [Math.round((stop - this.from) / 60_000), idx]);
    if (stop > this.latestStop) this.latestStop = stop;
  }

  build(builtAt: number): ProgrammeIndex {
    const channels: Record<string, number[]> = {};
    for (const [id, byStart] of this.rows) {
      const starts = [...byStart.keys()].sort((a, b) => a - b);
      const flat: number[] = [];
      for (const s of starts) {
        const [stop, idx] = byStart.get(s) as [number, number];
        flat.push(s, stop, idx);
      }
      channels[id] = flat;
    }
    return {
      schemaVersion: PROGRAMME_INDEX_SCHEMA_VERSION,
      providerId: this.providerId,
      builtAt,
      from: this.from,
      to: Number.isFinite(this.latestStop) ? this.latestStop : this.from,
      titles: this.titles,
      channels,
    };
  }
}

/** Checks a saved index. Returns null for anything of another shape or version. Never throws. */
export function migrateProgrammeIndex(raw: unknown): ProgrammeIndex | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.schemaVersion !== PROGRAMME_INDEX_SCHEMA_VERSION) return null;
    if (typeof r.providerId !== 'string') return null;
    if (typeof r.builtAt !== 'number' || typeof r.from !== 'number' || typeof r.to !== 'number') return null;
    if (!Array.isArray(r.titles) || !r.titles.every((t) => typeof t === 'string')) return null;
    if (!r.channels || typeof r.channels !== 'object' || Array.isArray(r.channels)) return null;
    const titles = r.titles as string[];
    const channels: Record<string, number[]> = {};
    for (const [id, flat] of Object.entries(r.channels as Record<string, unknown>)) {
      if (!Array.isArray(flat) || flat.length % 3 !== 0) return null;
      for (let i = 0; i < flat.length; i += 3) {
        const idx = flat[i + 2];
        if (typeof flat[i] !== 'number' || typeof flat[i + 1] !== 'number' || typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= titles.length) return null;
      }
      channels[id] = flat as number[];
    }
    return { schemaVersion: PROGRAMME_INDEX_SCHEMA_VERSION, providerId: r.providerId, builtAt: r.builtAt, from: r.from, to: r.to, titles, channels };
  } catch {
    return null;
  }
}

export interface SlicedProgramme {
  guideId: string;
  start: number;
  stop: number;
  title: string;
  /** `foldText(title)` with a space on each side, like `buildSearchIndex`. */
  folded: string;
}

/** The programmes that are on at any time in `from`..`to` (stop > from and start < to). */
export function sliceIndex(index: ProgrammeIndex, from: number, to: number): SlicedProgramme[] {
  const out: SlicedProgramme[] = [];
  const folds: (string | undefined)[] = new Array(index.titles.length);
  for (const id of Object.keys(index.channels)) {
    const flat = index.channels[id];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const start = index.from + flat[i] * 60_000;
      if (start >= to) break;
      const stop = index.from + flat[i + 1] * 60_000;
      if (stop <= from) continue;
      const t = flat[i + 2];
      const title = index.titles[t];
      if (title === undefined) continue;
      const folded = (folds[t] ??= ` ${foldText(title)} `);
      out.push({ guideId: id, start, stop, title, folded });
    }
  }
  return out;
}

export interface IndexLedger {
  builtAt: number | null;
  to: number | null;
  failedAt: number | null;
}

/** True when the index is missing or covers less than 24 hours ahead, unless a build failed in the last 12 hours. */
export function needsIndexRefresh(ledger: IndexLedger | null, now: number): boolean {
  if (!ledger) return true;
  if (ledger.failedAt !== null && now - ledger.failedAt < RETRY_AFTER_FAIL_MS) return false;
  if (ledger.builtAt === null || ledger.to === null) return true;
  return ledger.to < now + MIN_AHEAD_MS;
}
