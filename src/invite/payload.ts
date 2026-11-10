/**
 * The invite link: `https://zoggyfin.zog-tech.com/join#<payload>`.
 *
 * The payload is in the URL fragment. A browser does not send the fragment to
 * the web server, so the one-time password never gets into server logs. The
 * payload is base64url JSON with a version field. Pure, so it is unit-tested.
 *
 * Never log a payload or a link: the one-time password is in it.
 */
import { normalizeServerUrl } from '@/api/server-url';
import type { AddressKind, ServerAddress } from '@/servers/addresses';

export const INVITE_VERSION = 1;
export const INVITE_SITE = 'https://zoggyfin.zog-tech.com/join';
export const INVITE_SCHEME = 'zoggyfin://join';

/** An invite works this long after it is made (or sent again), days. */
export const INVITE_DAYS = 7;
export const INVITE_LIFETIME_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

/** Size limits. The QR code and some messaging apps need a short link. */
export const LIMITS = {
  encoded: 4096,
  serverId: 64,
  serverName: 100,
  url: 512,
  addresses: 8,
  userName: 128,
  passwordMin: 12,
  passwordMax: 128,
  inviter: 100,
  extensions: 10,
} as const;

/**
 * Where an address works: on the internet, over Tailscale, over another VPN
 * (WireGuard), or only on the home network.
 */
export type AddressLabel = 'internet' | 'tailscale' | 'vpn' | 'home';

export interface InviteAddress {
  url: string;
  label: AddressLabel;
}

/** The data in an invite. */
export interface Invite {
  serverId: string;
  serverName: string;
  /** All addresses to try, in order. The app uses the first one that answers as this server. */
  addresses: InviteAddress[];
  userName: string;
  /** The one-time password. The person changes it at the first sign-in. */
  password: string;
  inviter: string;
  /** The manifest URLs of the inviter's extensions. Optional. */
  extensions?: string[];
  /** When the link stops working, epoch ms. Optional: an invite of an older app has none. */
  expiresAt?: number;
}

/** The JSON form, with short keys so the link stays short. */
interface Wire {
  v: number;
  sid: string;
  sn: string;
  /** Addresses: [url, label letter]. */
  a: [string, string][];
  u: string;
  p: string;
  by: string;
  x?: string[];
  /** Expiry, epoch seconds. */
  e?: number;
}

// ---- base64url of UTF-8 -----------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** Strict UTF-8 decoding: null on a bad sequence. */
function utf8Decode(bytes: number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    let n: number;
    if (b < 0x80) [cp, n] = [b, 0];
    else if (b >= 0xc2 && b < 0xe0) [cp, n] = [b & 0x1f, 1];
    else if (b >= 0xe0 && b < 0xf0) [cp, n] = [b & 0x0f, 2];
    else if (b >= 0xf0 && b < 0xf5) [cp, n] = [b & 0x07, 3];
    else return null;
    if (i + n >= bytes.length + (n ? 0 : 1)) return null;
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 63);
    }
    if ((n === 2 && cp < 0x800) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

export function base64UrlEncode(text: string): string {
  const bytes = utf8Encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += B64[c & 63];
  }
  return out;
}

/** Null when the text is not valid base64url of UTF-8. */
export function base64UrlDecode(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of text) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

const LABEL_LETTER: Record<AddressLabel, string> = { internet: 'i', tailscale: 't', vpn: 'v', home: 'h' };
const LETTER_LABEL: Record<string, AddressLabel | undefined> = { i: 'internet', t: 'tailscale', v: 'vpn', h: 'home' };

/** Only a home network address needs the internal kind; the others work away from home. */
export function kindForLabel(label: AddressLabel): AddressKind {
  return label === 'home' ? 'internal' : 'external';
}

/** The addresses to save for the person's copy of the server. */
export function savedAddresses(invite: Pick<Invite, 'addresses'>): ServerAddress[] {
  return invite.addresses.map((a) => ({ url: a.url, kind: kindForLabel(a.label) }));
}

/** True when every address needs Tailscale or a VPN: the person must connect to it first. */
export function needsTunnel(addresses: readonly InviteAddress[]): 'tailscale' | 'vpn' | null {
  if (!addresses.length || addresses.some((a) => a.label === 'internet' || a.label === 'home')) return null;
  return addresses.every((a) => a.label === 'tailscale') ? 'tailscale' : 'vpn';
}

// ---- Validation -------------------------------------------------------------------

export type InviteError = 'format' | 'version' | 'field' | 'address';

export type DecodeResult = { ok: true; invite: Invite } | { ok: false; error: InviteError };

function text(v: unknown, min: number, max: number): v is string {
  return typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
}

/** An http or https address with no user info, normalized. Null otherwise. */
export function safeServerUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMITS.url || !/^https?:\/\//i.test(v)) return null;
  return normalizeServerUrl(v);
}

function safeManifestUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LIMITS.url && /^https?:\/\/[^\s/?#@]+(\/[^\s]*)?$/i.test(v);
}

/** Checks every field. Unknown keys are ignored, so a newer minor field does not break an older app. */
export function validateWire(raw: unknown): DecodeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'format' };
  const w = raw as Partial<Wire>;
  if (w.v !== INVITE_VERSION) return { ok: false, error: 'version' };
  if (!text(w.sid, 1, LIMITS.serverId) || !/^[0-9a-f-]+$/i.test(w.sid)) return { ok: false, error: 'field' };
  if (!text(w.sn, 1, LIMITS.serverName)) return { ok: false, error: 'field' };
  if (!text(w.u, 1, LIMITS.userName)) return { ok: false, error: 'field' };
  if (!text(w.p, LIMITS.passwordMin, LIMITS.passwordMax)) return { ok: false, error: 'field' };
  if (!text(w.by, 0, LIMITS.inviter)) return { ok: false, error: 'field' };
  if (!Array.isArray(w.a) || w.a.length < 1 || w.a.length > LIMITS.addresses) return { ok: false, error: 'address' };
  const addresses: InviteAddress[] = [];
  for (const entry of w.a) {
    if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, error: 'address' };
    const url = safeServerUrl(entry[0]);
    const label = typeof entry[1] === 'string' ? LETTER_LABEL[entry[1]] : undefined;
    if (!url || !label) return { ok: false, error: 'address' };
    if (!addresses.some((a) => a.url === url)) addresses.push({ url, label });
  }
  let extensions: string[] | undefined;
  if (w.x !== undefined) {
    if (!Array.isArray(w.x) || w.x.length > LIMITS.extensions || !w.x.every(safeManifestUrl)) return { ok: false, error: 'field' };
    extensions = [...new Set(w.x)];
  }
  // An expiry from 2020 to 2100, in whole seconds.
  if (w.e !== undefined && (typeof w.e !== 'number' || !Number.isInteger(w.e) || w.e < 1_577_836_800 || w.e > 4_102_444_800)) return { ok: false, error: 'field' };
  const invite: Invite = { serverId: w.sid, serverName: w.sn, addresses, userName: w.u, password: w.p, inviter: w.by };
  if (extensions?.length) invite.extensions = extensions;
  if (w.e !== undefined) invite.expiresAt = w.e * 1000;
  return { ok: true, invite };
}

export function encodeInvite(invite: Invite): string {
  const wire: Wire = {
    v: INVITE_VERSION,
    sid: invite.serverId,
    sn: invite.serverName,
    a: invite.addresses.map((a) => [a.url, LABEL_LETTER[a.label]]),
    u: invite.userName,
    p: invite.password,
    by: invite.inviter,
  };
  if (invite.extensions?.length) wire.x = invite.extensions;
  if (invite.expiresAt !== undefined) wire.e = Math.floor(invite.expiresAt / 1000);
  return base64UrlEncode(JSON.stringify(wire));
}

export function decodeInvite(link: string): DecodeResult {
  const payload = link.replace(/\./g, '');
  if (!payload || payload.length > LIMITS.encoded) return { ok: false, error: 'format' };
  const json = base64UrlDecode(payload);
  if (json === null) return { ok: false, error: 'format' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'format' };
  }
  return validateWire(raw);
}

// ---- Links ------------------------------------------------------------------------

/**
 * Characters of the payload between two dots in a link. Apple's link finder
 * (Messages, Notes, Mail) stops a link before a run of more than about 300
 * letters and digits, so the person gets only `…/join` as a link. A dot
 * breaks the run. The readers remove the dots (`payloadFromText`,
 * `decodeInvite`, the /join page).
 */
export const LINK_CHUNK = 200;

/** The payload with a dot after every `LINK_CHUNK` characters, never at the end. */
export function linkPayload(payload: string): string {
  const parts: string[] = [];
  for (let i = 0; i < payload.length; i += LINK_CHUNK) parts.push(payload.slice(i, i + LINK_CHUNK));
  return parts.join('.');
}

export function inviteLink(invite: Invite): string {
  return `${INVITE_SITE}#${linkPayload(encodeInvite(invite))}`;
}

/**
 * `https://zoggyfin.zog-tech.com/join#P`, `zoggyfin://join#P`, and
 * `zoggyfin://join/P` (Android intent links keep the invite in the path,
 * because the fragment of an intent link holds the intent fields).
 */
const LINK_RE = /(?:https:\/\/zoggyfin\.zog-tech\.com\/join\/?#|zoggyfin:\/\/join(?:\/?#|\/))([A-Za-z0-9_.-]+)/i;

/**
 * The payload of an invite link in a text: the link alone, or the whole
 * message that has the link in it. Null when there is no invite link.
 */
export function payloadFromText(input: string): string | null {
  const m = LINK_RE.exec(input);
  // The dots of `linkPayload` go; a dot at the end is the end of the sentence.
  const payload = m ? m[1].replace(/\./g, '') : '';
  return payload || null;
}

/** A day for the invite texts, such as "October 27, 2026". */
export function inviteDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** True when the invite has an expiry and it is past. */
export function inviteExpired(invite: Pick<Invite, 'expiresAt'>, now: number): boolean {
  return invite.expiresAt !== undefined && now >= invite.expiresAt;
}

/** The share text. The link stands alone on its line, so messaging apps find all of it. */
export function inviteMessage(invite: Pick<Invite, 'inviter' | 'serverName' | 'expiresAt'>, link: string): string {
  const who = invite.inviter.trim() || 'Someone';
  const text = `${who} invited you to watch on ${invite.serverName}. Open this link to join: ${link}`;
  return invite.expiresAt === undefined ? text : `${text}\nThis link works until ${inviteDate(invite.expiresAt)}.`;
}

/** What the person reads when the invite is past its expiry. */
export function inviteExpiredText(invite: Pick<Invite, 'inviter' | 'expiresAt'>): string {
  const who = invite.inviter.trim() || 'the person who invited you';
  const when = invite.expiresAt === undefined ? '' : ` on ${inviteDate(invite.expiresAt)}`;
  return `This invite expired${when}. Invites work for ${INVITE_DAYS} days. Ask ${who} to send it again.`;
}

export function inviteErrorText(e: InviteError): string {
  switch (e) {
    case 'version':
      return 'This invite is from a newer version of Zoggyfin. Update the app, then open the link again.';
    case 'address':
      return 'The server address in this invite is not correct. Ask for a new invite.';
    default:
      return 'This invite link is not complete. Copy the full link and try again.';
  }
}
