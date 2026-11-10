/**
 * The video session's external path (IPTV films, extension media) with a
 * fake engine: headers reach the engine, the stream forms are tried in
 * order, a quality switch reloads at the position, subtitles never load
 * through the Jellyfin client, progress goes to the source, errors hold no
 * URL, and an IPTV title behaves as before.
 */
import type { EngineEvent, EngineSource } from '../engine-types';
import type { ExternalPlayRequest, ExternalReportEvent, ExternalSource, ExternalStream } from '../types';

const mockLoads: EngineSource[] = [];
let mockListener: ((e: EngineEvent) => void) | null = null;
const mockEngine = {
  position: 0,
  pipSupported: false,
  load: jest.fn((s: EngineSource) => mockLoads.push(s)),
  unload: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  setRate: jest.fn(),
  setMuted: jest.fn(),
  startPip: jest.fn(),
  subscribe: (l: (e: EngineEvent) => void) => {
    mockListener = l;
    return () => undefined;
  },
};
const mockGetText = jest.fn(async () => 'WEBVTT\n');

jest.mock('../engine', () => ({ getEngine: () => mockEngine }));
jest.mock('@/api/jellyfin', () => ({ getText: (...a: unknown[]) => mockGetText(...(a as [])) }));
jest.mock('@/api/client', () => ({ getApi: jest.fn() }));
jest.mock('@/api/query-client', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('@/auth/session-store', () => ({ useSessionStore: { getState: () => ({ session: null }), subscribe: jest.fn() } }));
jest.mock('@/auth/identity', () => ({ clientIdentity: () => ({ deviceId: 'd' }) }));
jest.mock('@/downloads', () => ({ checkDownloadedFiles: jest.fn(), findDownload: () => null, localExtraUri: jest.fn(), localFileFor: () => null, readLocalText: jest.fn() }));
jest.mock('@/downloads/outbox-store', () => ({ outboxPosition: () => null }));
jest.mock('@/downloads/store', () => ({ useDownloadsStore: { subscribe: jest.fn() } }));
jest.mock('@/images/resolve-image', () => ({ resolveImage: jest.fn() }));
jest.mock('@/lib/online', () => ({ isOffline: () => false }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(), NetworkStateType: {} }));
jest.mock('@/native/ts-bridge', () => ({ tsBridge: null }));
jest.mock('../capabilities', () => ({ mediaCapabilities: jest.fn() }));
jest.mock('../play-router', () => ({ playRouter: { active: false, autoplay: () => false, route: (r: unknown) => r } }));
jest.mock('../control-gate', () => ({ controlGate: { active: false, intercept: () => false }, togglePauses: (p: boolean) => p }));
jest.mock('../outbox-transport', () => ({ isForeignDownload: jest.fn(), outboxOnly: jest.fn(), withOutbox: jest.fn() }));
jest.mock('../track-prefs-store', () => ({ loadTrackPrefs: () => ({}), saveTrackPrefs: jest.fn() }));
jest.mock('@/settings/playback', () => ({ usePlaybackSettings: { getState: () => ({ autoplayNext: true }) }, bitrateFor: () => 0 }));

// eslint-disable-next-line import/first
import { videoSession } from '../session';
// eslint-disable-next-line import/first
import { playerState } from '../store';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const emit = (e: EngineEvent) => mockListener?.(e);

const HEADERS = { 'X-Api-Key': 'k', Authorization: 'MediaBrowser Token="t"' };

function source(stream: Partial<ExternalStream>, extra: Partial<ExternalSource> = {}): ExternalSource & { reports: ExternalReportEvent[]; texts: string[] } {
  const reports: ExternalReportEvent[] = [];
  const texts: string[] = [];
  return {
    providerId: 'ext:org.example',
    label: 'Example',
    itemId: (ref) => `ext:org.example:${ref.id}`,
    resolve: async () => ({ candidates: [], userAgent: null, unsupported: null, ...stream }),
    loadText: async (url) => {
      texts.push(url);
      return 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n';
    },
    reports,
    texts,
    ...extra,
  };
}

const request = (src: ExternalSource, startSeconds?: number): ExternalPlayRequest => ({
  items: [{ id: 'e1', kind: 'film', title: 'An entry', poster: null }],
  index: 0,
  source: src,
  ...(startSeconds !== undefined ? { startSeconds } : {}),
});

const BASE = 'https://media.example.org';
const full: Partial<ExternalStream> = {
  candidates: [
    { url: `${BASE}/hls/master.m3u8`, isHls: true },
    { url: `${BASE}/files/e1.mp4`, isHls: false },
  ],
  headers: HEADERS,
  resume: 120,
  duration: 700,
  title: 'The real title',
  qualities: [
    { id: 'auto', label: 'Auto', url: `${BASE}/hls/master.m3u8`, isHls: true },
    { id: '720', label: '720p', url: `${BASE}/hls/720.m3u8`, isHls: true },
  ],
  subtitles: [{ id: 'en', label: 'English', language: 'en', url: `${BASE}/subs/en.vtt` }],
  chapters: [{ title: 'Part 1', start: 0 }],
};

beforeEach(async () => {
  await videoSession().stop();
  mockLoads.length = 0;
  mockEngine.position = 0;
  jest.clearAllMocks();
});

describe('external titles in the video session', () => {
  it('passes the source headers to the engine and starts at the resume point', async () => {
    const src = source(full);
    await videoSession().playExternal(request(src));
    expect(mockLoads).toHaveLength(1);
    expect(mockLoads[0]).toMatchObject({ uri: `${BASE}/hls/master.m3u8`, isHls: true, startSeconds: 120, headers: HEADERS, title: 'The real title' });
    const now = playerState().now;
    expect(now?.item.Id).toBe('ext:org.example:e1');
    expect(now?.external).toMatchObject({ live: false, qualityId: null, mainQuality: 'auto' });
    expect(now?.chapters).toEqual([{ name: 'Part 1', start: 0 }]);
    expect(playerState().duration).toBe(700);
  });

  it('a requested position wins over the resume point; 0 starts over', async () => {
    await videoSession().playExternal(request(source(full), 0));
    expect(mockLoads[0].startSeconds).toBe(0);
  });

  it('tries the next stream form when one fails, and shows no URL when all fail', async () => {
    await videoSession().playExternal(request(source(full)));
    emit({ type: 'status', status: 'error', error: `Cannot open ${BASE}/hls/master.m3u8` });
    expect(mockLoads[1]).toMatchObject({ uri: `${BASE}/files/e1.mp4`, headers: HEADERS });
    emit({ type: 'status', status: 'error', error: `Cannot open ${BASE}/files/e1.mp4?token=t` });
    expect(playerState().status).toBe('error');
    expect(playerState().error).toBe('This title could not be played.');
  });

  it('says the source reason when nothing can play', async () => {
    await videoSession().playExternal(request(source({ unsupported: 'This extension is off.' })));
    expect(mockLoads).toHaveLength(0);
    expect(playerState().error).toBe('This extension is off.');
  });

  it('a quality switch reloads that URL at the current position with the same headers', async () => {
    await videoSession().playExternal(request(source(full)));
    emit({ type: 'playing', playing: true });
    mockEngine.position = 333;
    videoSession().setExternalQuality('720');
    expect(mockLoads).toHaveLength(2);
    expect(mockLoads[1]).toMatchObject({ uri: `${BASE}/hls/720.m3u8`, startSeconds: 333, headers: HEADERS });
    expect(playerState().now?.external?.qualityId).toBe('720');
    // The source's own "Auto" is the main stream: choosing it reloads the main URL.
    mockEngine.position = 400;
    emit({ type: 'playing', playing: false });
    emit({ type: 'playing', playing: true });
    videoSession().setExternalQuality('auto');
    expect(mockLoads[2]).toMatchObject({ uri: `${BASE}/hls/master.m3u8`, startSeconds: 400 });
  });

  it('a failed quality falls back to the other stream forms at the same position', async () => {
    await videoSession().playExternal(request(source(full)));
    emit({ type: 'playing', playing: true });
    mockEngine.position = 50;
    videoSession().setExternalQuality('720');
    emit({ type: 'status', status: 'error', error: 'decode' });
    expect(mockLoads[2]).toMatchObject({ uri: `${BASE}/hls/master.m3u8`, startSeconds: 50 });
  });

  it('loads subtitle files through the source, never through the Jellyfin client', async () => {
    const src = source(full);
    await videoSession().playExternal(request(src));
    expect(playerState().now?.plan.subtitles).toHaveLength(1);
    await videoSession().selectSubtitle(0);
    expect(src.texts).toEqual([`${BASE}/subs/en.vtt`]);
    expect(mockGetText).not.toHaveBeenCalled();
    expect(playerState().cues).toHaveLength(1);
    await videoSession().selectSubtitle(null);
    expect(playerState().cues).toBeNull();
  });

  it('sends start, pause, resume, seek and finished to the source, at its interval', async () => {
    jest.useFakeTimers();
    try {
      const events: ExternalReportEvent[] = [];
      const src = source({ ...full, progress: { intervalMs: 5000, send: async (e) => void events.push(e) } });
      const done = videoSession().playExternal(request(src));
      await jest.advanceTimersByTimeAsync(0);
      await done;
      emit({ type: 'playing', playing: true });
      await jest.advanceTimersByTimeAsync(10_000);
      emit({ type: 'playing', playing: false });
      emit({ type: 'playing', playing: true });
      videoSession().seekTo(200);
      emit({ type: 'ended' });
      await jest.advanceTimersByTimeAsync(10);
      expect(events).toEqual(['start', 'progress', 'progress', 'pause', 'resume', 'seek', 'finished']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends stop (not finished) when the user stops early, and nothing without a report', async () => {
    const events: ExternalReportEvent[] = [];
    await videoSession().playExternal(request(source({ ...full, progress: { intervalMs: 10_000, send: async (e) => void events.push(e) } })));
    await videoSession().stop();
    expect(events).toEqual(['start', 'stop']);
  });

  it('a live stream has no duration, no resume and does not seek', async () => {
    await videoSession().playExternal(request(source({ ...full, live: true })));
    expect(mockLoads[0].startSeconds).toBe(0);
    emit({ type: 'duration', duration: 30 });
    expect(playerState().duration).toBe(0);
    videoSession().seekTo(10);
    expect(mockEngine.seekTo).not.toHaveBeenCalled();
    expect(playerState().now?.external?.live).toBe(true);
  });

  it('autoplays the description’s next title with the same source', async () => {
    const resolve = jest.fn(async (ref: { id: string }) =>
      ref.id === 'e1'
        ? { ...full, candidates: full.candidates ?? [], userAgent: null, unsupported: null, next: { id: 'e2', kind: 'film' as const, title: 'Next', poster: null } }
        : { candidates: [{ url: `${BASE}/files/e2.mp4`, isHls: false }], userAgent: null, unsupported: null, resume: 5 },
    );
    const src = source({}, { resolve });
    await videoSession().playExternal(request(src));
    expect(playerState().now?.next?.Name).toBe('Next');
    emit({ type: 'ended' });
    await flush();
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'e2' }));
    expect(mockLoads.at(-1)).toMatchObject({ uri: `${BASE}/files/e2.mp4`, startSeconds: 5 });
  });

  it('IPTV: no headers, positions saved through the source, the next episode from the list', async () => {
    const saved: [string, number, boolean][] = [];
    const iptv: ExternalSource = {
      providerId: 'p1',
      resolve: async (ref) => ({ candidates: [{ url: `http://panel.example/series/u/p/${ref.id}.mp4`, isHls: false }], userAgent: 'VLC', unsupported: null }),
      savePosition: (ref, position, _d, ended) => saved.push([ref.id, position, ended]),
    };
    const req: ExternalPlayRequest = {
      items: [
        { id: '1', kind: 'episode', title: 'One', poster: null, seriesName: 'Show', season: 1, episode: 1 },
        { id: '2', kind: 'episode', title: 'Two', poster: null, seriesName: 'Show', season: 1, episode: 2 },
      ],
      index: 0,
      source: iptv,
      startSeconds: 60,
    };
    await videoSession().playExternal(req);
    expect(mockLoads[0]).toMatchObject({ startSeconds: 60, userAgent: 'VLC', subtitle: 'Show · S1 E1' });
    expect(mockLoads[0].headers).toBeUndefined();
    expect(playerState().now?.item.Id).toBe('iptv-vod:p1:episode:1');
    expect(playerState().now?.next?.Id).toBe('iptv-vod:p1:episode:2');
    emit({ type: 'playing', playing: true });
    mockEngine.position = 90;
    emit({ type: 'playing', playing: false });
    expect(saved).toEqual([['1', 90, false]]);
    await videoSession().playNext();
    expect(saved.at(-1)?.[2]).toBe(true);
    expect(mockLoads.at(-1)).toMatchObject({ uri: 'http://panel.example/series/u/p/2.mp4', startSeconds: 0 });
  });
});
