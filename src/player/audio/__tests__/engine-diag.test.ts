/**
 * The player log only observes: a normal load makes the same mockCalls on the
 * native playlist as before, and the log gets the load, the play, the status
 * and the probe of the native player, with no URL in it.
 */
import { diagEntries, resetDiagForTests } from '@/lib/diag-store';

import { AudioEngine } from '../engine';

type Listener = (e: Record<string, unknown>) => void;

const mockCalls: string[] = [];
const mockFake: { playlist: Record<string, unknown> | null; listeners: Map<string, Listener> } = { playlist: null, listeners: new Map() };

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
  createAudioPlaylist: jest.fn(() => {
    const p = {
      playing: false,
      isLoaded: true,
      isBuffering: false,
      currentIndex: 0,
      trackCount: 2,
      currentTime: 0,
      volume: 1,
      playbackRate: 1,
      play: () => mockCalls.push('play'),
      pause: () => mockCalls.push('pause'),
      clear: () => mockCalls.push('clear'),
      add: (s: { uri: string }) => mockCalls.push(`add ${s.uri}`),
      remove: (i: number) => mockCalls.push(`remove ${i}`),
      next: () => mockCalls.push('next'),
      seekTo: (s: number) => {
        mockCalls.push(`seek ${s}`);
        return Promise.resolve();
      },
      addListener: (name: string, l: Listener) => mockFake.listeners.set(name, l),
    };
    mockFake.playlist = p;
    return p;
  }),
}));

function status(s: Partial<{ playing: boolean; isBuffering: boolean; isLoaded: boolean; currentTime: number }>) {
  mockFake.listeners.get('playlistStatusUpdate')?.({ currentIndex: 0, currentTime: 0, isLoaded: true, isBuffering: false, playing: false, duration: 200, didJustFinish: false, ...s });
}

describe('audio engine player log', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetDiagForTests();
    mockCalls.length = 0;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a normal load makes the same native mockCalls and logs the start', async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'key-aaaaaaaaaaaa', uri: 'https://media.example.org/Audio/1/universal?ApiKey=secret' }, { key: 'key-b', uri: 'https://media.example.org/Audio/2/universal?ApiKey=secret' }, 0, true);
    status({ isBuffering: true, isLoaded: false });
    status({ playing: true, currentTime: 0.5 });
    for (let i = 1; i <= 10; i++) status({ playing: true, currentTime: 0.5 + i * 0.5 });
    engine.setNext(null);
    jest.advanceTimersByTime(2000);

    expect(mockCalls).toEqual([
      'pause',
      'clear',
      'add https://media.example.org/Audio/1/universal?ApiKey=secret',
      'add https://media.example.org/Audio/2/universal?ApiKey=secret',
      'play',
      'remove 1',
    ]);

    const events = diagEntries().map((e) => e.event);
    expect(events).toEqual(['load', 'phase', 'play-now', 'status', 'status', 'watch', 'set-next', 'probe']);
    const load = diagEntries().find((e) => e.event === 'load');
    expect(load?.data).toMatchObject({ autoplay: true, next: true, uri: 'http', key: 'keyaaaaa' });
    const probe = diagEntries().find((e) => e.event === 'probe');
    expect(probe?.data).toMatchObject({ why: 'load', current: true, playing: false, isLoaded: true, trackCount: 2 });
    expect(JSON.stringify(diagEntries())).not.toMatch(/example|ApiKey|secret|https/);
    // The probe only reads: no call on the playlist.
    expect(mockCalls).toHaveLength(6);
  });

  it('logs dropped statuses once per run with a count', async () => {
    const engine = new AudioEngine();
    await engine.load({ key: 'a', uri: 'a.mp3' }, null, 0, false);
    status({});
    engine.unload();
    // With no track, a status is the old track's: dropped.
    status({ currentTime: 150 });
    mockFake.listeners.get('playlistStatusUpdate')?.({ currentIndex: 0, currentTime: 199, isLoaded: true, isBuffering: false, playing: false, duration: 200, didJustFinish: true });
    await engine.load({ key: 'b', uri: 'b.mp3' }, null, 0, false);
    // The old track's finish, sent after the list was emptied (a finish is never the new track's): dropped.
    mockFake.listeners.get('playlistStatusUpdate')?.({ currentIndex: 0, currentTime: 199, isLoaded: true, isBuffering: false, playing: false, duration: 200, didJustFinish: true });
    status({});
    const drops = diagEntries().filter((e) => e.event.startsWith('status-drop'));
    expect(drops.map((e) => e.event)).toEqual(['status-drop', 'status-drop-end']);
    expect(drops[0]?.data).toMatchObject({ why: 'no-track', time: 150 });
    expect(drops[1]?.data).toEqual({ count: 3 });
  });
});
