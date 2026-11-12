/**
 * The manager's branch for an extension's media: the file comes from the
 * download description, the request carries the extension's headers (never
 * the Jellyfin download header), a choice is needed when the description
 * has options, an expired file URL is asked again once, and the refusals
 * (grant off, another origin, no downloads on the platform) hold no URL.
 * An extension that prepares the file first ("preparing") makes the record
 * wait and ask again, until the file is ready, a failure, a pause or cancel,
 * or the time limit.
 */
import { ExtensionError } from '@/extensions/http';

import type { EngineHandlers } from '../engine-types';
import { extensionDir, extensionRecordId, newExtensionRecord } from '../extension-media';

import { downloadManager } from '../manager';
import { PREPARE_LIMIT_MS, PREPARE_TOO_LONG } from '../state-machine';
import { downloadsState, putRecord, useDownloadsStore } from '../store';
import { accountA, BASE, EXT_ID, fakeDeps, mediaExtension } from '../test-utils/extension-fakes';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

const mockFetchFile = jest.fn(async (..._a: unknown[]) => 100);
jest.mock('../files', () => ({
  files: {
    documentsDir: () => 'file:///docs/',
    ensureDir: () => undefined,
    excludeFromBackup: () => undefined,
    listDirs: () => [],
    remove: () => undefined,
    size: () => 0,
    statSize: async () => 0,
    writeText: () => undefined,
    absolutePath: (p: string) => `/docs/${p}`,
    fetchFile: (...a: unknown[]) => mockFetchFile(...a),
  },
}));

const mockStart = jest.fn();
const mockHandlers: { current: EngineHandlers | null } = { current: null };
jest.mock('../engine', () => ({
  engine: {
    supported: true,
    configure: (h: EngineHandlers) => {
      mockHandlers.current = h;
    },
    existing: async () => [],
    start: (...a: unknown[]) => mockStart(...a),
    pause: async () => undefined,
    resume: async () => false,
    stop: async () => undefined,
    finish: () => undefined,
  },
}));

const mockSession = { current: { serverId: 'server-1', userId: 'user-1', serverUrl: 'http://jellyfin.test', token: 't' } as { serverId: string; userId: string; serverUrl: string; token: string } | null };
jest.mock('@/auth/session-store', () => ({
  useSessionStore: {
    getState: () => ({
      session: mockSession.current,
      accounts: { servers: [{ id: 'server-1', users: [{ userId: 'user-1' }, { userId: 'user-2' }] }] },
    }),
  },
  tokenFor: () => 't',
}));
jest.mock('@/api/client', () => ({ getApi: () => ({}) }));
jest.mock('@/api/jellyfin', () => ({}));
jest.mock('@/api/auth-header', () => ({ buildAuthHeader: () => 'MediaBrowser Client="Zoggyfin", Token="t"' }));
jest.mock('@/auth/identity', () => ({ clientIdentity: () => ({ deviceId: 'device-1' }) }));
jest.mock('@/player/capabilities', () => ({ mediaCapabilities: () => ({}), audioCapabilities: () => ({}) }));
jest.mock('@/player/device-profile', () => ({ buildDeviceProfile: () => ({}) }));
jest.mock('@/native/zoggyfin-native', () => ({ makeSeekableMp4: async () => 'skipped' }));
jest.mock('@/lib/toast', () => ({ toast: () => undefined }));

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
}

const DOWNLOAD = `${BASE}/api/e1/download`;
const ID = extensionRecordId(EXT_ID, 'e1');
const input = { extension: EXT_ID, mediaId: 'e1', download: DOWNLOAD, title: 'An entry', subtitle: 'Example Media', image: '/img/e1.jpg', duration: 700, playback: `${BASE}/api/e1/play` };

const single = {
  url: '/files/e1-720.mp4?sig=one',
  bytes: 1000,
  container: 'mp4',
  label: '720p',
  subtitles: [{ label: 'English', language: 'en', url: '/subs/e1.en.vtt' }],
  image: '/img/e1-big.jpg',
};

let ext = mediaExtension();
let fake = fakeDeps(() => ext, {});

function use(routes: Record<string, unknown>) {
  fake = fakeDeps(() => ext, routes);
  downloadManager.useExtensionDeps(fake.deps);
}

beforeAll(async () => {
  jest.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
  await downloadManager.init();
});

beforeEach(() => {
  useDownloadsStore.setState({ records: {}, collections: {} });
  mockStart.mockClear();
  mockFetchFile.mockClear();
  mockSession.current = { serverId: 'server-1', userId: 'user-1', serverUrl: 'http://jellyfin.test', token: 't' };
  ext = mediaExtension();
});

describe('a download with one file', () => {
  it('saves a record with the ext: id and starts the file with the extension headers only', async () => {
    use({ [DOWNLOAD]: single });
    await downloadManager.downloadExtension(input, true);
    await flush();

    const r = downloadsState().records[ID]!;
    expect(r.itemId).toBe('ext:org.example.media:e1');
    expect(r.source).toMatchObject({ kind: 'extension', extId: EXT_ID, mediaId: 'e1', account: 'server-1.user-1', title: 'An entry', label: '720p', container: 'mp4', bytes: 1000 });
    expect(r.dir).toBe(extensionDir(EXT_ID, 'e1'));
    expect(r.serverId).toBe('server-1');
    expect(r.state).toBe('downloading');
    expect(mockStart).toHaveBeenCalledTimes(1);
    const task = mockStart.mock.calls[0][0] as { url: string; destination: string; headers: Record<string, string> };
    expect(task.url).toBe(`${BASE}/files/e1-720.mp4?sig=one`);
    expect(task.destination).toBe(`/docs/${r.dir}/media.mp4`);
    expect(task.headers['X-Api-Key']).toBe('abc');
    // No Jellyfin download header, and no token headers without the grant.
    expect(task.headers.Authorization).toBeUndefined();
    expect(task.headers['X-Emby-Token']).toBeUndefined();
    expect(JSON.stringify(task.headers)).not.toContain('Zoggyfin');
  });

  it('sends the Jellyfin token headers only with the jellyfinToken grant', async () => {
    ext = mediaExtension({ jellyfinToken: true });
    use({ [DOWNLOAD]: single });
    await downloadManager.downloadExtension(input, true);
    await flush();
    const headers = (mockStart.mock.calls[0][0] as { headers: Record<string, string> }).headers;
    expect(headers['X-Emby-Token']).toBe(accountA.token);
    expect(headers.Authorization).toBe(`MediaBrowser Token="${accountA.token}"`);
  });

  it('saves the image and the subtitles with the extension headers, and learns the report URL', async () => {
    use({ [DOWNLOAD]: single, [`${BASE}/api/e1/play`]: { stream: { url: '/files/e1.mp4', type: 'file' }, report: { path: '/api/e1/progress', intervalSeconds: 20 } } });
    await downloadManager.downloadExtension(input, true);
    await flush();
    mockHandlers.current!.onDone(ID, 1000);
    await flush();

    const r = downloadsState().records[ID]!;
    expect(r.state).toBe('completed');
    expect(r.images.primary).toBe('primary.jpg');
    expect(r.subtitles).toEqual([{ index: 0, label: 'English', language: 'en', isDefault: false, isForced: false, file: 'subtitle-0.vtt' }]);
    expect(r.source).toMatchObject({ report: { url: `${BASE}/api/e1/progress`, intervalSeconds: 20 } });
    const urls = mockFetchFile.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([`${BASE}/img/e1-big.jpg`, `${BASE}/subs/e1.en.vtt`]);
    for (const c of mockFetchFile.mock.calls) expect((c[2] as Record<string, string>).Authorization).toBeUndefined();
  });

  it('a second call for the same entry adds no second record', async () => {
    use({ [DOWNLOAD]: single });
    await downloadManager.downloadExtension(input, true);
    await downloadManager.downloadExtension(input, true);
    await flush();
    expect(Object.keys(downloadsState().records)).toEqual([ID]);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe('options', () => {
  const offer = { options: [{ id: '720', label: '720p · 310 MB', download: '/api/e1/download?q=720' }, { id: '480', label: '480p', download: '/api/e1/download?q=480' }] };

  it('lists the options first', async () => {
    use({ [DOWNLOAD]: offer });
    const options = await downloadManager.extensionOptions(EXT_ID, DOWNLOAD, true);
    expect(options.map((o) => o.id)).toEqual(['720', '480']);
    use({ [DOWNLOAD]: single });
    expect(await downloadManager.extensionOptions(EXT_ID, DOWNLOAD, true)).toEqual([]);
  });

  it('refuses with no choice, and downloads the chosen option', async () => {
    use({ [DOWNLOAD]: offer, [`${BASE}/api/e1/download?q=480`]: { url: '/files/e1-480.mp4' } });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('Choose a quality first.');
    expect(downloadsState().records[ID]).toBeUndefined();

    await downloadManager.downloadExtension({ ...input, option: '480' }, true);
    await flush();
    expect((mockStart.mock.calls[0][0] as { url: string }).url).toBe(`${BASE}/files/e1-480.mp4`);
    expect(downloadsState().records[ID]!.source).toMatchObject({ option: '480', label: '480p' });
  });

  it('refuses an option that is no longer offered', async () => {
    use({ [DOWNLOAD]: offer });
    await expect(downloadManager.downloadExtension({ ...input, option: '1080' }, true)).rejects.toThrow(/not offered/);
  });
});

describe('an expired file URL', () => {
  it('asks the description again once and continues from the saved bytes', async () => {
    use({ [DOWNLOAD]: (n: number) => ({ ...single, url: `/files/e1-720.mp4?sig=${n}` }) });
    await downloadManager.downloadExtension(input, true);
    await flush();
    mockHandlers.current!.onBegin(ID, 1000, '"v1"');
    mockHandlers.current!.onProgress(ID, 400, 1000);
    mockHandlers.current!.onError(ID, 'HTTP 403', 403);
    await flush();

    expect(mockStart).toHaveBeenCalledTimes(2);
    const second = mockStart.mock.calls[1][0] as { url: string; resume?: { expectedBytes: number | null; validator: string | null } };
    // The first start asked the description in downloadExtension and again in begin.
    expect(second.url).toMatch(/sig=3$/);
    expect(second.resume).toEqual({ expectedBytes: 1000, validator: '"v1"' });
    expect(downloadsState().records[ID]!.state).toBe('downloading');

    // The new URL fails at once too: no loop, the download fails.
    mockHandlers.current!.onError(ID, 'HTTP 403', 403);
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(downloadsState().records[ID]!.state).toBe('failed');
  });

  it('a network error does not ask the description again', async () => {
    use({ [DOWNLOAD]: single });
    await downloadManager.downloadExtension(input, true);
    await flush();
    mockHandlers.current!.onError(ID, 'The connection was lost', 0);
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(downloadsState().records[ID]!.state).toBe('failed');
  });
});

describe('an extension that prepares the file first', () => {
  const preparing = (progress?: number) => ({ preparing: { ...(progress !== undefined ? { progress } : {}), retryAfter: 5 } });
  let now = 1_000_000;
  let clock: jest.SpyInstance<number, []>;
  beforeEach(() => {
    now = 1_000_000;
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => clock.mockRestore());

  /** Time passes, and the manager's tick runs (it runs every 5 s in the app). */
  async function later(ms: number) {
    now += ms;
    downloadManager.tick();
    await flush();
  }

  it('sends Prefer: respond-async, waits in preparing with no transfer, then downloads the file when it is ready', async () => {
    use({ [DOWNLOAD]: (n: number) => (n < 3 ? preparing(n * 0.2) : single) });
    const out = await downloadManager.downloadExtension(input, true);
    await flush();
    expect(out).toEqual({ preparing: true });
    expect(fake.requests[0]!.headers.Prefer).toBe('respond-async');
    let r = downloadsState().records[ID]!;
    expect(r.state).toBe('preparing');
    expect(r.prepare).toEqual({ since: now, progress: 0.2 });
    expect(mockStart).not.toHaveBeenCalled();

    // Not yet time to ask again.
    await later(4000);
    expect(fake.requests).toHaveLength(1);
    await later(1000);
    r = downloadsState().records[ID]!;
    expect(fake.requests).toHaveLength(2);
    expect(r.state).toBe('preparing');
    expect(r.prepare).toEqual({ since: 1_000_000, progress: 0.4 });

    await later(5000);
    r = downloadsState().records[ID]!;
    expect(r.state).toBe('downloading');
    expect(r.prepare).toBeUndefined();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect((mockStart.mock.calls[0][0] as { url: string }).url).toBe(`${BASE}/files/e1-720.mp4?sig=one`);
  });

  it('a hard server failure while preparing ends as failed with the server message', async () => {
    use({
      [DOWNLOAD]: (n: number) => {
        if (n === 1) return preparing();
        throw new ExtensionError('Video unavailable', 502);
      },
    });
    await downloadManager.downloadExtension(input, true);
    await later(5000);
    const r = downloadsState().records[ID]!;
    expect(r.state).toBe('failed');
    expect(r.error).toBe('Video unavailable');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('cancel and pause stop the asks', async () => {
    use({ [DOWNLOAD]: preparing() });
    await downloadManager.downloadExtension(input, true);
    await downloadManager.pause(ID);
    expect(downloadsState().records[ID]!.state).toBe('paused');
    await later(60_000);
    expect(fake.requests).toHaveLength(1);

    await downloadManager.resume(ID);
    await flush();
    expect(downloadsState().records[ID]!.state).toBe('preparing');
    expect(fake.requests).toHaveLength(2);

    await downloadManager.cancel(ID);
    expect(downloadsState().records[ID]).toBeUndefined();
    await later(60_000);
    expect(fake.requests).toHaveLength(2);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('gives up after the limit with a clear message', async () => {
    use({ [DOWNLOAD]: preparing() });
    await downloadManager.downloadExtension(input, true);
    await later(PREPARE_LIMIT_MS);
    const r = downloadsState().records[ID]!;
    expect(r.state).toBe('failed');
    expect(r.error).toBe(PREPARE_TOO_LONG);
    expect(r.retryAt).toBeNull();
  });

  it('a saved wait (after a restart) asks again on the next tick', async () => {
    use({ [DOWNLOAD]: single });
    const saved = newExtensionRecord(input, { serverId: 'server-1', userId: 'user-1', baseUrl: BASE, kind: 'video', order: 0, now: 1 });
    putRecord({ ...saved, state: 'preparing', retryAt: now - 1, prepare: { since: now - 60_000, progress: 0.5 } });
    await later(0);
    expect(downloadsState().records[ID]!.state).toBe('downloading');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('an expired file URL whose file the server makes again waits in preparing', async () => {
    use({ [DOWNLOAD]: (n: number) => (n <= 2 ? single : n === 3 ? preparing(0.1) : { ...single, url: '/files/e1-720.mp4?sig=new' }) });
    await downloadManager.downloadExtension(input, true);
    await flush();
    mockHandlers.current!.onError(ID, 'HTTP 404', 404);
    await flush();
    expect(downloadsState().records[ID]!.state).toBe('preparing');
    await later(5000);
    expect(downloadsState().records[ID]!.state).toBe('downloading');
    expect((mockStart.mock.calls[1][0] as { url: string }).url).toMatch(/sig=new$/);
  });

  it('a browser that refuses the Prefer header (CORS) asks once more without it', async () => {
    let n = 0;
    fake = fakeDeps(() => ext, {});
    downloadManager.useExtensionDeps({
      ...fake.deps,
      sendJson: async (req) => {
        fake.requests.push(req);
        n++;
        if (req.headers.Prefer) throw Object.assign(new ExtensionError('Cannot reach the extension (Failed to fetch).'), { unreachable: true });
        return single;
      },
    });
    await downloadManager.downloadExtension(input, true);
    await flush();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(fake.requests[1]!.headers.Prefer).toBeUndefined();
    expect(downloadsState().records[ID]!.state).toBe('downloading');
  });
});

describe('refusals', () => {
  it('refuses when the downloads grant is off', async () => {
    ext = mediaExtension({ downloads: false });
    use({ [DOWNLOAD]: single });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('Downloads are off for this extension. Turn them on in Settings, Extensions.');
    expect(fake.requests).toHaveLength(0);
    expect(downloadsState().records[ID]).toBeUndefined();
  });

  it('refuses an extension with no downloads permission, or one that is off', async () => {
    ext = mediaExtension({ permissions: ['network', 'playback'] });
    use({ [DOWNLOAD]: single });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('This extension cannot save files on the device.');
    ext = mediaExtension({ enabled: false });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow(/off/);
  });

  it('refuses a download description on another origin, with no URL in the text', async () => {
    use({ 'https://other.example.net/dl': single });
    const err = await downloadManager.downloadExtension({ ...input, download: 'https://other.example.net/dl' }, true).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/https?:|example/);
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a description whose file is on another origin or is HLS', async () => {
    use({ [DOWNLOAD]: { url: 'https://other.example.net/e1.mp4' } });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('The extension sent no file the app can save.');
    use({ [DOWNLOAD]: { url: '/hls/e1/master.m3u8' } });
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('The extension sent no file the app can save.');
  });

  it('refuses where the platform has no downloads (the plain web build)', async () => {
    use({ [DOWNLOAD]: single });
    await expect(downloadManager.downloadExtension(input, false)).rejects.toThrow(/not available here/);
  });
});

describe('accounts', () => {
  it('a queued download of another account waits until that account is signed in', async () => {
    use({ [DOWNLOAD]: single });
    // Account A queued it; account B is signed in now.
    putRecord(newExtensionRecord(input, { serverId: 'server-1', userId: 'user-1', baseUrl: BASE, kind: 'video', order: 0, now: 1 }));
    mockSession.current = { serverId: 'server-1', userId: 'user-2', serverUrl: 'http://jellyfin.test', token: 't' };
    downloadManager.tick();
    await flush();
    expect(mockStart).not.toHaveBeenCalled();
    expect(downloadsState().records[ID]!.state).toBe('queued');

    mockSession.current = { serverId: 'server-1', userId: 'user-1', serverUrl: 'http://jellyfin.test', token: 't' };
    downloadManager.tick();
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('refuses an entry that another account on the device saved, and leaves that record alone', async () => {
    use({ [DOWNLOAD]: single });
    const theirs = { ...newExtensionRecord(input, { serverId: 'server-1', userId: 'user-2', baseUrl: BASE, kind: 'video', order: 0, now: 1 }), state: 'paused' as const };
    putRecord(theirs);
    await expect(downloadManager.downloadExtension(input, true)).rejects.toThrow('Another account');
    expect(downloadsState().records[ID]).toEqual(theirs);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('removes only the downloads of the extension and account asked for', async () => {
    use({ [DOWNLOAD]: single, [`${BASE}/api/e2/download`]: single });
    await downloadManager.downloadExtension(input, true);
    await downloadManager.downloadExtension({ ...input, mediaId: 'e2', download: `${BASE}/api/e2/download` }, true);
    await flush();
    await downloadManager.removeExtensionDownloads(EXT_ID, 'server-1.user-2');
    expect(Object.keys(downloadsState().records)).toHaveLength(2);
    await downloadManager.removeExtensionDownloads(EXT_ID, 'server-1.user-1');
    expect(Object.keys(downloadsState().records)).toHaveLength(0);
  });
});
