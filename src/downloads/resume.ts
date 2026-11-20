/**
 * Resume of a download whose system task is gone (an app restart, a task
 * that the downloader forgot): continue from the partial file with an HTTP
 * Range request. Pure, so the rules are unit-tested; the engines do the I/O.
 *
 * The rules:
 *   - Only the original file can continue. A server transcode has no byte ranges.
 *   - The request asks for `bytes=<partial>-`, with `If-Range` when the first
 *     response gave a validator (a strong ETag or Last-Modified). A changed
 *     file then comes back whole (200), not as a range of the new file.
 *   - A 206 must start at the partial size, and its total must match the
 *     known size. Anything else starts over from 0.
 *   - The remaining bytes go to a second file and are joined at the end, only
 *     when the sizes add up to the total.
 */
import type { DownloadRecord } from './types';

/** What the engine needs to continue a partial file. */
export interface ResumeHint {
  /** The full size, when known (the record's byte total). */
  expectedBytes: number | null;
  /** ETag or Last-Modified of the first response, for If-Range. */
  validator: string | null;
}

/**
 * True when a start of `prev` may keep what an earlier try got: the earlier
 * try and this one download the same original file. The byte count does not
 * decide it: iOS reported 0 bytes for a task that waited for a retry, and that
 * 0 made the next start begin from byte 0 although iOS still held the data.
 * The engine checks what is really there (the partial file, or the library's
 * resume data on iOS) and starts from 0 when there is nothing.
 */
export function canResume(prev: Pick<DownloadRecord, 'method' | 'mediaFile'>, plan: { method: 'original' | 'transcode'; file: string }): boolean {
  return prev.method === 'original' && plan.method === 'original' && !!prev.mediaFile && prev.mediaFile === plan.file;
}

/** The hint that `canResume` records pass to the engine. */
export function resumeHint(r: Pick<DownloadRecord, 'bytesTotal' | 'validator'>): ResumeHint {
  return { expectedBytes: r.bytesTotal && r.bytesTotal > 0 ? r.bytesTotal : null, validator: r.validator ?? null };
}

/**
 * True when a media file on the device is the whole download. A partial file
 * (Android writes to the destination as it goes) is not. With no known size,
 * a file that is there counts as whole.
 */
export function isWholeFile(size: number, r: Pick<DownloadRecord, 'method' | 'bytesTotal'>): boolean {
  if (size <= 0) return false;
  if (r.method === 'transcode' || !r.bytesTotal) return true;
  return size >= r.bytesTotal;
}

/** A header value by name, in any letter case. */
export function headerValue(headers: Record<string, string | null | undefined> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want && v) return v;
  return null;
}

/** A strong ETag, else Last-Modified: the values that If-Range accepts. */
export function validatorOf(headers: Record<string, string | null | undefined> | null | undefined): string | null {
  const etag = headerValue(headers, 'etag');
  if (etag && !etag.startsWith('W/')) return etag;
  return headerValue(headers, 'last-modified');
}

/** The request headers for a continued download. */
export function rangeHeaders(headers: Record<string, string> | undefined, offset: number, validator: string | null): Record<string, string> {
  const out: Record<string, string> = { ...(headers ?? {}), Range: `bytes=${offset}-` };
  if (validator) out['If-Range'] = validator;
  return out;
}

/** `Content-Range: bytes 100-199/1000` → start 100, total 1000 (null for `*`). */
export function parseContentRange(value: string | null | undefined): { start: number; total: number | null } | null {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(value ?? '');
  if (!m) return null;
  return { start: Number(m[1]), total: m[3] === '*' ? null : Number(m[3]) };
}

/** How the server answered a range request. */
export type RangeAnswer =
  /** 206 from the partial size, with a total that matches. */
  | { kind: 'append'; total: number }
  /** 200: the whole file again (no Range support, or If-Range saw a change). */
  | { kind: 'whole' }
  /** A range that does not fit the partial file. */
  | { kind: 'mismatch' };

/**
 * Reads the first response of a range request from its headers. The native
 * downloader does not give the status code, so a Content-Range header marks a 206.
 */
export function rangeAnswer(headers: Record<string, string | null | undefined> | null | undefined, offset: number, expectedBytes: number | null): RangeAnswer {
  const raw = headerValue(headers, 'content-range');
  if (!raw) return { kind: 'whole' };
  const range = parseContentRange(raw);
  if (!range || range.start !== offset) return { kind: 'mismatch' };
  const total = range.total ?? expectedBytes;
  if (!total || total <= offset) return { kind: 'mismatch' };
  if (expectedBytes && total !== expectedBytes) return { kind: 'mismatch' };
  return { kind: 'append', total };
}

/** What to do with the second file when it is complete. */
export type JoinStep = 'append' | 'replace' | 'restart';

/**
 * `append` adds the second file to the partial one; `replace` keeps the
 * second file alone (the server sent the whole file). `answer` is null when
 * the first response came before an app restart. The strict size check also
 * catches a downloader that continued the second file by itself with a Range
 * of its own: its bytes would then not add up.
 */
export function joinStep(p: { offset: number; restBytes: number; total: number | null; answer: RangeAnswer['kind'] | null }): JoinStep {
  if (p.restBytes <= 0) return 'restart';
  if (p.answer === 'whole') return 'replace';
  if (p.answer !== 'mismatch' && p.total && p.offset + p.restBytes === p.total) return 'append';
  return 'restart';
}
