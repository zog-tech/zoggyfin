/**
 * A new load empties the native playlist. ExoPlayer then sends one last
 * status of the old track: finished, at the old track's length. That status
 * must not end the new track (on a Fire TV a library song whose next song was
 * a catalog song, so not preloaded, stopped at once with the old length).
 */
import { AudioEngine, type AudioEngineEvent } from '../engine';

type Listener = (e: Record<string, unknown>) => void;
const mockListeners = new Map<string, Listener>();

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  createAudioPlaylist: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    clear: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    playbackRate: 1,
    volume: 1,
    addListener: (name: string, l: Listener) => void mockListeners.set(name, l),
    seekTo: () => Promise.resolve(),
  })),
}));

const status = (s: Record<string, unknown>) =>
  mockListeners.get('playlistStatusUpdate')?.({ currentIndex: 0, isBuffering: false, isLoaded: true, playing: false, didJustFinish: false, ...s });

describe('audio engine: the old track finished after a new load', () => {
  it('does not end the new track or take the old position', async () => {
    const engine = new AudioEngine();
    const events: AudioEngineEvent[] = [];
    engine.subscribe((e) => events.push(e));
    await engine.load({ key: 'new', uri: 'new.m4a' }, null, 0, true);
    // The stale status of the old track (188 s long), sent when the playlist was emptied.
    status({ currentTime: 188.5, duration: 188.5, didJustFinish: true });
    expect(events.some((e) => e.type === 'ended')).toBe(false);
    expect(engine.position).toBeLessThan(1);
    // The new track loads and plays.
    status({ currentTime: 0, duration: 213, playing: true });
    status({ currentTime: 1, duration: 213, playing: true });
    expect(engine.position).toBeGreaterThan(0.5);
    expect(engine.position).toBeLessThan(2);
    // Its real end still ends it.
    status({ currentTime: 213, duration: 213, didJustFinish: true });
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(1);
  });
});
