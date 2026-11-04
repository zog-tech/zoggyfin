/**
 * The Xtream Codes API: URLs and answers. Requests go through the transport
 * (`transport*.ts`); this file only builds URLs and reads JSON, so it holds
 * no I/O. URLs here hold the password: never log them or put them in an
 * error. Pure, so it is unit-tested.
 */
import type { Channel, Programme } from './types';
import { decodeBase64Text } from './utf8';

export interface XtreamLogin {
  server: string;
  username: string;
  password: string;
}

/**
 * The panel address from what a person typed: adds `http://`, drops a path
 * such as `/player_api.php` or `/get.php` and a trailing slash. A full
 * `get.php?username=…&password=…` link also gives the user name and password.
 */
export function normalizeXtreamInput(raw: string): { server: string; username?: string; password?: string } | null {
  let text = raw.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(text);
  if (!m) return null;
  const host = m[2];
  if (!/^[\w.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/i.test(host)) return null;
  let path = m[3].replace(/\/+$/, '');
  path = path.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, '').replace(/\/c$/i, '');
  const server = `${m[1].toLowerCase()}://${host}${path}`;
  const out: { server: string; username?: string; password?: string } = { server };
  if (m[4]) {
    const params = new URLSearchParams(m[4].slice(1));
    const u = params.get('username');
    const p = params.get('password');
    if (u) out.username = u;
    if (p) out.password = p;
  }
  return out;
}

function q(value: string): string {
  return encodeURIComponent(value);
}

/** A `player_api.php` URL. With no action it is the login check. */
export function xtreamApiUrl(login: XtreamLogin, action?: string, params: Record<string, string | number> = {}): string {
  let url = `${login.server}/player_api.php?username=${q(login.username)}&password=${q(login.password)}`;
  if (action) url += `&action=${q(action)}`;
  for (const [k, v] of Object.entries(params)) url += `&${q(k)}=${q(String(v))}`;
  return url;
}

/** The live stream URL. `ext` is `m3u8` (HLS) or `ts`. */
export function xtreamLiveUrl(login: XtreamLogin, streamId: number, ext: 'm3u8' | 'ts'): string {
  return `${login.server}/live/${q(login.username)}/${q(login.password)}/${streamId}.${ext}`;
}

export type XtreamAuth = { ok: true; expires: number | null; maxConnections: number | null; activeConnections: number | null } | { ok: false; reason: 'denied' | 'expired' | 'disabled' | 'answer' };

export function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** Reads the login answer (`user_info`). */
export function parseXtreamAuth(json: unknown): XtreamAuth {
  const info = obj(obj(json)?.user_info);
  if (!info) return { ok: false, reason: 'answer' };
  if (num(info.auth) !== 1) return { ok: false, reason: 'denied' };
  const status = str(info.status).toLowerCase();
  if (status === 'expired') return { ok: false, reason: 'expired' };
  if (status && status !== 'active') return { ok: false, reason: 'disabled' };
  const exp = num(info.exp_date);
  return { ok: true, expires: exp ? exp * 1000 : null, maxConnections: num(info.max_connections), activeConnections: num(info.active_cons) };
}

/**
 * Why a stream did not start, when the account is full: the provider allows
 * `max_connections` streams at a time and `active_cons` are in use. Null when
 * the account is not full (or the panel does not say), so the player keeps
 * its own message. An account that is no longer valid says that instead.
 */
export function connectionLimitText(auth: XtreamAuth): string | null {
  if (!auth.ok) return null;
  const max = auth.maxConnections;
  const active = auth.activeConnections;
  if (max === null || active === null || max < 1 || active < max) return null;
  return max === 1 ? 'This provider allows 1 stream at a time, and it is in use.' : `This provider allows ${max} streams at a time, and all are in use.`;
}

/** Category id to name (`get_live_categories`). */
export function parseXtreamCategories(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(json)) return out;
  for (const c of json) {
    const o = obj(c);
    const id = str(o?.category_id);
    if (id) out.set(id, str(o?.category_name));
  }
  return out;
}

/** The live channels (`get_live_streams`), in the provider's order. Entries with no stream id are skipped. */
export function parseXtreamStreams(json: unknown, categories: Map<string, string>): Channel[] {
  if (!Array.isArray(json)) return [];
  const out: Channel[] = [];
  const seen = new Set<string>();
  for (const s of json) {
    const o = obj(s);
    const streamId = num(o?.stream_id);
    if (!o || streamId === null) continue;
    const id = String(streamId);
    if (seen.has(id)) continue;
    seen.add(id);
    const ch: Channel = {
      id,
      name: str(o.name) || `Channel ${id}`,
      group: categories.get(str(o.category_id)) ?? '',
      streamId,
    };
    const logo = str(o.stream_icon);
    if (logo) ch.logo = logo;
    const number = num(o.num);
    if (number !== null) ch.number = number;
    const epg = str(o.epg_channel_id);
    if (epg) ch.epgId = epg;
    const days = num(o.tv_archive_duration);
    if (num(o.tv_archive) === 1 && days) ch.archiveDays = days;
    out.push(ch);
  }
  return out;
}

/** Programmes from `get_short_epg` (titles and descriptions come as base64). */
export function parseXtreamShortEpg(json: unknown): Programme[] {
  const list = obj(json)?.epg_listings;
  if (!Array.isArray(list)) return [];
  const out: Programme[] = [];
  for (const e of list) {
    const o = obj(e);
    if (!o) continue;
    const startTs = num(o.start_timestamp);
    const stopTs = num(o.stop_timestamp);
    const start = startTs !== null ? startTs * 1000 : Date.parse(str(o.start).replace(' ', 'T') + 'Z');
    const stop = stopTs !== null ? stopTs * 1000 : Date.parse(str(o.end).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const prog: Programme = { start, stop, title: decodeBase64Text(str(o.title)) || 'No title' };
    const desc = decodeBase64Text(str(o.description));
    if (desc) prog.description = desc.length > 400 ? `${desc.slice(0, 399)}…` : desc;
    out.push(prog);
  }
  return out.sort((a, b) => a.start - b.start);
}
