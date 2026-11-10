/**
 * Automatic skip of labelled ranges (an intro, a promotion) whose skip
 * setting is `auto`.
 *
 *   idle --time in an auto range--> skipped(range, undoable) --undo / expire / user seek--> idle
 *
 * Rules:
 * - One automatic skip per range per play (`done`).
 * - A range the user seeks into on purpose is not skipped (it joins `done`).
 * - Undo goes back to the range start and turns auto skip off for that
 *   range for the rest of the play (`blocked`).
 * - Never while `allowed` is false: a watch-together session (the group
 *   keeps one timeline; a guest never skips on its own), a live stream.
 * - The undo window lasts `UNDO_WINDOW_MS` (the longest toast, on TV).
 * - The last second of a range is not skipped: the seek would land in the
 *   next scene anyway.
 * - An event that does not apply returns the same state object.
 *
 * The caller seeks: `skippedNow` says to the end of which range,
 * `undoneRange` says back to the start of which one.
 *
 * Pure, so it is unit-tested.
 */
import { rangeKey, type Segment } from './segments';
import { type SkipChoice, skipModeFor, type SkipMode } from '@/settings/skip-modes';

/** How long Undo stays possible after an automatic skip (ms): the TV toast time. */
export const UNDO_WINDOW_MS = 10_000;
/** No automatic skip in the last second of a range. */
const TAIL_SECONDS = 1;

export interface AutoSkipRange {
  key: string;
  title: string;
  start: number;
  end: number;
}

interface Memory {
  /** Ranges skipped or entered on purpose in this play: never skipped by themselves again. */
  done: readonly string[];
  /** Ranges whose automatic skip the user undid: off for the rest of the play. */
  blocked: readonly string[];
}

export type AutoSkipState = (Memory & { phase: 'idle' }) | (Memory & { phase: 'skipped'; range: AutoSkipRange; at: number });

export type AutoSkipEvent =
  /** The position moved. `ranges`: the ranges whose mode is `auto`. `now`: the clock, ms. */
  | { type: 'time'; position: number; ranges: readonly AutoSkipRange[]; allowed: boolean; now: number }
  /** The user sought to `target` (seek bar, skip buttons, keys). */
  | { type: 'userSeek'; target: number; ranges: readonly AutoSkipRange[] }
  /** Undo on the toast. */
  | { type: 'undo' }
  /** The toast went away. */
  | { type: 'expire' }
  /** A new play. */
  | { type: 'reset' };

export const initialAutoSkip: AutoSkipState = { phase: 'idle', done: [], blocked: [] };

const inside = (r: AutoSkipRange, position: number) => position >= r.start && position < r.end - TAIL_SECONDS;

export function transitionAutoSkip(state: AutoSkipState, event: AutoSkipEvent): AutoSkipState {
  switch (event.type) {
    case 'reset':
      return state.phase === 'idle' && !state.done.length && !state.blocked.length ? state : initialAutoSkip;
    case 'expire':
      return state.phase === 'skipped' ? { phase: 'idle', done: state.done, blocked: state.blocked } : state;
    case 'undo':
      if (state.phase !== 'skipped') return state;
      return { phase: 'idle', done: state.done, blocked: state.blocked.includes(state.range.key) ? state.blocked : [...state.blocked, state.range.key] };
    case 'userSeek': {
      const entered = event.ranges.filter((r) => inside(r, event.target) && !state.done.includes(r.key)).map((r) => r.key);
      if (state.phase === 'idle' && !entered.length) return state;
      return { phase: 'idle', done: entered.length ? [...state.done, ...entered] : state.done, blocked: state.blocked };
    }
    case 'time': {
      // The undo window ends on its own, so a later range can be skipped.
      const base: AutoSkipState = state.phase === 'skipped' && event.now - state.at >= UNDO_WINDOW_MS ? { phase: 'idle', done: state.done, blocked: state.blocked } : state;
      if (!event.allowed) return base;
      const r = event.ranges.find((x) => inside(x, event.position) && !base.done.includes(x.key) && !base.blocked.includes(x.key));
      if (!r) return base;
      return { phase: 'skipped', done: [...base.done, r.key], blocked: base.blocked, range: r, at: event.now };
    }
  }
}

/** The range just skipped by itself (seek to its end, show the toast), or null. */
export function skippedNow(prev: AutoSkipState, next: AutoSkipState): AutoSkipRange | null {
  if (next === prev || next.phase !== 'skipped') return null;
  return prev.phase === 'skipped' && prev.range.key === next.range.key && prev.at === next.at ? null : next.range;
}

/** The range whose skip was just undone (seek back to its start), or null. */
export function undoneRange(prev: AutoSkipState, next: AutoSkipState): AutoSkipRange | null {
  return prev.phase === 'skipped' && next.phase === 'idle' && next.blocked.includes(prev.range.key) && !prev.blocked.includes(prev.range.key) ? prev.range : null;
}

/** The skip settings in force for what plays: the key prefix and the source's defaults. */
export interface SkipContext {
  scope: string;
  defaults?: Readonly<Record<string, SkipMode>>;
  choices: Readonly<Record<string, SkipChoice>>;
}

export function modeOf(segment: Pick<Segment, 'label'>, ctx: SkipContext): SkipMode {
  return skipModeFor(ctx.choices, ctx.scope, segment.label, ctx.defaults);
}

/** The ranges the machine may skip: those whose mode is `auto`. */
export function autoRanges(segments: readonly Segment[], ctx: SkipContext): AutoSkipRange[] {
  return segments.filter((s) => modeOf(s, ctx) === 'auto').map((s) => ({ key: rangeKey(s), title: s.title, start: s.start, end: s.end }));
}

/**
 * Whether the skip button shows for a segment: `ask` always; `auto` only
 * where the automatic skip will not act (the user undid it or sought into
 * the range, or it cannot skip now); `off` never.
 */
export function buttonShows(segment: Segment, ctx: SkipContext, state: AutoSkipState, autoAllowed: boolean): boolean {
  const mode = modeOf(segment, ctx);
  if (mode === 'ask') return true;
  if (mode === 'off') return false;
  const key = rangeKey(segment);
  // Just skipped: the seek is on its way, so no button flashes up.
  if (state.phase === 'skipped' && state.range.key === key) return false;
  return !autoAllowed || state.blocked.includes(key) || state.done.includes(key);
}
