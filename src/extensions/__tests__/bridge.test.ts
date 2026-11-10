import { handleBridgeRequest, readBridgeMessage, readExternalUrl, sameOrigin } from '../bridge';

const BASE = 'http://192.0.2.10:3000';

const deps = (over: { refusal?: string | null; network?: boolean; opened?: boolean } = {}) => ({
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
  hasNetwork: jest.fn(() => over.network ?? true),
  openExternal: jest.fn(async () => over.opened ?? true),
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
  it('opens an https URL in the system browser and says whether it opened', async () => {
    const d = deps();
    expect(await handleBridgeRequest({ id: 1, method: 'openExternal', params: { url: 'https://example.org/sign-in?x=1' } }, d)).toEqual({ zoggyfin: 1, id: 1, result: { opened: true } });
    expect(d.openExternal).toHaveBeenCalledWith('https://example.org/sign-in?x=1');
    const no = deps({ opened: false });
    expect(await handleBridgeRequest({ id: 2, method: 'openExternal', params: { url: 'https://example.org' } }, no)).toEqual({ zoggyfin: 1, id: 2, result: { opened: false } });
  });
  it('refuses openExternal for other schemes, credentials, bad values and without the network permission', async () => {
    for (const url of ['http://example.org', 'javascript:alert(1)', 'file:///etc/hosts', 'zoggyfin://share', 'https://user:pw@example.org', 'https://user@example.org', 'not a url', '', 5, 'https://example.org/' + 'a'.repeat(2000)]) {
      const d = deps();
      const reply = await handleBridgeRequest({ id: 1, method: 'openExternal', params: { url } }, d);
      expect(reply.error).toBeTruthy();
      expect(reply.error).not.toContain('example.org');
      expect(d.openExternal).not.toHaveBeenCalled();
    }
    const d = deps({ network: false });
    expect((await handleBridgeRequest({ id: 1, method: 'openExternal', params: { url: 'https://example.org' } }, d)).error).toBe('The extension has no network permission');
    expect(d.openExternal).not.toHaveBeenCalled();
    expect(readExternalUrl({ url: ' https://Example.org/a b ' })).toBe('https://example.org/a%20b');
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
