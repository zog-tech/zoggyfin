/**
 * The karaoke fill of synced lyrics: when each word of a line fills.
 *
 * - With word cues (enhanced LRC), a word fills over the time of its cues.
 * - With line times only, the line fills from its start to the start of the
 *   next line, word by word in proportion to their letters. The fill takes
 *   at most the time the line takes to sing (from its letter count), so it
 *   does not crawl through an instrumental break.
 *
 * Words are in reading order. The panel draws Arabic lines from right to
 * left, so the fill also runs from right to left there.
 *
 * Pure, so it is unit-tested. `wordProgress` is a worklet: the lyrics panel
 * runs it on the UI thread on each frame.
 */
import { hasArabic } from '@/theme/theme';

import type { LyricLine } from './lyrics';

export interface FillWord {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
}

/** Singing speed for the cap: a slow singer, so a normal line fills up to the next one. */
export const SECONDS_PER_LETTER = 0.15;
/** The shortest fill of a line. */
export const MIN_LINE_FILL = 1.2;

function letters(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** The start of the first later line that starts after line `i`, or null. */
function nextStart(lines: readonly LyricLine[], i: number): number | null {
  const start = lines[i]?.start ?? 0;
  for (let j = i + 1; j < lines.length; j++) {
    const s = lines[j]?.start;
    if (s !== null && s !== undefined && s > start) return s;
  }
  return null;
}

/** When the fill of line `i` ends: the next line's start, capped by the line's sung length. */
export function lineFillEnd(lines: readonly LyricLine[], i: number): number {
  const line = lines[i];
  const start = line?.start ?? 0;
  if (!line) return start;
  const next = nextStart(lines, i);
  const sung = Math.max(MIN_LINE_FILL, letters(line.text) * SECONDS_PER_LETTER);
  return start + (next === null ? sung : Math.min(next - start, sung));
}

/** The words of line `i` with their fill times. An empty line is one "♪" word. */
export function fillWords(lines: readonly LyricLine[], i: number): FillWord[] {
  const line = lines[i];
  if (!line || line.start === null) return [];
  const start = line.start;
  const end = lineFillEnd(lines, i);
  const spans: { text: string; from: number; to: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.text))) spans.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  if (!spans.length) return [{ text: '♪', start, end }];

  const cues = line.cues;
  if (cues?.length) {
    const words: FillWord[] = [];
    let last = start;
    for (const span of spans) {
      const own = cues.filter((c) => c.from < span.to && c.to > span.from);
      if (!own.length) {
        words.push({ text: span.text, start: last, end: last });
        continue;
      }
      const wStart = Math.min(...own.map((c) => c.start));
      const ends = own.map((c) => {
        if (c.end !== null) return c.end;
        // No end: until the next cue starts, else its sung length (never past the next line).
        const after = cues.find((x) => x.start > c.start);
        if (after) return after.start;
        const sung = c.start + Math.max(0.3, (c.to - c.from) * SECONDS_PER_LETTER);
        const next = nextStart(lines, i);
        return next === null ? sung : Math.max(c.start, Math.min(next, sung));
      });
      const wEnd = Math.max(wStart, ...ends);
      words.push({ text: span.text, start: wStart, end: wEnd });
      last = wEnd;
    }
    return words;
  }

  const total = spans.reduce((n, s) => n + s.text.length, 0);
  const span = end - start;
  let done = 0;
  return spans.map((s) => {
    const wStart = start + (done / total) * span;
    done += s.text.length;
    return { text: s.text, start: wStart, end: start + (done / total) * span };
  });
}

/** How much of a word is filled at `t` seconds: 0 to 1. */
export function wordProgress(start: number, end: number, t: number): number {
  'worklet';
  if (t >= end) return 1;
  if (t <= start) return 0;
  return (t - start) / (end - start);
}

/** The side the fill starts on. */
export function fillDirection(text: string): 'ltr' | 'rtl' {
  return hasArabic(text) ? 'rtl' : 'ltr';
}
