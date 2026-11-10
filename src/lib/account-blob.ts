/**
 * The generic parts of a synced blob in the Jellyfin account (Live TV and
 * extensions use them): per-entry stamps with removal markers, the merge
 * of two stamped maps, a stable JSON text, and the split of a large text
 * into numbered DisplayPreferences `CustomPrefs` values.
 *
 * Rules:
 * - Per entry the newer stamp wins. On the same stamp a removal wins, then
 *   the first map (callers pass the account's map first, so the server
 *   decides a tie).
 * - Removal markers older than 30 days go (every device has seen them).
 * - Reading data from the server never throws: bad entries are dropped.
 *
 * Pure, so it is unit-tested (through `iptv/__tests__/account-sync.test.ts`
 * and `extensions/__tests__/sync-blob.test.ts`).
 */

/** Removal markers older than this are dropped. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 3_600_000;
/** One CustomPrefs value holds at most this many characters; a larger blob is split into numbered keys. */
export const SYNC_CHUNK_CHARS = 200_000;
/** The most chunks a reader accepts. */
export const MAX_CHUNKS = 64;

/** A stamp of an entry: when it was added or changed, or removed (`del`). */
export interface Stamp {
  at: number;
  del?: true;
}

/** An entry in the blob: a stamp and, while it is not removed, its value. */
export interface Stamped<T> extends Stamp {
  val?: T;
}

export type StampedMap<T> = Record<string, Stamped<T>>;
export type StampMap = Record<string, Stamp>;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** JSON with sorted object keys, so equal data gives equal text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** A short hash (cyrb53). Not for security: it only tells that something changed, without keeping it. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * One entry: the newer stamp wins; on the same stamp a removal wins, then
 * `a` (callers pass the account's map first, so the server decides a tie).
 */
export function pickStamped<T>(a: Stamped<T> | undefined, b: Stamped<T> | undefined): Stamped<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.del || b.del) return a.del ? a : b;
  return a.val === undefined ? b : a;
}

/**
 * Merges two entry maps: per entry the newer stamp wins. Removal markers
 * older than the TTL go. Of the entries that are not removed, the newest
 * `max` stay (the older ones go with no marker, like on the device).
 */
export function mergeStamped<T>(a: StampedMap<T> | undefined, b: StampedMap<T> | undefined, now: number, max: number): StampedMap<T> {
  const out: StampedMap<T> = {};
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const e = pickStamped(a?.[id], b?.[id]);
    if (!e) continue;
    if (e.del && now - e.at > TOMBSTONE_TTL_MS) continue;
    out[id] = e;
  }
  const alive = Object.entries(out).filter(([, e]) => !e.del);
  if (alive.length > max) {
    alive.sort((x, y) => y[1].at - x[1].at);
    for (const [id] of alive.slice(max)) delete out[id];
  }
  return out;
}

/** The stamps of a stamped map, without the values. */
export function stampsOf<T>(m: StampedMap<T> | undefined): StampMap {
  const out: StampMap = {};
  for (const [id, e] of Object.entries(m ?? {})) out[id] = e.del ? { at: e.at, del: true } : { at: e.at };
  return out;
}

/** The entries that are not removed, newest first (ties by id). */
export function sortedAlive<T>(m: StampedMap<T> | undefined): [string, Stamped<T>][] {
  return Object.entries(m ?? {})
    .filter(([, e]) => !e.del)
    .sort((x, y) => y[1].at - x[1].at || (x[0] < y[0] ? -1 : 1));
}

/**
 * Reads a stamped map from the server. An entry with a bad stamp goes; a
 * value that `value` cannot read (null) leaves the stamp with no value.
 * At most `maxEntries` entries are read.
 */
export function readStampedMap<T>(raw: unknown, value: (id: string, v: unknown) => T | null, maxEntries: number): StampedMap<T> {
  const out: StampedMap<T> = {};
  if (!isObject(raw)) return out;
  let n = 0;
  for (const [id, e] of Object.entries(raw)) {
    if (n >= maxEntries) break;
    if (!id || !isObject(e) || !isNum(e.at)) continue;
    n++;
    if (e.del === true) out[id] = { at: e.at, del: true };
    else {
      const val = e.val === undefined ? null : value(id, e.val);
      out[id] = val === null ? { at: e.at } : { at: e.at, val };
    }
  }
  return out;
}

export type CustomPrefs = Record<string, string | null | undefined> | null | undefined;

/** The CustomPrefs keys of one blob: `<prefix>.parts` and `<prefix>.<n>`. */
export interface ChunkCodec {
  partsKey: string;
  chunkKey(i: number): string;
  /** The CustomPrefs values for a blob text: numbered parts and their count. */
  encode(text: string): Record<string, string>;
  /** True for a CustomPrefs key this codec writes. */
  isKey(k: string): boolean;
  /** The blob text in the CustomPrefs, or null (none, or parts missing). Never throws. */
  decode(prefs: CustomPrefs): string | null;
  /** The CustomPrefs to send: the other keys as they are and the blob's keys new. */
  withText(prefs: CustomPrefs, text: string): Record<string, string>;
}

/** The chunk keys for one prefix (`iptv`, `ext`). The prefix must not hold regex characters. */
export function chunkCodec(prefix: string, chunkChars = SYNC_CHUNK_CHARS): ChunkCodec {
  const partsKey = `${prefix}.parts`;
  const chunkKey = (i: number) => `${prefix}.${i}`;
  const pattern = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.\\d+$`);
  const isKey = (k: string) => k === partsKey || pattern.test(k);
  const encode = (text: string) => {
    const out: Record<string, string> = {};
    const n = Math.max(1, Math.ceil(text.length / chunkChars));
    for (let i = 0; i < n; i++) out[chunkKey(i)] = text.slice(i * chunkChars, (i + 1) * chunkChars);
    out[partsKey] = String(n);
    return out;
  };
  return {
    partsKey,
    chunkKey,
    encode,
    isKey,
    decode(prefs) {
      if (!prefs) return null;
      const n = Number(prefs[partsKey]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return null;
      let text = '';
      for (let i = 0; i < n; i++) {
        const part = prefs[chunkKey(i)];
        if (typeof part !== 'string') return null;
        text += part;
      }
      return text;
    },
    withText(prefs, text) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(prefs ?? {})) if (!isKey(k) && typeof v === 'string') out[k] = v;
      return { ...out, ...encode(text) };
    },
  };
}
