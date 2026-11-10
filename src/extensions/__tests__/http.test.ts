import { buildHeaders, buildRequest, parseOptions, send } from '../http';
import { OriginError } from '../match';
import { manifest } from '../test-utils/fixtures';

const account = { serverUrl: 'http://jf.example:8096', serverId: 'srv1', userId: 'u1', userName: 'Sam', token: 'tok' };
const ctx = { item: { id: 'i1', name: 'Clip', path: '/media/videos/clip.mp4' }, input: { name: 'Jane Doe' }, settings: { apiKey: 'k1', loud: true } };

describe('buildRequest', () => {
  it('fills path, query and body on the extension origin', () => {
    const m = manifest();
    const spec = m.contributes.itemActions![0].request;
    const r = buildRequest(m, spec, ctx, { itemPath: true, jellyfinToken: false, playback: false, downloads: false }, account);
    expect(r.url).toBe('http://192.0.2.10:3000/greet/i1?loud=true');
    expect(r.method).toBe('POST');
    expect(JSON.parse(r.body!)).toEqual({ path: '/media/videos/clip.mp4', name: 'Jane Doe', loud: true });
    expect(r.headers['X-Api-Key']).toBe('k1');
    expect(r.headers['Content-Type']).toBe('application/json');
  });

  it('leaves the path out without the itemPath grant', () => {
    const m = manifest();
    const r = buildRequest(m, m.contributes.itemActions![0].request, ctx, { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, account);
    expect(JSON.parse(r.body!).path).toBe('');
  });

  it('sends the Jellyfin token only with the grant and the permission', () => {
    const m = manifest();
    expect(buildHeaders(m, ctx, { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, account)['X-Emby-Token']).toBeUndefined();
    const h = buildHeaders(m, ctx, { itemPath: false, jellyfinToken: true, playback: false, downloads: false }, account);
    expect(h['X-Emby-Token']).toBe('tok');
    expect(h.Authorization).toBe('MediaBrowser Token="tok"');
    expect(h['X-Jellyfin-Server-Id']).toBe('srv1');
    const noPerm = manifest({ permissions: ['network'] });
    expect(buildHeaders(noPerm, ctx, { itemPath: false, jellyfinToken: true, playback: false, downloads: false }, account)['X-Emby-Token']).toBeUndefined();
  });

  it('drops an empty templated header', () => {
    const m = manifest();
    expect(buildHeaders(m, { settings: {} }, { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, null)['X-Api-Key']).toBeUndefined();
  });

  it('refuses a request to another origin', () => {
    const m = manifest();
    expect(() => buildRequest(m, { method: 'GET', path: 'http://evil.example/x' }, ctx, { itemPath: true, jellyfinToken: true, playback: false, downloads: false }, account)).toThrow(OriginError);
    // A template value cannot move the request to another host: values in a path are encoded.
    const r = buildRequest(m, { method: 'GET', path: '/x/{{input.name}}' }, { input: { name: '//evil.example' } }, { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, null);
    expect(new URL(r.url).host).toBe('192.0.2.10:3000');
  });
});

describe('send', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.useRealTimers();
  });

  it('returns the JSON answer', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{"toast":"ok"}') }) as never;
    await expect(send({ url: 'http://x/', method: 'GET', headers: {} })).resolves.toEqual({ toast: 'ok' });
  });

  it('throws the server error text', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, text: () => Promise.resolve('{"error":"Already downloaded"}') }) as never;
    await expect(send({ url: 'http://x/', method: 'GET', headers: {} })).rejects.toMatchObject({ message: 'Already downloaded', status: 409 });
  });

  it('times out', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as never;
    const p = send({ url: 'http://x/', method: 'GET', headers: {} }, 1000);
    jest.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow('did not answer in time');
  });
});

describe('parseOptions', () => {
  it('reads the three forms', () => {
    expect(parseOptions(['a'])).toEqual([{ value: 'a', label: 'a' }]);
    expect(parseOptions({ options: [{ value: 'v', label: 'V' }] })).toEqual([{ value: 'v', label: 'V' }]);
    expect(parseOptions([{ value: 'v' }, 5, { label: 'no value' }])).toEqual([{ value: 'v', label: 'v' }]);
  });
  it('throws for another shape', () => {
    expect(() => parseOptions({ subdirs: [] })).toThrow();
  });
});
