/**
 * The video session's live path (IPTV channels) with a fake engine: a live
 * stream that played and then stops getting data starts again by itself.
 *
 * Seen with an Xtream panel that allows one stream per account: when a second
 * device takes the stream, the panel answers 509 to the HLS playlist. AVPlayer
 * then empties its buffer and pauses, but the item stays ready, so expo-video
 * sends "loading" and no error. The player showed "buffering" for good.
 */
import type { EngineEvent, EngineSource } from '../engine-types';
import type { LiveChannelRef, LiveSource } from '../types';

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
const mockGate = { active: false };

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
jest.mock('../control-gate', () => ({ controlGate: { get active() { return mockGate.active; }, intercept: () => false }, togglePauses: (p: boolean) => p }));
jest.mock('../outbox-transport', () => ({ isForeignDownload: jest.fn(), outboxOnly: jest.fn(), withOutbox: jest.fn() }));
jest.mock('../track-prefs-store', () => ({ loadTrackPrefs: () => ({}), saveTrackPrefs: jest.fn() }));
jest.mock('@/settings/playback', () => ({ usePlaybackSettings: { getState: () => ({ autoplayNext: true }) }, bitrateFor: () => 0, skipChoices: () => ({}) }));

// eslint-disable-next-line import/first
import { videoSession } from '../session';
// eslint-disable-next-line import/first
import { playerState } from '../store';
// eslint-disable-next-line import/first
import { LIVE_RESTART_LIMIT, LIVE_STALL_MS } from '../live-restart';

const emit = (e: EngineEvent) => mockListener?.(e);
const flush = async () => {
  await jest.advanceTimersByTimeAsync(0);
};

const channel: LiveChannelRef = { id: '469444', name: 'USA Network', logo: null, number: 4192, group: 'US' };
const explainFailure = jest.fn(async () => 'This provider allows 1 stream at a time, and all are in use.');
const src: LiveSource = {
  providerId: 'p1',
  resolve: async () => ({ candidates: [{ url: 'http://panel.example/live/u/p/469444.m3u8', isHls: true }], userAgent: null, unsupported: null }),
  explainFailure,
};

async function startPlaying(): Promise<void> {
  await videoSession().playLive({ channels: [channel], index: 0, source: src });
  await flush();
  emit({ type: 'status', status: 'ready' });
  emit({ type: 'playing', playing: true });
}

/** What expo-video sends on iOS when the panel cuts the stream: loading, then not playing. */
function panelCutsStream(): void {
  emit({ type: 'status', status: 'loading' });
  emit({ type: 'playing', playing: false });
}

// The session is one object for the app's life: each test starts far from the restarts of the last one.
let clock = 0;
beforeEach(async () => {
  clock += 10 * 60_000;
  jest.useFakeTimers({ now: clock });
  await videoSession().stop();
  mockLoads.length = 0;
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a live stream that stops', () => {
  it('starts the channel again after it stays in buffering', async () => {
    await startPlaying();
    expect(mockLoads).toHaveLength(1);
    panelCutsStream();
    expect(playerState().status).toBe('buffering');
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS - 100);
    expect(mockLoads).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(200);
    await flush();
    expect(mockLoads).toHaveLength(2);
    expect(playerState().status).toBe('loading');
  });

  it('a pause during a stall wins: the channel does not start again until Play', async () => {
    await startPlaying();
    panelCutsStream();
    videoSession().pause();
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS * 3);
    expect(mockLoads).toHaveLength(1);
    videoSession().play_();
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS + 100);
    await flush();
    expect(mockLoads).toHaveLength(2);
  });

  it('does not start again when the stream recovers in time', async () => {
    await startPlaying();
    panelCutsStream();
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS / 2);
    emit({ type: 'status', status: 'ready' });
    emit({ type: 'playing', playing: true });
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS * 2);
    expect(mockLoads).toHaveLength(1);
  });

  it('shows the provider reason after a few restarts in a short time', async () => {
    await startPlaying();
    for (let i = 0; i < LIVE_RESTART_LIMIT; i++) {
      panelCutsStream();
      await jest.advanceTimersByTimeAsync(LIVE_STALL_MS + 100);
      await flush();
      emit({ type: 'status', status: 'ready' });
      emit({ type: 'playing', playing: true });
    }
    expect(mockLoads).toHaveLength(1 + LIVE_RESTART_LIMIT);
    panelCutsStream();
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS + 100);
    await flush();
    expect(mockLoads).toHaveLength(1 + LIVE_RESTART_LIMIT);
    expect(playerState().status).toBe('error');
    expect(playerState().error).toBe('This provider allows 1 stream at a time, and all are in use.');
  });

  it('starts the channel again when the stream says it ended', async () => {
    await startPlaying();
    emit({ type: 'ended' });
    await flush();
    expect(mockLoads).toHaveLength(2);
    expect(playerState().status).toBe('loading');
  });

  it('a stop ends the wait: nothing loads later', async () => {
    await startPlaying();
    panelCutsStream();
    await videoSession().stop();
    await jest.advanceTimersByTimeAsync(LIVE_STALL_MS * 2);
    expect(mockLoads).toHaveLength(1);
  });
});
