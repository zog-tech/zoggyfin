/** The two-deck mixer with fake decks and a clock the test moves. */
import type { AudioEngineEvent, AudioEngineListener, EngineTrack } from '../engine';
import { AudioMixer, type Deck, type MixerClock } from '../mixer';

class FakeDeck implements Deck {
  listeners = new Set<AudioEngineListener>();
  keys: string[] = [];
  volume = 1;
  playing = false;
  position = 0;
  duration = 0;
  lockScreen = false;
  calls: string[] = [];

  subscribe(l: AudioEngineListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  send(e: AudioEngineEvent) {
    this.listeners.forEach((l) => l(e));
  }
  get loaded() {
    return this.keys.length > 0;
  }
  livePosition() {
    return this.position;
  }
  get currentKey() {
    return this.keys[0] ?? null;
  }
  get nextKey() {
    return this.keys[1] ?? null;
  }
  async load(current: EngineTrack, next: EngineTrack | null, _start: number, autoplay: boolean) {
    this.keys = next ? [current.key, next.key] : [current.key];
    this.playing = autoplay;
  }
  setNext(next: EngineTrack | null) {
    this.keys = this.keys.slice(0, 1);
    if (next) this.keys.push(next.key);
  }
  next() {
    this.calls.push('next');
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seekTo(s: number) {
    this.position = s;
  }
  setRate() {}
  setVolume(v: number) {
    this.volume = v;
  }
  setLockScreen() {
    this.lockScreen = true;
  }
  dropLockScreen() {
    this.lockScreen = false;
  }
  release() {
    this.calls.push('release');
    this.keys = [];
    this.playing = false;
  }
  unload() {
    this.calls.push('unload');
    this.keys = [];
    this.playing = false;
  }
  resetAudioMode() {}
}

function setup() {
  const decks: FakeDeck[] = [];
  let now = 0;
  let tick: (() => void) | null = null;
  const clock: MixerClock = {
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
  };
  const mixer = new AudioMixer(() => {
    const d = new FakeDeck();
    decks.push(d);
    return d;
  }, clock);
  const events: AudioEngineEvent[] = [];
  mixer.subscribe((e) => events.push(e));
  return {
    mixer,
    decks,
    events,
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    ticking: () => tick !== null,
  };
}

const a: EngineTrack = { key: 'a', uri: 'a.mp3' };
const b: EngineTrack = { key: 'b', uri: 'b.mp3' };
const c: EngineTrack = { key: 'c', uri: 'c.mp3' };

describe('AudioMixer', () => {
  it('keeps one deck when no crossfade is asked for', async () => {
    const t = setup();
    await t.mixer.load(a, b, 0, true);
    t.mixer.setNext(c);
    expect(t.decks).toHaveLength(1);
    expect(t.mixer.nextKey).toBe('c');
    expect(t.mixer.cuedKey).toBeNull();
    t.mixer.next();
    expect(t.decks[0]?.calls).toContain('next');
  });

  it('cues the next song on the second deck, silent and paused', async () => {
    const t = setup();
    await t.mixer.load(a, b, 0, true);
    t.mixer.setNext(b, true);
    expect(t.decks).toHaveLength(2);
    expect(t.decks[0]?.keys).toEqual(['a']);
    expect(t.decks[1]?.keys).toEqual(['b']);
    expect(t.decks[1]?.playing).toBe(false);
    expect(t.mixer.nextKey).toBe('b');
    expect(t.mixer.cuedKey).toBe('b');
    expect(t.mixer.currentKey).toBe('a');
  });

  it('crosses the two volumes with equal power and then frees the old deck', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 200;
    first.position = 194;
    expect(t.mixer.startOverlap(6)).toBe(true);
    // The new song is the current one at once, and it plays from silence.
    expect(t.mixer.currentKey).toBe('b');
    expect(second.playing).toBe(true);
    expect(second.volume).toBeCloseTo(0);
    expect(first.volume).toBeCloseTo(1);
    expect(t.events).toContainEqual(expect.objectContaining({ type: 'track', key: 'b', previousKey: 'a', overlap: true }));
    t.advance(3000);
    expect(first.volume).toBeCloseTo(Math.SQRT1_2);
    expect(second.volume).toBeCloseTo(Math.SQRT1_2);
    t.advance(3000);
    expect(second.volume).toBe(1);
    expect(first.calls).toContain('release');
    expect(t.ticking()).toBe(false);
  });

  it('makes the overlap as long as the old song has left', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 200;
    first.position = 198;
    t.mixer.startOverlap(6);
    t.advance(1000);
    expect(second.volume).toBeCloseTo(Math.SQRT1_2);
  });

  it('shares the master volume between the decks during an overlap', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 100;
    first.position = 96;
    t.mixer.startOverlap(4);
    t.advance(2000);
    t.mixer.setVolume(0.5);
    expect(first.volume).toBeCloseTo(0.5 * Math.SQRT1_2);
    expect(second.volume).toBeCloseTo(0.5 * Math.SQRT1_2);
    t.advance(2000);
    expect(second.volume).toBe(0.5);
  });

  it('does not start an overlap with no cued song', async () => {
    const t = setup();
    await t.mixer.load(a, b, 0, true);
    expect(t.mixer.startOverlap(6)).toBe(false);
    expect(t.events).toHaveLength(0);
  });

  it('passes only the active deck to the listeners', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    second.send({ type: 'status', position: 0, duration: 100, playing: false, buffering: false, loaded: true });
    expect(t.events).toHaveLength(0);
    first.send({ type: 'status', position: 5, duration: 100, playing: true, buffering: false, loaded: true });
    expect(t.events).toHaveLength(1);
    second.send({ type: 'remote', command: 'next' });
    expect(t.events).toHaveLength(2);
  });

  it('ends the overlap when the tail ends early, and on pause', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 100;
    first.position = 94;
    t.mixer.startOverlap(6);
    first.send({ type: 'ended' });
    expect(second.volume).toBe(1);
    expect(first.calls).toContain('release');
    // The tail's end is not the queue's end.
    expect(t.events.some((e) => e.type === 'ended')).toBe(false);

    t.mixer.setNext(c, true);
    second.duration = 100;
    second.position = 95;
    t.mixer.startOverlap(5);
    t.mixer.pause();
    expect(first.playing).toBe(false);
    expect(first.volume).toBe(1);
    expect(second.keys).toEqual([]);
  });

  it('cues the song after the next one once the tail has gone', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 100;
    first.position = 96;
    t.mixer.startOverlap(4);
    t.mixer.setNext(c, true);
    // The old deck still plays the tail.
    expect(first.keys).toEqual(['a']);
    expect(t.mixer.cuedKey).toBeNull();
    t.advance(4000);
    expect(first.keys).toEqual(['c']);
    expect(t.mixer.cuedKey).toBe('c');
  });

  it('starts the cued song when the current one ends before any overlap', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.send({ type: 'ended' });
    expect(second.playing).toBe(true);
    expect(second.volume).toBe(1);
    expect(t.events).toEqual([expect.objectContaining({ type: 'track', key: 'b', previousKey: 'a' })]);
    expect(t.events[0]).not.toHaveProperty('overlap');
  });

  it('starts the cued song at once on Next', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    t.mixer.next();
    expect(t.mixer.currentKey).toBe('b');
    expect(t.decks[0]?.calls).toContain('release');
    expect(t.decks[1]?.playing).toBe(true);
  });

  it('moves a cued song back to the playlist when the crossfade is turned off, or when it fails', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    t.mixer.setNext(b, false);
    expect(t.decks[0]?.keys).toEqual(['a', 'b']);
    expect(t.decks[1]?.keys).toEqual([]);
    expect(t.mixer.cuedKey).toBeNull();

    t.mixer.setNext(b, true);
    t.decks[1]?.send({ type: 'error', message: 'no' });
    expect(t.decks[0]?.keys).toEqual(['a', 'b']);
    expect(t.mixer.cuedKey).toBeNull();
    expect(t.events.some((e) => e.type === 'error')).toBe(false);
  });

  it('gives the lock screen to the deck that plays', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setLockScreen({ title: 'A' }, 'tracks');
    t.mixer.setNext(b, true);
    const [first, second] = t.decks;
    if (!first || !second) throw new Error('two decks');
    first.duration = 100;
    first.position = 95;
    t.mixer.startOverlap(5);
    expect(first.lockScreen).toBe(false);
    t.mixer.setLockScreen({ title: 'B' }, 'tracks');
    expect(second.lockScreen).toBe(true);
  });

  it('drops the cue and the tail on a new load', async () => {
    const t = setup();
    await t.mixer.load(a, null, 0, true);
    t.mixer.setNext(b, true);
    await t.mixer.load(c, null, 0, true);
    expect(t.mixer.cuedKey).toBeNull();
    expect(t.mixer.currentKey).toBe('c');
    expect(t.decks[1]?.keys).toEqual([]);
  });
});
