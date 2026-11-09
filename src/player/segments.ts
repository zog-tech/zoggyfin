/**
 * Skip Intro / Skip Credits and the next-episode countdown, from Jellyfin
 * media segments. Pure: positions in seconds, clock times in ms.
 */
import type { MediaSegmentDto } from '@/api/types';

export type SegmentKind = 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial';

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

const SKIPPABLE: ReadonlySet<string> = new Set<SegmentKind>(['Intro', 'Outro', 'Recap', 'Preview', 'Commercial']);

/** Segments shorter than this are noise from detection. */
const MIN_SEGMENT_SECONDS = 2;

/** Cleans the server list: known kinds only, valid ranges, sorted by start. */
export function normalizeSegments(raw: readonly MediaSegmentDto[] | null | undefined): Segment[] {
  return (raw ?? [])
    .filter((s) => SKIPPABLE.has(s.Type ?? '') && typeof s.StartTicks === 'number' && typeof s.EndTicks === 'number')
    .map((s) => ({ kind: s.Type as SegmentKind, start: (s.StartTicks ?? 0) / 1e7, end: (s.EndTicks ?? 0) / 1e7 }))
    .filter((s) => s.end - s.start >= MIN_SEGMENT_SECONDS)
    .sort((a, b) => a.start - b.start);
}

export interface SkipPrompt {
  segment: Segment;
  label: string;
  /** Where "skip" seeks to. */
  target: number;
}

const LABEL: Record<SegmentKind, string> = {
  Intro: 'Skip Intro',
  Outro: 'Skip Credits',
  Recap: 'Skip Recap',
  Preview: 'Skip Preview',
  Commercial: 'Skip Ad',
};

/** Hide the prompt in the last moment of a segment, so a late tap does not skip into the next scene. */
const TAIL_SECONDS = 1;
/** An outro that ends this close to the end is the end credits. */
const END_CREDITS_SLACK = 5;

/**
 * The skip prompt to show at `position`, or null. End credits with a next
 * episode show the next-episode card instead, so no prompt then.
 */
export function skipPromptAt(segments: readonly Segment[], position: number, duration: number, hasNext: boolean): SkipPrompt | null {
  for (const s of segments) {
    if (position < s.start || position >= s.end - TAIL_SECONDS) continue;
    const endCredits = s.kind === 'Outro' && duration > 0 && s.end >= duration - END_CREDITS_SLACK;
    if (endCredits && hasNext) return null;
    return { segment: s, label: LABEL[s.kind], target: Math.min(s.end, duration > 0 ? duration : s.end) };
  }
  return null;
}

/** With no outro segment, the next-episode card shows this long before the end. */
export const NEXT_UP_FALLBACK_SECONDS = 30;
/** The countdown on the next-episode card. */
export const NEXT_UP_COUNTDOWN_SECONDS = 10;

/**
 * When the next-episode card appears: at the start of the end credits, or
 * 30 s before the end. Null for short videos, where it would cover the content.
 */
export function nextUpStartsAt(segments: readonly Segment[], duration: number): number | null {
  if (!(duration > 0)) return null;
  const credits = segments.find((s) => s.kind === 'Outro' && s.end >= duration - END_CREDITS_SLACK);
  if (credits) return credits.start;
  if (duration < NEXT_UP_FALLBACK_SECONDS * 4) return null;
  return duration - NEXT_UP_FALLBACK_SECONDS;
}

export type NextUpPhase = 'hidden' | 'counting' | 'dismissed';

/**
 * The next-episode card state. `dismissedAt` is the position where the user
 * pressed Cancel; seeking back before the trigger shows the card again later.
 */
export function nextUpPhase(input: {
  position: number;
  startsAt: number | null;
  hasNext: boolean;
  dismissedAt: number | null;
}): NextUpPhase {
  const { position, startsAt, hasNext, dismissedAt } = input;
  if (!hasNext || startsAt === null || position < startsAt) return 'hidden';
  if (dismissedAt !== null && dismissedAt >= startsAt) return 'dismissed';
  return 'counting';
}

/**
 * The next-up countdown clock. It runs only while the video plays: a video
 * paused at the credits must not start the next episode by itself.
 * `spentMs` is the time counted before `since`; `since` is when it last
 * began to run, or null while it holds.
 */
export interface CountdownClock {
  spentMs: number;
  since: number | null;
}

export function countdownClock(nowMs: number, running: boolean): CountdownClock {
  return { spentMs: 0, since: running ? nowMs : null };
}

/** Runs or holds the clock. Returns the same clock when nothing changes. */
export function setCountdownRunning(clock: CountdownClock, running: boolean, nowMs: number): CountdownClock {
  if (running === (clock.since !== null)) return clock;
  if (running) return { spentMs: clock.spentMs, since: nowMs };
  return { spentMs: clock.spentMs + Math.max(0, nowMs - (clock.since ?? nowMs)), since: null };
}

/** Seconds left on the countdown. Time while the clock holds does not count. */
export function countdownLeft(clock: CountdownClock, nowMs: number, seconds = NEXT_UP_COUNTDOWN_SECONDS): number {
  const spent = clock.spentMs + (clock.since !== null ? Math.max(0, nowMs - clock.since) : 0);
  return Math.max(0, seconds - spent / 1000);
}
