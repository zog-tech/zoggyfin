/**
 * XMLTV guide parser that keeps a small window. It takes the text in chunks
 * and drops what it has read, so a 100 MB guide never sits in memory: for
 * each channel it keeps only the programmes that overlap `from`..`to`, at
 * most a few (now and next for phase 1). The `<channel>` display names are
 * kept too, so a playlist entry with no matching `tvg-id` can match by name.
 * Pure, so it is unit-tested.
 */
import { GUIDE_SCHEMA_VERSION, type GuideWindow, type Programme } from './types';

/** `20261031203000 +0100` (seconds and the offset may be missing; no offset is UTC) to ms, or NaN. */
export function parseXmltvTime(text: string | undefined): number {
  if (!text) return Number.NaN;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(text.trim());
  if (!m) return Number.NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  if (!m[7]) return utc;
  const offset = (+m[8] * 60 + +m[9]) * 60_000;
  return m[7] === '+' ? utc - offset : utc + offset;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: String.fromCharCode(0xa0) };

/** Decodes XML entities and CDATA. */
export function decodeXml(text: string): string {
  const cdata = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => body.replace(/&/g, '&amp;'));
  return cdata.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      try {
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) out[m[1]] = decodeXml(m[2] ?? m[3] ?? '');
  return out;
}

/** The text of the first `<name>` element in `body`, or null. */
function firstText(body: string, name: string): string | null {
  const open = body.indexOf(`<${name}`);
  if (open < 0) return null;
  const gt = body.indexOf('>', open);
  if (gt < 0 || body[gt - 1] === '/') return null;
  const close = body.indexOf(`</${name}>`, gt);
  if (close < 0) return null;
  return decodeXml(body.slice(gt + 1, close)).trim();
}

/** A sink that sees every programme in its own window, before `maxPerChannel` and the parser window apply. */
export interface XmltvCollect {
  from: number;
  to: number;
  add(guideId: string, start: number, stop: number, title: string): void;
}

export interface XmltvOptions {
  /** The window to keep, ms. */
  from: number;
  to: number;
  /** Keep only these channel ids (null: all). */
  keep?: Set<string> | null;
  /**
   * Lower-case names of playlist channels with no guide id. A `<channel>`
   * whose display name is one of them is kept too (XMLTV lists the channels
   * before the programmes).
   */
  matchNames?: Set<string> | null;
  /** The most programmes kept per channel (the earliest ones in the window). */
  maxPerChannel?: number;
  /** Descriptions are cut to this many characters. */
  maxDescription?: number;
  /** Receives every kept channel's programmes in its own window (the programme search index). */
  collect?: XmltvCollect | null;
}

/** Incremental XMLTV parser: `push` text chunks, then `end`. */
export class XmltvWindowParser {
  private carry = '';
  private readonly channels: Record<string, Programme[]> = {};
  /** Display names (lower case) to channel ids. */
  readonly names = new Map<string, string>();
  private readonly max: number;
  private readonly maxDesc: number;
  /** True once a `<tv` root or a programme was seen. */
  looksLikeXmltv = false;
  programmesRead = 0;

  constructor(private readonly opts: XmltvOptions) {
    this.max = opts.maxPerChannel ?? 4;
    this.maxDesc = opts.maxDescription ?? 400;
  }

  push(text: string): void {
    const data = this.carry + text;
    if (!this.looksLikeXmltv && /<tv[\s>]/.test(data)) this.looksLikeXmltv = true;
    let pos = 0;
    // The next match of each tag, found again only once `pos` passes it (one scan per chunk, not one per tag).
    let p = -2;
    let c = -2;
    for (;;) {
      if (p !== -1 && p < pos) p = data.indexOf('<programme', pos);
      if (c !== -1 && c < pos) c = data.indexOf('<channel', pos);
      const start = p < 0 ? c : c < 0 ? p : Math.min(p, c);
      if (start < 0) {
        // Keep a tail that may be the start of a tag.
        const lt = data.lastIndexOf('<');
        pos = lt >= pos && data.length - lt < 16 ? lt : data.length;
        break;
      }
      const isProgramme = start === p;
      const name = isProgramme ? 'programme' : 'channel';
      const gt = data.indexOf('>', start);
      if (gt < 0) {
        pos = start;
        break;
      }
      // `<channels>` or another tag that only starts with the same letters.
      const after = data[start + name.length + 1];
      if (after !== ' ' && after !== '>' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '/') {
        pos = start + 1;
        continue;
      }
      const openTag = data.slice(start, gt + 1);
      let body = '';
      let next = gt + 1;
      if (data[gt - 1] !== '/') {
        const close = data.indexOf(`</${name}>`, gt);
        if (close < 0) {
          pos = start;
          break;
        }
        body = data.slice(gt + 1, close);
        next = close + name.length + 3;
      }
      if (isProgramme) this.programme(openTag, body);
      else this.channel(openTag, body);
      pos = next;
    }
    this.carry = data.slice(pos);
  }

  end(): GuideWindow {
    this.carry = '';
    return { schemaVersion: GUIDE_SCHEMA_VERSION, from: this.opts.from, to: this.opts.to, channels: this.channels };
  }

  private channel(openTag: string, body: string): void {
    this.looksLikeXmltv = true;
    const id = attributes(openTag).id;
    if (!id) return;
    const re = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const name = decodeXml(m[1]).trim().toLowerCase();
      if (name && !this.names.has(name)) this.names.set(name, id);
      if (name && this.opts.keep && this.opts.matchNames?.has(name)) this.opts.keep.add(id);
    }
  }

  private programme(openTag: string, body: string): void {
    this.looksLikeXmltv = true;
    this.programmesRead++;
    const a = attributes(openTag);
    const id = a.channel;
    if (!id || (this.opts.keep && !this.opts.keep.has(id))) return;
    const start = parseXmltvTime(a.start);
    const stop = parseXmltvTime(a.stop);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return;
    if (stop <= start) return;
    const collect = this.opts.collect;
    const collected = !!collect && stop > collect.from && start < collect.to;
    const inWindow = stop > this.opts.from && start < this.opts.to;
    // Most programmes of a large guide are outside both windows: their title is never read.
    if (!collected && !inWindow) return;
    const found = firstText(body, 'title');
    // A programme with no title is not worth a search hit.
    if (collected && found) collect.add(id, start, stop, found);
    if (!inWindow) return;
    const prog: Programme = { start, stop, title: found || 'No title' };
    const desc = firstText(body, 'desc');
    if (desc) prog.description = desc.length > this.maxDesc ? `${desc.slice(0, this.maxDesc - 1)}…` : desc;
    const list = (this.channels[id] ??= []);
    if (list.some((x) => x.start === start)) return;
    let i = list.length;
    while (i > 0 && list[i - 1].start > start) i--;
    if (i >= this.max) return;
    list.splice(i, 0, prog);
    if (list.length > this.max) list.pop();
  }
}

/** Parses a whole guide from text chunks into a window. */
export async function parseXmltv(chunks: AsyncIterable<string>, opts: XmltvOptions): Promise<{ guide: GuideWindow; names: Map<string, string>; looksLikeXmltv: boolean }> {
  const p = new XmltvWindowParser(opts);
  for await (const text of chunks) p.push(text);
  return { guide: p.end(), names: p.names, looksLikeXmltv: p.looksLikeXmltv };
}
