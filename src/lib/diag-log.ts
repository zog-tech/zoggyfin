/**
 * The player log for bug reports: a ring buffer of short entries that stays
 * on in release builds, and the plain-text report built from it.
 *
 * Rules:
 * - An entry is `{ t, area, event, data }`. `data` is a flat record of
 *   strings, numbers, booleans and null.
 * - Nothing private goes in. Call sites pass only ids (cut to 8 characters
 *   with `shortId`), kinds (`uriKind`), counts, flags and times: never a
 *   URL, a token, a server address, a user name, a file path, an item name
 *   or an artist name. The sanitizer below is the second line: it removes
 *   whatever looks like a URL, a query string, a key or token, a path, a
 *   host or an e-mail address from every string, and cuts it short.
 * - The log keeps the last `DIAG_MAX_ENTRIES` entries. Its saved form is
 *   versioned and has a size cap; the parser never throws.
 *
 * Pure, so it is unit-tested. `diag-store.ts` holds the log and saves it.
 */

export type DiagValue = string | number | boolean | null;
export type DiagData = Record<string, DiagValue>;

export interface DiagEntry {
  /** When (ms since 1970). */
  t: number;
  area: string;
  event: string;
  data?: DiagData;
}

export const DIAG_MAX_ENTRIES = 600;
/** The saved form drops the oldest entries until it is this short (characters). */
export const DIAG_MAX_SAVED_CHARS = 150_000;
export const DIAG_VERSION = 1;
/** A string value is cut to this length. */
export const DIAG_MAX_STRING = 80;
const MAX_KEYS = 16;
const MAX_NAME = 24;

/** Cuts and cleans a string so that it holds no URL, secret, path, host or e-mail address. */
export function sanitizeString(input: string, max = DIAG_MAX_STRING): string {
  let s = String(input);
  s = s.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>');
  s = s.replace(/\b(?:file|data|blob|content|ph|assets-library):\S*/gi, '<url>');
  s = s.replace(/\b(?:api_?key|access_?token|token|password|pw|auth|x-emby-token|authorization)\b\s*[=:]\s*\S*/gi, '<secret>');
  s = s.replace(/\?\S+/g, '<query>');
  s = s.replace(/\S+@\S+/g, '<email>');
  s = s.replace(/(^|[\s('"=])(?:~|\.{1,2})?\/\S+/g, '$1<path>');
  s = s.replace(/\b[a-z]:\\\S*/gi, '<path>');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<addr>');
  // IPv6: "::" or at least four colons, so a time such as 12:34:56 stays.
  s = s.replace(/\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?/gi, (m) => (m.includes('::') || m.split(':').length >= 5 ? '<addr>' : m));
  s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b(?::\d+)?/gi, '<host>');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A value for an entry: numbers rounded to 3 decimals, strings cleaned, anything else as a short kind. */
export function sanitizeValue(v: unknown): DiagValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : String(v);
  if (typeof v === 'string') return sanitizeString(v);
  return `<${typeof v}>`;
}

function cleanName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, MAX_NAME) || '?';
}

/** The data of an entry: at most 16 keys with plain names and clean values. Undefined values are left out. */
export function sanitizeData(data: Record<string, unknown> | undefined | null): DiagData | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const out: DiagData = {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (n >= MAX_KEYS) break;
    out[cleanName(k)] = sanitizeValue(v);
    n += 1;
  }
  return n ? out : undefined;
}

/** A clean entry. */
export function makeEntry(t: number, area: string, event: string, data?: Record<string, unknown> | null): DiagEntry {
  const d = sanitizeData(data);
  const e: DiagEntry = { t: Number.isFinite(t) ? t : 0, area: cleanName(area), event: cleanName(event) };
  if (d) e.data = d;
  return e;
}

/** What a URI is, with nothing of the URI itself. */
export function uriKind(uri: string | null | undefined): 'http' | 'file' | 'other' | 'none' {
  if (!uri) return 'none';
  if (/^https?:/i.test(uri)) return 'http';
  if (/^file:/i.test(uri) || uri.startsWith('/')) return 'file';
  return 'other';
}

/** The first 8 characters of an id (an item id or a queue key), letters and digits only. */
export function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || null;
}

/** The message of an error, cleaned. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return sanitizeString(`${e.name}: ${e.message}`);
  if (typeof e === 'string') return sanitizeString(e);
  return `<${typeof e}>`;
}

/** Adds an entry and keeps the last `max`. Returns a new array. */
export function appendEntry(entries: readonly DiagEntry[], entry: DiagEntry, max = DIAG_MAX_ENTRIES): DiagEntry[] {
  const keep = Math.max(0, max - 1);
  const from = entries.length > keep ? entries.length - keep : 0;
  return [...entries.slice(from), entry];
}

/** The saved form: versioned JSON, with the oldest entries dropped until it fits `maxChars`. */
export function serializeLog(entries: readonly DiagEntry[], maxChars = DIAG_MAX_SAVED_CHARS): string {
  let list = entries.slice(-DIAG_MAX_ENTRIES);
  let text = JSON.stringify({ v: DIAG_VERSION, entries: list });
  while (text.length > maxChars && list.length) {
    // Drop about a tenth at a time: one JSON pass per step.
    list = list.slice(Math.max(1, Math.ceil(list.length / 10)));
    text = JSON.stringify({ v: DIAG_VERSION, entries: list });
  }
  return text;
}

function parseEntry(raw: unknown): DiagEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.t !== 'number' || typeof r.area !== 'string' || typeof r.event !== 'string') return null;
  const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
  return makeEntry(r.t, r.area, r.event, data);
}

/** Reads the saved form. Anything it does not know gives an empty log; it never throws. */
export function parseLog(raw: string | null | undefined): DiagEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const p = parsed as { v?: unknown; entries?: unknown };
    if (p.v !== DIAG_VERSION || !Array.isArray(p.entries)) return [];
    const out: DiagEntry[] = [];
    for (const e of p.entries.slice(-DIAG_MAX_ENTRIES)) {
      const entry = parseEntry(e);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `HH:MM:SS.mmm` in local time. */
export function formatTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `+01:00` for the local offset at `t`. */
export function zoneOffset(t: number): string {
  const minutes = -new Date(t).getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** One line: time, area, event, then `key=value` pairs. */
export function formatEntry(e: DiagEntry): string {
  const pairs = e.data ? Object.entries(e.data).map(([k, v]) => `${k}=${v === null ? 'null' : String(v)}`) : [];
  return [formatTime(e.t), e.area, e.event, ...pairs].join(' ');
}

export interface ReportInfo {
  appVersion: string;
  /** The running over-the-air update, or null for the code in the build. */
  updateId: string | null;
  runtimeVersion: string | null;
  platform: string;
  osVersion: string;
  lite: boolean;
  /** When the report was made (ms). */
  now: number;
}

/** The report as plain text: a header, the user's words, then the log (oldest first). */
export function buildReport(info: ReportInfo, userText: string, entries: readonly DiagEntry[]): string {
  const d = new Date(info.now);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(info.now)} ${zoneOffset(info.now)}`;
  const text = userText.trim();
  return [
    'Zoggyfin problem report',
    `App version: ${info.appVersion}`,
    `Update: ${info.updateId ?? 'none (build code)'}`,
    `Runtime version: ${info.runtimeVersion ?? 'unknown'}`,
    `Platform: ${info.platform} ${info.osVersion}`,
    `Lite mode: ${info.lite ? 'on' : 'off'}`,
    `Time: ${date}`,
    '',
    'What went wrong:',
    text || '(no text)',
    '',
    `Player log (${entries.length} entries, oldest first):`,
    ...entries.map(formatEntry),
    '',
  ].join('\n');
}
