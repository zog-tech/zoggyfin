/**
 * The player's source for extension media: the stream description becomes
 * the player's stream, every request carries the extension's headers (the
 * Jellyfin token only with the grant), subtitles never use the Jellyfin
 * client, reports go to the report path, and no error text holds a URL.
 */
import type { ExternalStream } from '@/player/types';

import type { BuiltRequest, JellyfinAccount } from '../http';
import { mediaPlayRequest, type ExtensionMediaDeps } from '../media/source';
import { parseManifest } from '../schema';
import type { InstalledExtension } from '../store';
import { rawV2 } from '../test-utils/fixtures';

const mockGetText = jest.fn();
jest.mock('@/api/jellyfin', () => ({ getText: (...a: unknown[]) => mockGetText(...a) }));

const BASE = 'https://media.example.org';
const account: JellyfinAccount = { serverUrl: 'https://jf.example.org', serverId: 'srv', userId: 'u1', userName: 'Jane Doe', token: 'jf-secret' };

function installed(over: { permissions?: string[]; jellyfinToken?: boolean; enabled?: boolean } = {}): InstalledExtension {
  const parsed = parseManifest({
    ...rawV2,
    permissions: over.permissions ?? ['network', 'playback', 'jellyfinToken'],
    headers: { 'X-Api-Key': '{{settings.key}}' },
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const manifest = parsed.manifest;
  return { manifestUrl: `${BASE}/zoggyfin-extension.json`, manifest, enabled: over.enabled ?? true, grants: { itemPath: false, jellyfinToken: over.jellyfinToken ?? false, playback: true, downloads: true }, installedAt: 1 };
}

const description = {
  stream: { url: '/hls/e1/master.m3u8', type: 'hls' },
  alternatives: [{ url: '/files/e1.mp4' }, { url: 'https://other.example.net/e1.mp4' }],
  title: 'An entry',
  image: '/img/e1.jpg',
  duration: 700,
  resume: 30,
  qualities: [
    { id: 'auto', label: 'Auto', url: '/hls/e1/master.m3u8' },
    { id: '720', label: '720p', url: '/hls/e1/720.m3u8' },
    { id: 'file', label: 'File', url: '/files/e1-480.mp4' },
  ],
  subtitles: [{ id: 'en', label: 'English', language: 'en', url: '/subs/e1.en.vtt' }],
  segments: [
    { label: 'promo', start: 200, end: 245 },
    { label: 'intro', start: 0, end: 12 },
    { label: 'recap', start: 300, end: 320 },
  ],
  chapters: [{ title: 'Part 1', start: 0 }],
  next: { id: 'e2', title: 'Next entry', media: { id: 'e2', playback: '/api/e2/play' } },
  report: { path: '/api/e1/progress', intervalSeconds: 15 },
};

function setup(ext: InstalledExtension | undefined, reply: unknown = description, opts: { fail?: Error } = {}) {
  const requests: BuiltRequest[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  const deps: ExtensionMediaDeps = {
    extension: () => ext,
    account: () => account,
    context: () => ({ settings: { key: 'abc' }, jellyfin: {} }),
    sendJson: async (req) => {
      requests.push(req);
      if (opts.fail) throw opts.fail;
      return reply;
    },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return new Response('WEBVTT\n', { status: 200 });
    },
  };
  return { deps, requests, fetches };
}

const media = { extension: 'org.example.media', mediaId: 'e1', playback: `${BASE}/api/e1/play`, title: 'From the card' };

async function resolve(ext: InstalledExtension | undefined, reply?: unknown, opts?: { fail?: Error }) {
  const t = setup(ext, reply, opts);
  const r = mediaPlayRequest(media, t.deps);
  if (!('request' in r)) throw new Error(r.error);
  const stream = await r.request.source.resolve(r.request.items[0]);
  return { ...t, request: r.request, stream };
}

describe('extension media source', () => {
  it('maps the description to the player stream', async () => {
    const { stream, request, requests } = await resolve(installed());
    expect(request.items[0]).toMatchObject({ id: 'e1', title: 'From the card', kind: 'film' });
    expect(request.startSeconds).toBeUndefined();
    expect(requests[0]).toMatchObject({ url: `${BASE}/api/e1/play`, method: 'GET' });
    expect(stream.candidates).toEqual([
      { url: `${BASE}/hls/e1/master.m3u8`, isHls: true },
      { url: `${BASE}/files/e1.mp4`, isHls: false },
    ]);
    expect(stream).toMatchObject<Partial<ExternalStream>>({ live: false, title: 'An entry', artwork: `${BASE}/img/e1.jpg`, duration: 700, resume: 30 });
    expect(stream.qualities?.map((q) => [q.id, q.isHls])).toEqual([
      ['auto', true],
      ['720', true],
      ['file', false],
    ]);
    expect(stream.subtitles).toEqual([{ id: 'en', label: 'English', language: 'en', url: `${BASE}/subs/e1.en.vtt` }]);
    expect(stream.segments).toEqual([
      { label: 'intro', title: 'Intro', start: 0, end: 12 },
      { label: 'promo', title: 'Promotion', start: 200, end: 245 },
      { label: 'recap', title: 'Recap', start: 300, end: 320 },
    ]);
    expect(stream.chapters).toEqual([{ title: 'Part 1', start: 0 }]);
    expect(stream.skip).toEqual({ scope: 'org.example.media', defaults: { intro: 'ask', promo: 'auto' } });
    expect(stream.next).toMatchObject({ id: 'e2', title: 'Next entry', kind: 'film' });
    expect(stream.progress?.intervalMs).toBe(15_000);
    expect(request.source.itemId?.(request.items[0])).toBe('ext:org.example.media:e1');
  });

  it('resolves the next entry with its own playback URL', async () => {
    const { request, requests } = await resolve(installed());
    await request.source.resolve({ id: 'e2', kind: 'film', title: 'Next entry', poster: null });
    expect(requests[1].url).toBe(`${BASE}/api/e2/play`);
  });

  it('puts the manifest headers on the stream, and the Jellyfin token only with the grant', async () => {
    const without = await resolve(installed());
    expect(without.stream.headers).toEqual({ 'X-Api-Key': 'abc' });
    expect(JSON.stringify(without.requests)).not.toContain('jf-secret');

    const granted = await resolve(installed({ jellyfinToken: true }));
    expect(granted.stream.headers).toMatchObject({ 'X-Api-Key': 'abc', 'X-Emby-Token': 'jf-secret', Authorization: 'MediaBrowser Token="jf-secret"' });
    expect(granted.stream.headers?.Accept).toBeUndefined();
    // Never in a URL.
    for (const c of granted.stream.candidates) expect(c.url).not.toContain('jf-secret');
  });

  it('loads subtitles on the origin with the extension headers, never through the Jellyfin client', async () => {
    const { request, fetches } = await resolve(installed());
    const text = await request.source.loadText?.(`${BASE}/subs/e1.en.vtt`);
    expect(text).toBe('WEBVTT\n');
    expect(fetches[0].url).toBe(`${BASE}/subs/e1.en.vtt`);
    expect(fetches[0].init.headers).toMatchObject({ 'X-Api-Key': 'abc' });
    expect(mockGetText).not.toHaveBeenCalled();
    await expect(request.source.loadText?.('https://other.example.net/x.vtt')).rejects.toThrow(/not on the extension/);
    expect(fetches).toHaveLength(1);
  });

  it('posts report bodies to the report path and ignores errors', async () => {
    const { stream, fetches } = await resolve(installed());
    await stream.progress?.send('pause', { position: 130.24, duration: 700, rate: 1.5, quality: '720' });
    expect(fetches[0].url).toBe(`${BASE}/api/e1/progress`);
    expect(fetches[0].init.method).toBe('POST');
    expect(JSON.parse(String(fetches[0].init.body))).toEqual({ event: 'pause', mediaId: 'e1', position: 130.2, duration: 700, rate: 1.5, quality: '720', offline: false });
    // A live stream: no duration.
    await stream.progress?.send('progress', { position: 5, duration: 0, rate: 1, quality: null });
    expect(JSON.parse(String(fetches[1].init.body)).duration).toBeUndefined();
  });

  it('a lost report never throws', async () => {
    const t = setup(installed());
    t.deps.fetch = async () => {
      throw new Error('offline');
    };
    const r = mediaPlayRequest(media, t.deps);
    if (!('request' in r)) throw new Error(r.error);
    const stream = await r.request.source.resolve(r.request.items[0]);
    await expect(stream.progress?.send('stop', { position: 1, duration: 2, rate: 1, quality: null })).resolves.toBeUndefined();
  });

  it('has no progress transport without a report', async () => {
    const { report: _r, ...rest } = description;
    const { stream } = await resolve(installed(), rest);
    expect(stream.progress).toBeUndefined();
  });

  it('a live description has no resume and no duration', async () => {
    const { stream } = await resolve(installed(), { ...description, live: true });
    expect(stream.live).toBe(true);
    expect(stream.resume).toBeUndefined();
    expect(stream.duration).toBeUndefined();
  });

  it('refuses without the playback permission, when off, when removed, and off the origin', () => {
    expect(mediaPlayRequest(media, setup(installed({ permissions: ['network'] })).deps)).toEqual({ error: 'This extension cannot play media.' });
    expect(mediaPlayRequest(media, setup(installed({ enabled: false })).deps)).toMatchObject({ error: expect.stringMatching(/off/) });
    expect(mediaPlayRequest(media, setup(undefined).deps)).toMatchObject({ error: expect.stringMatching(/not installed/) });
    expect(mediaPlayRequest({ ...media, playback: 'https://other.example.net/play' }, setup(installed()).deps)).toEqual({ error: 'This title cannot play.' });
  });

  it('error text holds no URL', async () => {
    const leaky = await resolve(installed(), undefined, { fail: new Error(`Cannot reach ${BASE}/api/e1/play?key=abc`) });
    expect(leaky.stream.candidates).toEqual([]);
    expect(leaky.stream.unsupported).toBe('The extension did not send a stream.');
    const plain = await resolve(installed(), undefined, { fail: new Error('The extension did not answer in time.') });
    expect(plain.stream.unsupported).toBe('The extension did not answer in time.');
    const nothing = await resolve(installed(), { stream: { url: 'https://other.example.net/x.m3u8' } });
    expect(nothing.stream.unsupported).toBe('The extension sent no stream the app can play.');
  });
});
