/**
 * iOS: a song that turns ready while the player still waits to play. The app
 * sends play before the track is ready; AVQueuePlayer can then wait with the
 * item ready and send no status at all (expo-audio's statuses come from the
 * item turning ready and from a time observer that runs only while the time
 * moves). The song started only when the user pressed play again. The engine
 * now looks at the native player on a timer and plays again.
 */
import { AudioEngine } from '../engine';
import { START_MAX_KICKS, START_STALL_KICK_MS } from '../start-watch';

type Listener = (e: Record<string, unknown>) => void;

interface FakePlaylist {
  listeners: Map<string, Listener>;
  play: jest.Mock;
  pause: jest.Mock;
  clear: jest.Mock;
  add: jest.Mock;
  remove: jest.Mock;
  seekTo: jest.Mock;
  setRemoteTrackCommands: jest.Mock;
  playbackRate: number;
  // The native player's state now, as expo-audio's shared object reads it.
  playing: boolean;
  isBuffering: boolean;
  isLoaded: boolean;
  addListener: (name: string, l: Listener) => void;
}

const fake: { playlist: FakePlaylist | null } = { playlist: null };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
  createAudioPlaylist: jest.fn(() => {
    const p: FakePlaylist = {
      listeners: new Map(),
      play: jest.fn(),
      pause: jest.fn(),
      clear: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
      seekTo: jest.fn(() => Promise.resolve()),
      setRemoteTrackCommands: jest.fn(),
      playbackRate: 1,
      playing: false,
      isBuffering: false,
      isLoaded: false,
      addListener(name, l) {
        p.listeners.set(name, l);
      },
    };
    fake.playlist = p;
    return p;
  }),
}));

/** Sets the native state and sends it as a status, as expo-audio does. */
function status(s: { playing: boolean; isBuffering: boolean; isLoaded: boolean; currentTime?: number }) {
  const p = fake.playlist;
  if (!p) throw new Error('no playlist');
  p.playing = s.playing;
  p.isBuffering = s.isBuffering;
  p.isLoaded = s.isLoaded;
  p.listeners.get('playlistStatusUpdate')?.({ currentIndex: 0, currentTime: s.currentTime ?? 0, duration: 200, didJustFinish: false, ...s });
}

/** Changes the native state with no status, as AVPlayer does while it waits. */
function quietly(s: { playing: boolean; isBuffering: boolean; isLoaded: boolean }) {
  const p = fake.playlist;
  if (!p) throw new Error('no playlist');
  Object.assign(p, s);
}

async function loaded(): Promise<FakePlaylist> {
  const engine = new AudioEngine();
  await engine.load({ key: 'a', uri: 'a.m4a' }, null, 0, true);
  const p = fake.playlist;
  if (!p) throw new Error('no playlist');
  expect(p.play).toHaveBeenCalledTimes(1);
  return p;
}

beforeEach(() => {
  jest.useFakeTimers();
  fake.playlist = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a start that stalls ready and buffering (iOS)', () => {
  it('plays again when no status comes after the ready one', async () => {
    const p = await loaded();
    status({ playing: false, isBuffering: true, isLoaded: true });
    jest.advanceTimersByTime(START_STALL_KICK_MS - 1);
    expect(p.play).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(p.play).toHaveBeenCalledTimes(2);
  });

  it('stops once the player plays, even when that came with no status', async () => {
    const p = await loaded();
    status({ playing: false, isBuffering: true, isLoaded: true });
    jest.advanceTimersByTime(START_STALL_KICK_MS);
    expect(p.play).toHaveBeenCalledTimes(2);
    quietly({ playing: true, isBuffering: false, isLoaded: true });
    jest.advanceTimersByTime(START_STALL_KICK_MS * 10);
    expect(p.play).toHaveBeenCalledTimes(2);
  });

  it('plays again a few times at most', async () => {
    const p = await loaded();
    status({ playing: false, isBuffering: true, isLoaded: true });
    jest.advanceTimersByTime(START_STALL_KICK_MS * 20);
    expect(p.play).toHaveBeenCalledTimes(1 + START_MAX_KICKS);
  });

  it('waits for a track that is not ready yet', async () => {
    const p = await loaded();
    status({ playing: false, isBuffering: true, isLoaded: false });
    jest.advanceTimersByTime(START_STALL_KICK_MS * 10);
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('never plays again for a song that gave sound and then buffers', async () => {
    const p = await loaded();
    status({ playing: true, isBuffering: false, isLoaded: true, currentTime: 1 });
    status({ playing: false, isBuffering: true, isLoaded: true, currentTime: 30 });
    jest.advanceTimersByTime(START_STALL_KICK_MS * 10);
    expect(p.play).toHaveBeenCalledTimes(1);
  });
});
