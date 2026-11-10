/**
 * The native engine with a fake expo-video player: a new source on a
 * player that has one (another quality) starts at the asked position, in
 * the asked play state, also when no statusChange comes. On iOS a paused,
 * ready AVPlayer can keep 'readyToPlay' through the change, so expo-video
 * sends no statusChange, only `sourceLoad`.
 */
import type { EngineEvent } from '../engine-types';

type Handler = (payload: Record<string, unknown>) => void;

interface FakePlayer {
  handlers: Map<string, Handler>;
  currentTime: number;
  playbackRate: number;
  playing: boolean;
  status: string;
  play: jest.Mock;
  pause: jest.Mock;
  replace: jest.Mock;
  fire: (event: string, payload?: Record<string, unknown>) => void;
  [key: string]: unknown;
}

const mockPlayers: FakePlayer[] = [];

jest.mock('expo-video', () => ({
  createVideoPlayer: () => {
    const handlers = new Map<string, Handler>();
    const p: FakePlayer = {
      handlers,
      currentTime: 0,
      playbackRate: 1,
      playing: false,
      status: 'idle',
      availableAudioTracks: [],
      availableSubtitleTracks: [],
      audioTrack: null,
      subtitleTrack: null,
      videoTrack: null,
      play: jest.fn(() => {
        p.playing = true;
      }),
      pause: jest.fn(() => {
        p.playing = false;
      }),
      replace: jest.fn(),
      release: jest.fn(),
      addListener: (event: string, h: Handler) => {
        handlers.set(event, h);
        return { remove: () => handlers.delete(event) };
      },
      fire: (event, payload = {}) => handlers.get(event)?.(payload),
    };
    mockPlayers.push(p);
    return p;
  },
  isPictureInPictureSupported: () => false,
  VideoView: () => null,
}));
jest.mock('@/native/zoggyfin-native', () => ({ setAutoPictureInPicture: jest.fn() }));

// eslint-disable-next-line import/first
import { getEngine } from '../engine.native';

const SOURCE = { uri: 'https://media.example.org/a.mp4?q=high', isHls: false, title: 'A clip' };

function setup() {
  const engine = getEngine();
  const events: EngineEvent[] = [];
  const off = engine.subscribe((e) => events.push(e));
  engine.load({ ...SOURCE, startSeconds: 0 });
  const p = mockPlayers[mockPlayers.length - 1];
  p.fire('statusChange', { status: 'readyToPlay' });
  p.fire('playingChange', { isPlaying: true });
  p.fire('sourceLoad', { duration: 6 });
  p.currentTime = 3;
  return { engine, events, p, off };
}

describe('native engine: a new source on a player that has one', () => {
  let off: () => void = () => undefined;
  afterEach(() => {
    off();
    getEngine().unload();
  });

  it('a paused player starts the new source at the position and stays paused, with no statusChange', () => {
    const t = setup();
    off = t.off;
    t.engine.pause();
    t.p.fire('playingChange', { isPlaying: false });
    t.events.length = 0;
    t.p.play.mockClear();

    t.engine.load({ ...SOURCE, uri: 'https://media.example.org/a.mp4?q=low', startSeconds: 3, autoplay: false });
    t.p.currentTime = 0;
    // The new item reports 0 until it is ready: neither the position nor a time event says 0.
    expect(t.engine.position).toBe(3);
    t.p.fire('timeUpdate', { currentTime: 0, bufferedPosition: 0 });
    expect(t.events.filter((e) => e.type === 'time')).toEqual([]);

    // iOS: the status stays 'readyToPlay', so only sourceLoad comes.
    t.p.fire('sourceLoad', { duration: 6 });
    expect(t.p.currentTime).toBe(3);
    expect(t.p.play).not.toHaveBeenCalled();
    expect(t.events).toContainEqual({ type: 'status', status: 'ready' });
    t.p.fire('timeUpdate', { currentTime: 3, bufferedPosition: 6 });
    expect(t.events).toContainEqual({ type: 'time', position: 3, buffered: 6 });
  });

  it('a playing player plays the new source from the position, and the swap is not a pause', () => {
    const t = setup();
    off = t.off;
    t.events.length = 0;
    t.p.play.mockClear();

    t.engine.load({ ...SOURCE, uri: 'https://media.example.org/a.mp4?q=low', startSeconds: 3 });
    t.p.currentTime = 0;
    t.p.fire('statusChange', { status: 'idle' });
    t.p.fire('playingChange', { isPlaying: false });
    expect(t.events.filter((e) => e.type === 'playing')).toEqual([]);
    t.p.fire('statusChange', { status: 'readyToPlay' });
    expect(t.p.currentTime).toBe(3);
    expect(t.p.play).toHaveBeenCalledTimes(1);
    // The later sourceLoad does not seek or play again.
    t.p.currentTime = 3.4;
    t.p.fire('sourceLoad', { duration: 6 });
    expect(t.p.currentTime).toBe(3.4);
    expect(t.p.play).toHaveBeenCalledTimes(1);
  });

  it('a playing player that is to stay paused on the new source pauses at once', () => {
    const t = setup();
    off = t.off;
    t.engine.load({ ...SOURCE, uri: 'https://media.example.org/a.mp4?q=low', startSeconds: 3, autoplay: false });
    expect(t.p.pause).toHaveBeenCalled();
  });
});
