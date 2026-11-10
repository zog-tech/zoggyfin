/**
 * Lyrics from GET /Audio/{id}/Lyrics (the server parses LRC files and
 * embedded tags into lines with a start time in ticks), and a parser for
 * raw LRC text. Pure, so the sync rules are unit-tested.
 */

export interface LyricLine {
  text: string;
  /** Seconds, or null for plain (unsynced) lyrics. */
  start: number | null;
  /** Word timing (enhanced LRC), when the server has it. */
  cues?: LyricCue[];
}

/** The timing of a part of a line: characters `from` to `to` (exclusive) are sung from `start` to `end` (seconds). */
export interface LyricCue {
  from: number;
  to: number;
  start: number;
  /** Null when the server does not know: the part then lasts until the next one. */
  end: number | null;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
}

interface LyricCueLike {
  Position?: number;
  EndPosition?: number;
  Start?: number;
  End?: number | null;
}

interface LyricDtoLike {
  Lyrics?: readonly { Text?: string | null; Start?: number | null; Cues?: readonly LyricCueLike[] | null }[] | null;
}

function finish(lines: LyricLine[]): Lyrics | null {
  const trimmed = lines.map(trimLine);
  // Drop leading and trailing blank lines; keep blank lines inside (pauses, verse breaks).
  while (trimmed.length && !trimmed[0]?.text) trimmed.shift();
  while (trimmed.length && !trimmed[trimmed.length - 1]?.text) trimmed.pop();
  if (!trimmed.length) return null;
  const synced = trimmed.every((l) => l.start !== null);
  if (!synced) return { synced: false, lines: trimmed.map((l) => ({ text: l.text, start: null })) };
  const sorted = [...trimmed].sort((a, b) => (a.start as number) - (b.start as number));
  return { synced: true, lines: sorted };
}

/** Trims the text and moves the cue positions with it; cues outside the text go. */
function trimLine(l: LyricLine): LyricLine {
  const lead = l.text.length - l.text.trimStart().length;
  const text = l.text.trim();
  if (!l.cues?.length) return { text, start: l.start };
  const cues = l.cues
    .map((c) => ({ ...c, from: Math.max(0, c.from - lead), to: Math.min(text.length, c.to - lead) }))
    .filter((c) => c.to > c.from);
  return cues.length ? { text, start: l.start, cues } : { text, start: l.start };
}

const TICKS = 10_000_000;

function cuesOf(raw: readonly LyricCueLike[] | null | undefined, textLength: number): LyricCue[] | undefined {
  if (!raw?.length) return undefined;
  const cues: LyricCue[] = [];
  for (const c of raw) {
    if (typeof c.Start !== 'number' || !Number.isFinite(c.Start)) continue;
    const from = Math.max(0, c.Position ?? 0);
    const to = Math.min(textLength, c.EndPosition ?? textLength);
    if (to <= from) continue;
    const end = typeof c.End === 'number' && Number.isFinite(c.End) && c.End > c.Start ? c.End / TICKS : null;
    cues.push({ from, to, start: c.Start / TICKS, end });
  }
  return cues.length ? cues.sort((a, b) => a.from - b.from) : undefined;
}

interface LyricHints {
  HasLyrics?: boolean | null;
  MediaStreams?: readonly { Type?: string | null }[] | null;
  MediaSources?: readonly { MediaStreams?: readonly { Type?: string | null }[] | null }[] | null;
}

/**
 * True when the server can have lyrics for this item: `HasLyrics` is not
 * false, or a media stream is a lyric stream. A server without lyrics answers
 * 404, and on the web that 404 has no CORS header, so the app does not ask.
 * An item from an old saved queue has no `HasLyrics`; the app asks for it.
 */
export function mayHaveLyrics(item: LyricHints): boolean {
  const streams = [...(item.MediaStreams ?? []), ...(item.MediaSources ?? []).flatMap((m) => m.MediaStreams ?? [])];
  if (streams.some((st) => st.Type === 'Lyric')) return true;
  return item.HasLyrics !== false;
}

/** The server answer. Null when there are no lyrics. */
export function fromLyricDto(dto: LyricDtoLike | null | undefined): Lyrics | null {
  const raw = dto?.Lyrics;
  if (!raw?.length) return null;
  return finish(
    raw.map((l) => {
      const text = l.Text ?? '';
      const cues = cuesOf(l.Cues, text.length);
      const start = typeof l.Start === 'number' && Number.isFinite(l.Start) ? l.Start / TICKS : null;
      return cues ? { text, start, cues } : { text, start };
    }),
  );
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-z]+):(.*)\]$/i;

/**
 * Parses LRC text: `[mm:ss.xx]` tags (several per line), an `[offset:±ms]`
 * tag, and metadata tags (ignored). Text without any time tag is plain lyrics.
 */
export function parseLrc(text: string): Lyrics | null {
  let offset = 0;
  const lines: LyricLine[] = [];
  let anyTag = false;
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const meta = line.match(META_TAG);
    if (meta && !/^\d/.test(meta[1] ?? '')) {
      if (meta[1]?.toLowerCase() === 'offset') {
        const ms = Number.parseInt((meta[2] ?? '').trim(), 10);
        if (Number.isFinite(ms)) offset = ms / 1000;
      }
      continue;
    }
    const starts: number[] = [];
    TIME_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line))) {
      const frac = m[3] ? Number.parseInt(m[3], 10) / 10 ** m[3].length : 0;
      starts.push(Number.parseInt(m[1] ?? '0', 10) * 60 + Number.parseInt(m[2] ?? '0', 10) + frac);
    }
    const body = line.replace(TIME_TAG, '');
    if (starts.length) {
      anyTag = true;
      for (const s of starts) lines.push({ text: body, start: s });
    } else if (!anyTag) {
      lines.push({ text: body, start: null });
    }
  }
  if (anyTag) {
    // An LRC offset is added to the times: a positive offset shows lines earlier.
    return finish(lines.filter((l) => l.start !== null).map((l) => ({ ...l, start: Math.max(0, (l.start as number) - offset) })));
  }
  return finish(lines);
}

/**
 * The index of the line that is sung at `seconds`: the last line that has
 * started. -1 before the first line and for plain lyrics. Binary search, so
 * it is cheap on each time update.
 */
export function activeLine(lyrics: Lyrics | null, seconds: number): number {
  if (!lyrics?.synced || !lyrics.lines.length) return -1;
  let lo = 0;
  let hi = lyrics.lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lyrics.lines[mid]?.start ?? 0) <= seconds + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
