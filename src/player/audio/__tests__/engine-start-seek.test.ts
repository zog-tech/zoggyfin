/**
 * The start seek of a load plays the track when it ends (autoplay). A seek
 * of an older load must not play the load that replaced it.
 */
import { AudioEngine } from '../engine';

type Listener = (e: Record<string, unknown>) => void;

interface FakePlaylist {
  listeners: Map<string, Listener>;
  seeks: { seconds: number; resolve: () => void }[];
  play: jest.Mock;
  pause: jest.Mock;
  clear: jest.Mock;
  add: jest.Mock;
  remove: jest.Mock;
  playbackRate: number;
  addListener: (name: string, l: Listener) => void;
  seekTo: (seconds: number) => Promise<void>;
}

const fake: { playlist: FakePlaylist | null } = { playlist: null };

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  createAudioPlaylist: jest.fn(() => {
    const p: FakePlaylist = {
      listeners: new Map(),
      seeks: [],
      play: jest.fn(),
      pause: jest.fn(),
      clear: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
      playbackRate: 1,
      addListener(name, l) {
        p.listeners.set(name, l);
      },
      seekTo(seconds) {
        return new Promise<void>((resolve) => p.seeks.push({ seconds, resolve }));
      },
    };
    fake.playlist = p;
    return p;
  }),
}));

function loadedStatus() {
  fake.playlist?.listeners.get('playlistStatusUpdate')?.({
    currentIndex: 0,
    currentTime: 0,
    isLoaded: true,
    isBuffering: false,
    playing: false,
    duration: 200,
    didJustFinish: false,
  });
}

async function flush() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

describe('audio engine start seek', () => {
  it('plays after the start seek of the current load', async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 30, true);
    loadedStatus();
    const p = fake.playlist!;
    expect(p.seeks.map((s) => s.seconds)).toEqual([30]);
    p.seeks[0]!.resolve();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('a seek of an older load does not play the new load before its own seek', async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 30, true);
    loadedStatus();
    const p = fake.playlist!;
    await engine.load({ key: 'b', uri: 'b.mp3' }, null, 40, true);
    p.seeks[0]!.resolve();
    await flush();
    expect(p.play).not.toHaveBeenCalled();
    loadedStatus();
    expect(p.seeks.map((s) => s.seconds)).toEqual([30, 40]);
    p.seeks[1]!.resolve();
    await flush();
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('a seek that ends after unload does not play', async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 30, true);
    loadedStatus();
    const p = fake.playlist!;
    engine.unload();
    p.seeks[0]!.resolve();
    await flush();
    expect(p.play).not.toHaveBeenCalled();
  });
});
