/**
 * The audio queue, as pure functions over plain data (so it is unit-tested
 * and saved to storage as JSON).
 *
 *   entries:  [ played ... | current | up next (user) ... | playing from (context) ... ]
 *                             ^ index
 *
 * - "Play next" puts items right after the current entry.
 * - "Add to queue" puts items at the end of the "Up next" block, before the
 *   rest of the album or playlist.
 * - Shuffle reorders the upcoming context entries; turning it off restores
 *   the original order (`original`) around the current entry.
 * - Repeat one replays the current entry when it ends; Next still moves on.
 *   Repeat all wraps from the last entry to the first.
 * - Autoplay entries (`appendAutoplay`, similar songs from `radio.ts`) go at
 *   the very end, after the context.
 */

export type RepeatMode = 'off' | 'all' | 'one';

/** Where the queue came from: "Playing from {name}". */
export interface QueueSource {
  name: string | null;
  id: string | null;
  type: string | null;
}

export interface QueueEntry<T> {
  /** Unique within the queue: the same song can be in the queue twice. */
  key: string;
  item: T;
  /** Added with Play next or Add to queue. */
  user: boolean;
  /** Added by autoplay (similar music after the queue). Absent on every other entry. */
  autoplay?: true;
}

export interface QueueState<T> {
  entries: QueueEntry<T>[];
  /** The current entry, or -1 when the queue is empty. */
  index: number;
  /** Keys of the context entries in their original order. */
  original: string[];
  shuffle: boolean;
  repeat: RepeatMode;
  source: QueueSource | null;
}

export interface QueueDeps {
  makeKey: () => string;
  /** A number in [0, 1). Tests pass a seeded generator. */
  random: () => number;
}

let counter = 0;
export const defaultDeps: QueueDeps = {
  makeKey: () => `q${Date.now().toString(36)}${(counter++).toString(36)}`,
  random: Math.random,
};

export function emptyQueue<T>(): QueueState<T> {
  return { entries: [], index: -1, original: [], shuffle: false, repeat: 'off', source: null };
}

export function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function currentEntry<T>(q: QueueState<T>): QueueEntry<T> | null {
  return q.entries[q.index] ?? null;
}

/** The index that plays when the current entry ends by itself, or null at the end. */
export function upcomingIndex<T>(q: QueueState<T>): number | null {
  if (q.index < 0 || !q.entries.length) return null;
  if (q.repeat === 'one') return q.index;
  if (q.index + 1 < q.entries.length) return q.index + 1;
  return q.repeat === 'all' ? 0 : null;
}

export function upcomingEntry<T>(q: QueueState<T>): QueueEntry<T> | null {
  const i = upcomingIndex(q);
  return i === null ? null : (q.entries[i] ?? null);
}

/** Starts a new queue from a list. With shuffle, the chosen item plays first and the rest is shuffled. */
export function playNow<T>(
  items: readonly T[],
  startIndex: number,
  opts: { shuffle?: boolean; repeat?: RepeatMode; source?: QueueSource | null },
  deps: QueueDeps = defaultDeps,
): QueueState<T> {
  if (!items.length) return { ...emptyQueue<T>(), repeat: opts.repeat ?? 'off' };
  const entries = items.map((item) => ({ key: deps.makeKey(), item, user: false }));
  const original = entries.map((e) => e.key);
  const start = Math.min(Math.max(0, startIndex), entries.length - 1);
  if (!opts.shuffle) {
    return { entries, index: start, original, shuffle: false, repeat: opts.repeat ?? 'off', source: opts.source ?? null };
  }
  const first = entries[start] as QueueEntry<T>;
  const rest = shuffled(entries.filter((_, i) => i !== start), deps.random);
  return { entries: [first, ...rest], index: 0, original, shuffle: true, repeat: opts.repeat ?? 'off', source: opts.source ?? null };
}

/** The end of the "Up next" block: the index after the last user entry that follows the current one. */
function userBlockEnd<T>(q: QueueState<T>): number {
  let i = q.index + 1;
  while (i < q.entries.length && q.entries[i]?.user) i++;
  return i;
}

function insertAt<T>(q: QueueState<T>, at: number, items: readonly T[], deps: QueueDeps): QueueState<T> {
  const added = items.map((item) => ({ key: deps.makeKey(), item, user: true }));
  const entries = [...q.entries.slice(0, at), ...added, ...q.entries.slice(at)];
  return { ...q, entries };
}

/** Plays these items after the current one. On an empty queue they start a new queue. */
export function playNext<T>(q: QueueState<T>, items: readonly T[], deps: QueueDeps = defaultDeps): QueueState<T> {
  if (!items.length) return q;
  if (q.index < 0) return { ...playNow(items, 0, { repeat: q.repeat }, deps), shuffle: false };
  return insertAt(q, q.index + 1, items, deps);
}

/** Adds these items at the end of "Up next". On an empty queue they start a new queue. */
export function addToQueue<T>(q: QueueState<T>, items: readonly T[], deps: QueueDeps = defaultDeps): QueueState<T> {
  if (!items.length) return q;
  if (q.index < 0) return { ...playNow(items, 0, { repeat: q.repeat }, deps), shuffle: false };
  return insertAt(q, userBlockEnd(q), items, deps);
}

/**
 * Moves an upcoming entry. `from` and `to` are entry indices; both must be
 * after the current entry (the played part and the current entry stay put).
 */
export function moveEntry<T>(q: QueueState<T>, from: number, to: number): QueueState<T> {
  const min = q.index + 1;
  const max = q.entries.length - 1;
  if (from < min || from > max) return q;
  const target = Math.min(Math.max(to, min), max);
  if (target === from) return q;
  const entries = [...q.entries];
  const [moved] = entries.splice(from, 1);
  if (!moved) return q;
  entries.splice(target, 0, moved);
  return { ...q, entries };
}

/** Removes an upcoming entry. The current entry cannot be removed (skip it instead). */
export function removeEntry<T>(q: QueueState<T>, key: string): QueueState<T> {
  const at = q.entries.findIndex((e) => e.key === key);
  if (at < 0 || at === q.index) return q;
  const entries = q.entries.filter((e) => e.key !== key);
  return { ...q, entries, index: at < q.index ? q.index - 1 : q.index, original: q.original.filter((k) => k !== key) };
}

/** Removes everything after the current entry. */
export function clearUpcoming<T>(q: QueueState<T>): QueueState<T> {
  if (q.index < 0) return q;
  const keep = q.entries.slice(0, q.index + 1);
  const keys = new Set(keep.map((e) => e.key));
  return { ...q, entries: keep, original: q.original.filter((k) => keys.has(k)) };
}

/**
 * Puts another item in the entry with this key, which keeps its key and its
 * place (a catalog song that the server saved under its real id). The same
 * queue when there is no such entry.
 */
export function replaceItem<T>(q: QueueState<T>, key: string, item: T): QueueState<T> {
  const at = q.entries.findIndex((e) => e.key === key);
  const old = q.entries[at];
  if (!old) return q;
  const entries = [...q.entries];
  entries[at] = { ...old, item };
  return { ...q, entries };
}

/**
 * Adds autoplay entries at the end of the queue. They are context entries
 * (in `original` too), so turning shuffle off keeps them.
 */
export function appendAutoplay<T>(q: QueueState<T>, items: readonly T[], deps: QueueDeps = defaultDeps): QueueState<T> {
  if (!items.length || q.index < 0) return q;
  const added: QueueEntry<T>[] = items.map((item) => ({ key: deps.makeKey(), item, user: false, autoplay: true }));
  return { ...q, entries: [...q.entries, ...added], original: [...q.original, ...added.map((e) => e.key)] };
}

/** Removes the upcoming autoplay entries (autoplay was turned off). The current entry stays. */
export function dropAutoplay<T>(q: QueueState<T>): QueueState<T> {
  const drop = new Set(q.entries.filter((e, i) => e.autoplay && i > q.index).map((e) => e.key));
  if (!drop.size) return q;
  return { ...q, entries: q.entries.filter((e) => !drop.has(e.key)), original: q.original.filter((k) => !drop.has(k)) };
}

/** Makes the entry with this key current. */
export function jumpTo<T>(q: QueueState<T>, key: string): QueueState<T> {
  const at = q.entries.findIndex((e) => e.key === key);
  return at < 0 ? q : { ...q, index: at };
}

/**
 * The queue after the current entry ends. `manual` is a Next press: it moves
 * on even with Repeat one. Null means the end of the queue.
 */
export function advance<T>(q: QueueState<T>, manual = false): QueueState<T> | null {
  if (q.index < 0) return null;
  if (q.repeat === 'one' && !manual) return q;
  if (q.index + 1 < q.entries.length) return { ...q, index: q.index + 1 };
  if (q.repeat === 'all' || (q.repeat === 'one' && manual)) return q.entries.length ? { ...q, index: 0 } : null;
  return null;
}

/** The previous entry, or null at the start (with Repeat all it wraps to the last). */
export function back<T>(q: QueueState<T>): QueueState<T> | null {
  if (q.index > 0) return { ...q, index: q.index - 1 };
  if (q.index === 0 && q.repeat === 'all' && q.entries.length > 1) return { ...q, index: q.entries.length - 1 };
  return null;
}

export function setRepeat<T>(q: QueueState<T>, repeat: RepeatMode): QueueState<T> {
  return { ...q, repeat };
}

export function nextRepeat(r: RepeatMode): RepeatMode {
  return r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
}

export function setShuffle<T>(q: QueueState<T>, on: boolean, deps: QueueDeps = defaultDeps): QueueState<T> {
  if (on === q.shuffle) return q;
  if (q.index < 0) return { ...q, shuffle: on };
  const end = userBlockEnd(q);
  const head = q.entries.slice(0, end);
  if (on) {
    const rest = shuffled(q.entries.slice(end), deps.random);
    return { ...q, entries: [...head, ...rest], shuffle: true };
  }
  const current = q.entries[q.index] as QueueEntry<T>;
  const byKey = new Map(q.entries.map((e) => [e.key, e] as const));
  const userBlock = q.entries.slice(q.index + 1, end);
  const userKeys = new Set(userBlock.map((e) => e.key));
  const context = q.original.map((k) => byKey.get(k)).filter((e): e is QueueEntry<T> => !!e && !userKeys.has(e.key));
  if (!current.user) {
    // Album order around the current entry: the queue continues with the next song of the album.
    const p = context.findIndex((e) => e.key === current.key);
    const before = context.slice(0, p);
    const after = context.slice(p + 1);
    return { ...q, entries: [...before, current, ...userBlock, ...after], index: before.length, shuffle: false };
  }
  // A user entry is current: keep what was played, then the rest of the context in its original order.
  const order = new Map(q.original.map((k, i) => [k, i] as const));
  const rest = q.entries.slice(end).sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9));
  return { ...q, entries: [...head, ...rest], shuffle: false };
}

export interface QueueSections<T> {
  current: QueueEntry<T> | null;
  /** User-added entries right after the current one. */
  upNext: { entry: QueueEntry<T>; index: number }[];
  /** The rest of the album, playlist or mix. */
  rest: { entry: QueueEntry<T>; index: number }[];
  /** Similar music that autoplay added after the queue. */
  autoplay: { entry: QueueEntry<T>; index: number }[];
}

export function queueSections<T>(q: QueueState<T>): QueueSections<T> {
  const end = userBlockEnd(q);
  const at = (from: number, to: number) => q.entries.slice(from, to).map((entry, i) => ({ entry, index: from + i }));
  const after = q.index < 0 ? [] : at(end, q.entries.length);
  return {
    current: currentEntry(q),
    upNext: q.index < 0 ? [] : at(q.index + 1, end),
    rest: after.filter((r) => !r.entry.autoplay),
    autoplay: after.filter((r) => r.entry.autoplay),
  };
}

/** The upcoming entries in play order (for "what plays after this"). */
export function upcomingEntries<T>(q: QueueState<T>): QueueEntry<T>[] {
  return q.index < 0 ? [] : q.entries.slice(q.index + 1);
}

/** Checks a queue read back from storage. Anything malformed gives null. */
export function restoreQueue<T>(raw: unknown, isItem: (v: unknown) => v is T): QueueState<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QueueState<unknown>>;
  if (!Array.isArray(r.entries) || typeof r.index !== 'number') return null;
  const entries: QueueEntry<T>[] = [];
  for (const e of r.entries) {
    if (!e || typeof e !== 'object') return null;
    const { key, item, user, autoplay } = e as Partial<QueueEntry<unknown>>;
    if (typeof key !== 'string' || !isItem(item)) return null;
    entries.push(autoplay === true ? { key, item, user: user === true, autoplay: true } : { key, item, user: user === true });
  }
  if (!entries.length) return null;
  const index = Math.min(Math.max(0, Math.floor(r.index)), entries.length - 1);
  const keys = new Set(entries.map((e) => e.key));
  const original = Array.isArray(r.original) ? r.original.filter((k): k is string => typeof k === 'string' && keys.has(k)) : [];
  const repeat: RepeatMode = r.repeat === 'all' || r.repeat === 'one' ? r.repeat : 'off';
  const s = r.source as Partial<QueueSource> | null | undefined;
  const source = s && typeof s === 'object' ? { name: s.name ?? null, id: s.id ?? null, type: s.type ?? null } : null;
  return { entries, index, original, shuffle: r.shuffle === true, repeat, source };
}
