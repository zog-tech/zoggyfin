import { handleBridgeRequest, readBridgeMessage, sameOrigin } from '../bridge';

const BASE = 'http://192.0.2.10:3000';

const deps = (over: { refusal?: string | null } = {}) => ({
  context: jest.fn(() => ({ a: 1 })),
  play: jest.fn(),
  openItem: jest.fn(),
  refreshLibrary: jest.fn(),
  toast: jest.fn(),
  close: jest.fn(),
  baseUrl: BASE,
  playRefusal: jest.fn(() => over.refusal ?? null),
  playMedia: jest.fn(),
  openEntry: jest.fn(),
  hasPage: jest.fn((id: string) => id === 'main'),
  openPage: jest.fn(),
  refreshPage: jest.fn(),
});

describe('bridge', () => {
  it('reads a request from an object or JSON text', () => {
    expect(readBridgeMessage({ zoggyfin: 1, id: 1, method: 'toast', params: { text: 'hi' } })).toEqual({ id: 1, method: 'toast', params: { text: 'hi' } });
    expect(readBridgeMessage('{"zoggyfin":1,"id":"a","method":"close"}')).toEqual({ id: 'a', method: 'close', params: {} });
  });
  it('ignores other messages and unknown methods', () => {
    expect(readBridgeMessage({ id: 1, method: 'toast' })).toBeNull();
    expect(readBridgeMessage({ zoggyfin: 1, id: 1, method: 'eval' })).toBeNull();
    expect(readBridgeMessage('not json')).toBeNull();
  });
  it('reloads only the extension feeds with refreshPage', async () => {
    const d = deps();
    expect(await handleBridgeRequest({ id: 1, method: 'refreshPage', params: {} }, d)).toEqual({ zoggyfin: 1, id: 1, result: true });
    expect(d.refreshPage).toHaveBeenCalledTimes(1);
    expect(d.refreshLibrary).not.toHaveBeenCalled();
    expect(readBridgeMessage({ zoggyfin: 1, id: 2, method: 'refreshPage' })).toEqual({ id: 2, method: 'refreshPage', params: {} });
  });
  it('checks the origin', () => {
    expect(sameOrigin('http://192.0.2.10:3000/panel', 'http://192.0.2.10:3000')).toBe(true);
    expect(sameOrigin('http://evil.example/panel', 'http://192.0.2.10:3000')).toBe(false);
    expect(sameOrigin(null, 'http://192.0.2.10:3000')).toBe(false);
  });
  it('runs each method', async () => {
    const d = deps();
    expect(await handleBridgeRequest({ id: 1, method: 'getContext', params: {} }, d)).toEqual({ zoggyfin: 1, id: 1, result: { a: 1 } });
    await handleBridgeRequest({ id: 2, method: 'play', params: { itemId: 'abc123' } }, d);
    expect(d.play).toHaveBeenCalledWith('abc123');
    await handleBridgeRequest({ id: 3, method: 'toast', params: { text: 'Hi' } }, d);
    expect(d.toast).toHaveBeenCalledWith('Hi');
    await handleBridgeRequest({ id: 4, method: 'refreshLibrary', params: {} }, d);
    await handleBridgeRequest({ id: 5, method: 'close', params: {} }, d);
    expect(d.refreshLibrary).toHaveBeenCalled();
    expect(d.close).toHaveBeenCalled();
  });
  it('answers an error for bad params', async () => {
    const r = await handleBridgeRequest({ id: 6, method: 'openItem', params: { itemId: '../x' } }, deps());
    expect(r.error).toMatch(/itemId/);
  });

  it('reads the version 2 methods', () => {
    for (const method of ['playMedia', 'openEntry', 'openPage']) expect(readBridgeMessage({ zoggyfin: 1, id: 1, method, params: {} })?.method).toBe(method);
  });

  it('plays media on the origin with the grant', async () => {
    const d = deps();
    const r = await handleBridgeRequest({ id: 7, method: 'playMedia', params: { mediaId: 'm1', playback: '/api/m1/play', title: 'A clip', image: 'https://other.example.net/x.jpg' } }, d);
    expect(r.error).toBeUndefined();
    // A picture on another origin is left out.
    expect(d.playMedia).toHaveBeenCalledWith({ mediaId: 'm1', playback: `${BASE}/api/m1/play`, title: 'A clip' });
  });

  it('refuses playback on another origin, and says why without the URL', async () => {
    const d = deps();
    const r = await handleBridgeRequest({ id: 8, method: 'playMedia', params: { mediaId: 'm1', playback: 'https://other.example.net/m1' } }, d);
    expect(r.error).toBe("playback must be on the extension's origin");
    expect(d.playMedia).not.toHaveBeenCalled();
    expect((await handleBridgeRequest({ id: 9, method: 'playMedia', params: { playback: '/api/m1/play' } }, d)).error).toMatch(/mediaId/);
  });

  it('refuses playback when the grant is off', async () => {
    const d = deps({ refusal: 'Playback is turned off for Hello. Turn it on in Settings → Extensions.' });
    const r = await handleBridgeRequest({ id: 10, method: 'playMedia', params: { mediaId: 'm1', playback: '/api/m1/play' } }, d);
    expect(r.error).toMatch(/^Playback is turned off for Hello/);
    expect(d.playMedia).not.toHaveBeenCalled();
  });

  it('opens an entry page on the origin only', async () => {
    const d = deps();
    await handleBridgeRequest({ id: 11, method: 'openEntry', params: { detail: '/api/e1', title: 'An entry' } }, d);
    expect(d.openEntry).toHaveBeenCalledWith({ detail: `${BASE}/api/e1`, title: 'An entry' });
    const r = await handleBridgeRequest({ id: 12, method: 'openEntry', params: { detail: '//other.example.net/e1' } }, d);
    expect(r.error).toMatch(/^detail must be/);
    expect(d.openEntry).toHaveBeenCalledTimes(1);
  });

  it("opens one of the manifest's pages only", async () => {
    const d = deps();
    await handleBridgeRequest({ id: 13, method: 'openPage', params: { page: 'main' } }, d);
    expect(d.openPage).toHaveBeenCalledWith('main');
    const r = await handleBridgeRequest({ id: 14, method: 'openPage', params: { page: 'other' } }, d);
    expect(r.error).toMatch(/page/);
    expect(d.openPage).toHaveBeenCalledTimes(1);
  });
});
