/**
 * The Hello sample (`examples/extensions/hello/`) against the app's own
 * parsers, so the sample never drifts from the schema. The test starts the
 * sample server on a free local port and reads every endpoint the app reads.
 */
import { parseDetail, parseFeedPage } from '../feeds';
import { parseDownloadDescription } from '../media/download';
import { parseStreamDescription } from '../media/describe';
import { parseManifest } from '../schema';

// Jest runs tests in Node as CommonJS. The app has no Node types, so the few
// Node calls this test makes are typed here.
declare const __dirname: string;
interface Child {
  stdout: { on(event: 'data', fn: (chunk: Uint8Array) => void): void } | null;
  on(event: 'error', fn: (e: Error) => void): void;
  kill(): void;
}
/** The part of a Node response this test reads. */
interface Reply {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, fn: (chunk: Uint8Array) => void): void;
}
interface NodeHttp {
  request(url: URL, opts: { method: string; headers?: Record<string, string> }, cb: (res: Reply) => void): { on(event: 'error', fn: (e: Error) => void): void; end(body?: string): void };
}
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process') as { spawn(cmd: string, args: string[], opts: { env: Record<string, string | undefined>; stdio: string[] }): Child };
const http = require('node:http') as NodeHttp;
const nodeProcess = require('node:process') as { execPath: string; env: Record<string, string | undefined> };
/* eslint-enable @typescript-eslint/no-require-imports */

const SERVER = `${__dirname}/../../../examples/extensions/hello/server.mjs`;
const PORT = 18_000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;

let server: Child | null = null;
const logs: string[] = [];

beforeAll(async () => {
  server = spawn(nodeProcess.execPath, [SERVER], { env: { ...nodeProcess.env, PORT: String(PORT), BASE_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The sample server did not start')), 10_000);
    server!.stdout!.on('data', (d: Uint8Array) => {
      logs.push(new TextDecoder().decode(d));
      if (logs.join('').includes('Hello extension on')) {
        clearTimeout(t);
        resolve();
      }
    });
    server!.on('error', reject);
  });
}, 15_000);

afterAll(() => {
  server?.kill();
});

/** One request with Node's own HTTP client (the test preset replaces `fetch`). */
function call(p: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; text: string; bytes: number; type: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(p, BASE), { method: init.method ?? 'GET', headers: init.headers }, (res: Reply) => {
      const chunks: Uint8Array[] = [];
      res.on('data', (c: Uint8Array) => chunks.push(c));
      res.on('end', () => {
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) {
          all.set(c, at);
          at += c.length;
        }
        resolve({ status: res.statusCode ?? 0, text: new TextDecoder().decode(all), bytes: all.length, type: String(res.headers['content-type'] ?? '') });
      });
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

const post = (p: string, body: unknown) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function get(p: string): Promise<unknown> {
  const res = await call(p);
  expect(res.status).toBe(200);
  return JSON.parse(res.text);
}

describe('the Hello sample', () => {
  it('both manifests parse; the version 2 one asks for playback and downloads and names two skip labels', async () => {
    const v1 = parseManifest(await get('/zoggyfin-extension.json'));
    expect(v1.ok).toBe(true);
    const v2 = parseManifest(await get('/pages/zoggyfin-extension.json'));
    if (!v2.ok) throw new Error(v2.error);
    const m = v2.manifest;
    expect(m.baseUrl).toBe(BASE);
    expect(m.permissions).toEqual(expect.arrayContaining(['network', 'playback', 'downloads']));
    expect(m.contributes.skipLabels?.map((l) => l.id)).toEqual(['intro', 'credits']);
    const page = m.contributes.pages?.[0];
    expect(page?.search?.feed).toBe('/pages/search');
    expect(page?.search).toMatchObject({ global: true, title: 'From Hello Pages' });
    expect(page?.sections.map((s) => s.layout)).toEqual(['row', 'list', 'grid']);
  });

  it('every section feed, the next page and search parse as feed pages', async () => {
    const latest = parseFeedPage(await get('/pages/latest'), BASE);
    expect(latest.entries.length).toBeGreaterThan(0);
    const queue = parseFeedPage(await get('/pages/queue'), BASE);
    expect(queue.entries.length).toBeGreaterThan(0);
    const all = parseFeedPage(await get('/pages/all'), BASE);
    expect(all.entries).toHaveLength(20);
    expect(all.next).toBe('20');
    const last = parseFeedPage(await get('/pages/all?cursor=80'), BASE);
    expect(last.next).toBeNull();
    const found = parseFeedPage(await get('/pages/search?query=clip%2012'), BASE);
    expect(found.entries.map((e) => e.title)).toContain('Sample clip 12');
    const entry = all.entries[2]!;
    expect(entry.media?.playback).toBe(`${BASE}/pages/entries/s3/play`);
    expect(entry.detail).toBe(`${BASE}/pages/entries/s3`);
  });

  it('the second page has three tabs, a flat fallback for app versions without tabs, and a Home row inside a tab', async () => {
    const r = parseManifest(await get('/pages/zoggyfin-extension.json'));
    if (!r.ok) throw new Error(r.error);
    const tabs = r.manifest.contributes.pages?.find((p) => p.id === 'tabs');
    expect(tabs?.tabs?.map((t) => t.title)).toEqual(['Clips', 'Up next', 'My list']);
    expect(tabs?.sections.map((s) => s.id)).toEqual(['clips-latest', 'mine', 'clips-all']);
    expect(tabs?.tabs?.[2].search?.feed).toBe('/pages/mine/search');
    expect(r.manifest.contributes.homeSections?.map((h) => h.feed)).toEqual(['/pages/latest', '/pages/mine']);
    expect(r.manifest.contributes.panels?.map((p) => p.id)).toEqual(['account']);
    // An app version without tabs ignores `tabs` and reads `sections`; its Home id must be there too, or it refuses the manifest.
    const old = await get('/pages/zoggyfin-extension.json');
    const flat = JSON.parse(JSON.stringify(old)) as { contributes: { pages: { tabs?: unknown }[] } };
    flat.contributes.pages.forEach((p) => delete p.tabs);
    expect(parseManifest(flat).ok).toBe(true);
  });

  it('each page has Library tile art: a small PNG on the origin', async () => {
    const r = parseManifest(await get('/pages/zoggyfin-extension.json'));
    if (!r.ok) throw new Error(r.error);
    expect(r.manifest.contributes.pages?.map((p) => p.image)).toEqual(['/pages/art/main.png', '/pages/art/tabs.png']);
    for (const p of ['/pages/art/main.png', '/pages/art/tabs.png']) {
      const res = await call(p);
      expect(res.status).toBe(200);
      expect(res.type).toBe('image/png');
      expect(res.bytes).toBeGreaterThan(100);
      expect(res.bytes).toBeLessThan(20_000);
    }
  });

  it('"My list" says why it is empty until the panel signs in, then lists entries', async () => {
    const empty = parseFeedPage(await get('/pages/mine'), BASE);
    expect(empty).toEqual({ entries: [], next: null, message: 'Sign in to see your list.', action: { title: 'Sign in', panel: 'account' } });
    const panel = await call('/pages/account');
    expect(panel.type).toContain('text/html');
    expect(panel.text).toContain("zoggyfin('openPage', { page: 'tabs', tab: 'mine' })");
    expect(JSON.parse((await post('/pages/account/state', { signedIn: true })).text)).toEqual({ signedIn: true });
    const full = parseFeedPage(await get('/pages/mine'), BASE);
    expect(full.entries.length).toBeGreaterThan(0);
    expect(full.message).toBeUndefined();
    expect(parseFeedPage(await get('/pages/mine/search?query=clip%2010'), BASE).entries.map((e) => e.title)).toContain('Sample clip 10');
    await post('/pages/account/state', { signedIn: false });
  });

  it('a detail page has a stateful action and a related row', async () => {
    const d = parseDetail(await get('/pages/entries/s3'), BASE);
    expect(d.media?.download).toBe(`${BASE}/pages/entries/s3/download`);
    expect(d.imageUrl).toBe(`${BASE}/pages/art/main.png`);
    expect(d.actions[0]?.state?.on).toBe(false);
    expect(d.sections.map((s) => s.id)).toEqual(['related']);
    expect(parseFeedPage(await get('/pages/entries/s3/related'), BASE).entries.length).toBeGreaterThan(0);
    const res = await post('/pages/entries/s3/save', { on: true });
    expect(JSON.parse(res.text)).toMatchObject({ state: { on: true } });
    expect(parseDetail(await get('/pages/entries/s3'), BASE).actions[0]?.state?.on).toBe(true);
  });

  it('the stream description has two qualities, subtitles, labelled segments, chapters, a next entry and a report path', async () => {
    const d = parseStreamDescription(await get('/pages/entries/s3/play'), BASE);
    expect(d.streams[0]?.url.startsWith(`${BASE}/pages/media/sample.mp4`)).toBe(true);
    expect(d.qualities.map((q) => q.id)).toEqual(['high', 'low']);
    expect(d.subtitles).toEqual([{ id: 'en', label: 'English', language: 'en', url: `${BASE}/pages/media/sample.en.vtt` }]);
    expect(d.segments.map((s) => s.label)).toEqual(['intro', 'credits']);
    expect(d.chapters).toHaveLength(2);
    expect(d.next?.media?.playback).toBe(`${BASE}/pages/entries/s4/play`);
    expect(d.report?.url).toBe(`${BASE}/pages/entries/s3/report`);
    expect(d.duration).toBe(6);
  });

  it('the subtitles are WebVTT, the file answers byte ranges, and the report endpoint takes an event', async () => {
    const vtt = await call('/pages/media/sample.en.vtt');
    expect(vtt.type).toMatch(/^text\/vtt/);
    expect(vtt.text.startsWith('WEBVTT')).toBe(true);
    const part = await call('/pages/media/sample.mp4?q=low', { headers: { Range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.bytes).toBe(100);
    const report = await post('/pages/entries/s3/report', { event: 'start', mediaId: 's3', position: 0, rate: 1, offline: false });
    expect(report.status).toBe(204);
    // The sample logs each report.
    await new Promise((r) => setTimeout(r, 100));
    expect(logs.join('')).toContain('report s3: start at 0 s');
  });

  it('the download description offers two options, and each option names one file with subtitles', async () => {
    const first = parseDownloadDescription(await get('/pages/entries/s3/download'), BASE);
    expect(first.url).toBeUndefined();
    expect(first.options.map((o) => o.id)).toEqual(['high', 'low']);
    for (const o of first.options) {
      const file = parseDownloadDescription(await get(o.download), BASE);
      expect(file.url).toBe(`${BASE}/pages/media/sample.mp4?q=${o.id}`);
      expect(file.container).toBe('mp4');
      expect(file.subtitles).toHaveLength(1);
    }
  });
});
