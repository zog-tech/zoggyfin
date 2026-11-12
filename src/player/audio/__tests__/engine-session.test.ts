/**
 * iOS: after a pause the engine did not ask for (an interruption), the next
 * play activates the audio session first. With the patched expo-audio, the
 * lock screen next and previous commands reach the engine's listeners.
 */
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

import { AudioEngine } from '../engine';

type Listener = (e: Record<string, unknown>) => void;

interface FakePlaylist {
  listeners: Map<string, Listener>;
  play: jest.Mock;
  pause: jest.Mock;
  clear: jest.Mock;
  add: jest.Mock;
  remove: jest.Mock;
  seekTo: jest.Mock;
  setRemoteTrackCommands?: jest.Mock;
  playbackRate: number;
  addListener: (name: string, l: Listener) => void;
}

const fake: { playlist: FakePlaylist | null; patched: boolean; order: string[] } = { playlist: null, patched: true, order: [] };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => {
    fake.order.push('activate');
    return Promise.resolve();
  }),
  createAudioPlaylist: jest.fn(() => {
    const p: FakePlaylist = {
      listeners: new Map(),
      play: jest.fn(() => fake.order.push('play')),
      pause: jest.fn(),
      clear: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
      seekTo: jest.fn(() => Promise.resolve()),
      playbackRate: 1,
      addListener(name, l) {
        p.listeners.set(name, l);
      },
    };
    if (fake.patched) p.setRemoteTrackCommands = jest.fn();
    fake.playlist = p;
    return p;
  }),
}));

function status(playing: boolean) {
  fake.playlist?.listeners.get('playlistStatusUpdate')?.({
    currentIndex: 0,
    currentTime: 10,
    isLoaded: true,
    isBuffering: false,
    playing,
    duration: 200,
    didJustFinish: false,
  });
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** A loaded engine that played, then was paused by an interruption. */
async function interrupted(): Promise<AudioEngine> {
  const engine = new AudioEngine();
  await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, true);
  status(true);
  status(false);
  fake.order = [];
  return engine;
}

beforeEach(() => {
  fake.patched = true;
  fake.order = [];
  jest.clearAllMocks();
});

describe('audio engine session (iOS)', () => {
  it('activates the session before the play that follows an interruption', async () => {
    const engine = await interrupted();
    engine.play();
    expect(fake.order).toEqual([]);
    await flush();
    expect(fake.order).toEqual(['activate', 'play']);
    expect(setAudioModeAsync).toHaveBeenCalledTimes(2);
  });

  it("a play after the app's own pause does not wait for the session", async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, true);
    status(true);
    engine.pause();
    status(false);
    fake.order = [];
    engine.play();
    expect(fake.order).toEqual(['play']);
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
  });

  it('a pause while the session is restored cancels the play', async () => {
    const engine = await interrupted();
    engine.play();
    engine.pause();
    await flush();
    expect(fake.order).toEqual(['activate']);
  });

  it('a lock screen play after an interruption activates the session and plays again', async () => {
    await interrupted();
    status(true); // The native player played by itself.
    await flush();
    expect(fake.order).toEqual(['activate', 'play']);
  });

  it('a new load after an interruption activates the session first', async () => {
    const engine = await interrupted();
    await engine.load({ key: 'b', uri: 'b.mp3' }, null, 0, true);
    expect(fake.order).toEqual(['activate', 'play']);
  });

  it('sends the lock screen next and previous commands to its listeners', async () => {
    const engine = new AudioEngine();
    const events: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'remote') events.push(e.command);
    });
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, true);
    const p = fake.playlist!;
    expect(p.setRemoteTrackCommands).toHaveBeenCalledWith(true);
    p.listeners.get('remoteTrackCommand')?.({ command: 'next' });
    p.listeners.get('remoteTrackCommand')?.({ command: 'previous' });
    p.listeners.get('remoteTrackCommand')?.({ command: 'other' });
    expect(events).toEqual(['next', 'previous']);
  });

  it('an older binary without the patch keeps the native lock screen commands', async () => {
    fake.patched = false;
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, true);
    expect(fake.playlist!.listeners.has('remoteTrackCommand')).toBe(false);
  });
});
