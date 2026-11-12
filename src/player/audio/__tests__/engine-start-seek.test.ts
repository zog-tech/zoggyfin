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
  volume: number;
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
      volume: 1,
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

  it('a transcode that starts later reports positions from its offset and seeks inside the stream', async () => {
    const engine = new AudioEngine();
    const events: { position: number; duration: number }[] = [];
    engine.subscribe((e) => {
      if (e.type === 'status') events.push({ position: e.position, duration: e.duration });
    });
    await engine.load({ key: 'a', uri: 'a.mp3?StartTimeTicks=600000000', offset: 60 }, null, 60, true);
    const p = fake.playlist!;
    // The stream starts at the offset: no start seek, it plays at once.
    expect(p.play).toHaveBeenCalledTimes(1);
    loadedStatus();
    expect(p.seeks).toEqual([]);
    p.listeners.get('playlistStatusUpdate')?.({
      currentIndex: 0,
      currentTime: 5,
      isLoaded: true,
      isBuffering: false,
      playing: true,
      duration: Infinity,
      didJustFinish: false,
    });
    expect(events[events.length - 1]).toEqual({ position: 65, duration: 0 });
    engine.seekTo(70);
    expect(p.seeks.map((s) => s.seconds)).toEqual([10]);
    expect(engine.position).toBe(70);
  });
});

describe('audio engine volume', () => {
  it('a volume set before the playlist exists holds for it (listen together: no sound here)', async () => {
    fake.playlist = null;
    const engine = new AudioEngine();
    engine.setVolume(0);
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, false);
    expect(fake.playlist!.volume).toBe(0);
    engine.setVolume(1);
    expect(fake.playlist!.volume).toBe(1);
  });
});
