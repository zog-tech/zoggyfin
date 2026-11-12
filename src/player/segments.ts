/**
 * Skip Intro / Skip Credits and the next-episode countdown, from Jellyfin
 * media segments or an external source's labelled ranges. Pure: positions
 * in seconds, clock times in ms.
 *
 * A segment has a free label (`intro`, `promo`). Jellyfin's five kinds map
 * to the built-in labels below, so the next-up rules that look for the end
 * credits (`outro`) work for both.
 */
import type { MediaSegmentDto } from '@/api/types';

export interface Segment {
  /** What the range is: a built-in label or one an extension names. */
  label: string;
  /** The name people read: "Skip <title>", "Skipped <title>". */
  title: string;
  start: number;
  end: number;
}

/** The labels of Jellyfin's segment kinds. */
export const BUILTIN_LABELS = ['intro', 'outro', 'recap', 'preview', 'commercial'] as const;
export type BuiltinLabel = (typeof BUILTIN_LABELS)[number];

/** The key prefix of the built-in labels in the skip settings (`<scope>:<label>`). */
export const JELLYFIN_SKIP_SCOPE = 'jellyfin';

const JELLYFIN_KINDS: Record<string, BuiltinLabel> = {
  Intro: 'intro',
  Outro: 'outro',
  Recap: 'recap',
  Preview: 'preview',
  Commercial: 'commercial',
};

/** The title of each built-in label. */
export const BUILTIN_TITLES: Record<BuiltinLabel, string> = {
  intro: 'Intro',
  outro: 'Credits',
  recap: 'Recap',
  preview: 'Preview',
  commercial: 'Ad',
};

/** Segments shorter than this are noise from detection. */
const MIN_SEGMENT_SECONDS = 2;

/** Cleans the server list: known kinds only, as built-in labels; valid ranges, sorted by start. */
export function normalizeSegments(raw: readonly MediaSegmentDto[] | null | undefined): Segment[] {
  return (raw ?? [])
    .filter((s) => (s.Type ?? '') in JELLYFIN_KINDS && typeof s.StartTicks === 'number' && typeof s.EndTicks === 'number')
    .map((s) => {
      const label = JELLYFIN_KINDS[s.Type ?? ''];
      return { label, title: BUILTIN_TITLES[label], start: (s.StartTicks ?? 0) / 1e7, end: (s.EndTicks ?? 0) / 1e7 };
    })
    .filter((s) => s.end - s.start >= MIN_SEGMENT_SECONDS)
    .sort((a, b) => a.start - b.start);
}

/** An external source's ranges: valid ones only, sorted by start. Any length counts (the source chose it). */
export function externalSegments(raw: readonly Segment[] | null | undefined): Segment[] {
  return (raw ?? [])
    .filter((s) => s.label && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.start >= 0)
    .map((s) => ({ label: s.label, title: s.title || s.label, start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
}

/** The key a range is known by within one play (auto skip, Undo). */
export function rangeKey(s: Pick<Segment, 'label' | 'start'>): string {
  return `${s.label}@${s.start}`;
}

export interface SkipPrompt {
  segment: Segment;
  label: string;
  /** Where "skip" seeks to. */
  target: number;
}

/** Hide the prompt in the last moment of a segment, so a late tap does not skip into the next scene. */
const TAIL_SECONDS = 1;
/** An outro that ends this close to the end is the end credits. */
const END_CREDITS_SLACK = 5;

/**
 * The skip prompt to show at `position`, or null. End credits with a next
 * episode show the next-episode card instead, so no prompt then. `shows`
 * leaves out the segments whose skip setting hides the button.
 */
export function skipPromptAt(
  segments: readonly Segment[],
  position: number,
  duration: number,
  hasNext: boolean,
  shows: (segment: Segment) => boolean = () => true,
): SkipPrompt | null {
  for (const s of segments) {
    if (position < s.start || position >= s.end - TAIL_SECONDS || !shows(s)) continue;
    const endCredits = s.label === 'outro' && duration > 0 && s.end >= duration - END_CREDITS_SLACK;
    if (endCredits && hasNext) return null;
    return skipPromptFor(s, duration);
  }
  return null;
}

/**
 * The prompt for one segment. The player picks the segment from the position
 * (a value that changes only at segment edges) and builds the prompt with this,
 * so a position tick does not re-render the player.
 */
export function skipPromptFor(segment: Segment, duration: number): SkipPrompt {
  return { segment, label: `Skip ${segment.title}`, target: Math.min(segment.end, duration > 0 ? duration : segment.end) };
}

/** With no outro segment, the next-episode card shows this long before the end. */
export const NEXT_UP_FALLBACK_SECONDS = 30;
/** The countdown on the next-episode card. */
export const NEXT_UP_COUNTDOWN_SECONDS = 10;

/**
 * How the next title follows.
 * - `credits`: Jellyfin items and IPTV episodes. The end credits (or the last
 *   30 s) are not content, so the card counts down there and starts the next
 *   episode before the file ends.
 * - `end`: extension media (a YouTube video). The last seconds are content:
 *   the card shows in the last 10 s, its ring follows the time left in the
 *   video, and only the real end of the video starts the next title.
 */
export type NextUpMode = 'credits' | 'end';

/** The mode of what plays: `end` when the external source asks for it. */
export function nextUpModeOf(now: { external?: { source: { nextAtEnd?: boolean } } } | null | undefined): NextUpMode {
  return now?.external?.source.nextAtEnd ? 'end' : 'credits';
}

/**
 * When the next-episode card appears. `credits`: at the start of the end
 * credits, or 30 s before the end. `end`: 10 s before the end. Null for short
 * videos, where it would cover the content.
 */
export function nextUpStartsAt(segments: readonly Segment[], duration: number, mode: NextUpMode = 'credits'): number | null {
  if (!(duration > 0)) return null;
  if (mode === 'end') return duration < NEXT_UP_COUNTDOWN_SECONDS * 3 ? null : duration - NEXT_UP_COUNTDOWN_SECONDS;
  const credits = segments.find((s) => s.label === 'outro' && s.end >= duration - END_CREDITS_SLACK);
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

/** `end` mode: the seconds left on the card's ring, which is the time left in the video. */
export function endCountdownLeft(position: number, duration: number, seconds = NEXT_UP_COUNTDOWN_SECONDS): number {
  if (!(duration > 0)) return seconds;
  return Math.min(seconds, Math.max(0, duration - position));
}

/**
 * Whether the end of the video starts the next title by itself. `credits`
 * mode keeps the old rule (autoplay on, a next title). `end` mode also
 * respects Cancel on the card: the countdown never fired, so the end is the
 * only place the next title can start.
 */
export function endPlaysNext(input: {
  mode: NextUpMode;
  autoplay: boolean;
  hasNext: boolean;
  startsAt: number | null;
  dismissedAt: number | null;
}): boolean {
  const { mode, autoplay, hasNext, startsAt, dismissedAt } = input;
  if (!autoplay || !hasNext) return false;
  if (mode === 'credits') return true;
  return !(startsAt !== null && dismissedAt !== null && dismissedAt >= startsAt);
}
