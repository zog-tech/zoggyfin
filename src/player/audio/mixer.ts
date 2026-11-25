/**
 * The audio engine the session drives: two decks and the crossfade between
 * them. A deck is one native playlist (`engine.ts`). One deck is active: the
 * session's play, pause, seek, position and lock screen go to it.
 *
 * The song after the current one is in one of two places:
 * - in the active deck's playlist, for a change with no gap (the same album,
 *   crossfade off). The native player moves on by itself.
 * - on the other deck, loaded and paused ("cued"), for a crossfade. At
 *   `startOverlap` that deck starts and becomes the active one, and the old
 *   deck plays its last seconds as the "tail". The volumes cross with equal
 *   power (`crossfade.ts`).
 *
 * The other deck is idle, cued or the tail: one union, `Other`. Rules:
 * - Only the active deck's status, track and end reach the session.
 * - Pause, seek, load, next and unload end an overlap at once: the tail stops.
 * - The active deck ends while a song is cued (the overlap never started):
 *   the cued song starts, so the queue does not stop.
 * - A cued song that fails goes back to the active deck's playlist.
 * - The second deck is made only when a crossfade first needs it.
 *
 * No native imports: the decks come from a factory, so it is unit-tested
 * with fake decks.
 */
import { overlapGains } from './crossfade';
import type { AudioEngineEvent, AudioEngineListener, EngineTrack, LockScreenControls, LockScreenInfo } from './engine';

/** What the mixer needs from a deck (`AudioEngine`). */
export interface Deck {
  subscribe(l: AudioEngineListener): () => void;
  readonly loaded: boolean;
  readonly position: number;
  readonly duration: number;
  livePosition(): number;
  readonly currentKey: string | null;
  readonly nextKey: string | null;
  load(current: EngineTrack, next: EngineTrack | null, startSeconds: number, autoplay: boolean): Promise<void>;
  setNext(next: EngineTrack | null): void;
  next(): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setLockScreen(info: LockScreenInfo, controls: LockScreenControls): void;
  dropLockScreen(): void;
  release(): void;
  unload(): void;
  resetAudioMode(): void;
}

type Other =
  | { kind: 'idle' }
  /** `track` is loaded on the other deck and waits for the overlap. */
  | { kind: 'cued'; track: EngineTrack }
  /** The other deck plays the end of the last song. `then` is cued when it has gone. */
  | { kind: 'tail'; startedAt: number; ms: number; then: EngineTrack | null };

const IDLE: Other = { kind: 'idle' };
/** The volume step of an overlap. */
const STEP_MS = 50;
/** An overlap is never shorter than this, so a late start still sounds like a fade. */
const MIN_OVERLAP_S = 0.5;

export interface MixerClock {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

const realClock: MixerClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

export class AudioMixer {
  private active: Deck;
  private spare: Deck | null = null;
  private other: Other = IDLE;
  private listeners = new Set<AudioEngineListener>();
  private master = 1;
  private rate = 1;
  private stopSteps: (() => void) | null = null;

  constructor(
    private makeDeck: () => Deck,
    private clock: MixerClock = realClock,
  ) {
    this.active = this.adopt(makeDeck());
  }

  private adopt(deck: Deck): Deck {
    deck.subscribe((e) => this.onDeck(deck, e));
    return deck;
  }

  private spareDeck(): Deck {
    if (!this.spare) {
      this.spare = this.adopt(this.makeDeck());
      if (this.rate !== 1) this.spare.setRate(this.rate);
    }
    return this.spare;
  }

  subscribe(l: AudioEngineListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: AudioEngineEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private onDeck(deck: Deck, e: AudioEngineEvent) {
    // The lock screen's next and previous: from the deck that owns it.
    if (e.type === 'remote') {
      this.emit(e);
      return;
    }
    if (deck === this.active) {
      // The overlap did not start (the length was not known): go on with the cued song.
      if (e.type === 'ended' && this.other.kind === 'cued') this.startCued();
      else this.emit(e);
      return;
    }
    if (this.other.kind === 'tail' && (e.type === 'ended' || e.type === 'error')) this.endOverlap();
    else if (this.other.kind === 'cued' && e.type === 'error') {
      // The cued song did not load: the active deck's playlist tries it, and reports a failure.
      const track = this.other.track;
      this.dropCue();
      this.active.setNext(track);
    }
  }

  // ---- The active deck -----------------------------------------------------------

  get loaded(): boolean {
    return this.active.loaded;
  }

  get position(): number {
    return this.active.position;
  }

  get duration(): number {
    return this.active.duration;
  }

  livePosition(): number {
    return this.active.livePosition();
  }

  get currentKey(): string | null {
    return this.active.currentKey;
  }

  /** The key that plays after the current one: the cued song, or the next in the active playlist. */
  get nextKey(): string | null {
    return this.other.kind === 'cued' ? this.other.track.key : this.active.nextKey;
  }

  /** The key of the song that waits for an overlap, if any. */
  get cuedKey(): string | null {
    return this.other.kind === 'cued' ? this.other.track.key : null;
  }

  /** Replaces what plays. The next track goes into the active playlist; `setNext` can cue it later. */
  async load(current: EngineTrack, next: EngineTrack | null, startSeconds: number, autoplay: boolean): Promise<void> {
    this.endOverlap();
    this.dropCue();
    await this.active.load(current, next, startSeconds, autoplay);
  }

  /**
   * Sets the track after the current one (or none). With `overlap`, it waits
   * on the other deck for a crossfade; else it joins the active playlist.
   */
  setNext(next: EngineTrack | null, overlap = false): void {
    if (!next || !overlap) {
      if (this.other.kind === 'cued') this.dropCue();
      else if (this.other.kind === 'tail') this.other = { ...this.other, then: null };
      this.active.setNext(next);
      return;
    }
    this.active.setNext(null);
    if (this.other.kind === 'cued' && this.other.track.key === next.key) return;
    if (this.other.kind === 'tail') {
      this.other = { ...this.other, then: next };
      return;
    }
    this.cue(next);
  }

  private cue(track: EngineTrack) {
    const deck = this.spareDeck();
    this.other = { kind: 'cued', track };
    deck.setVolume(0);
    void deck.load(track, null, track.offset ?? 0, false).catch(() => {
      if (this.other.kind !== 'cued' || this.other.track !== track) return;
      this.dropCue();
      this.active.setNext(track);
    });
  }

  private dropCue() {
    if (this.other.kind !== 'cued') return;
    this.other = IDLE;
    this.spare?.release();
  }

  /**
   * Starts the cued song over the end of the current one. `seconds` is the
   * wanted length; the time the current song has left is the limit. False
   * when no song is cued (the caller fades the old way).
   */
  startOverlap(seconds: number): boolean {
    if (this.other.kind !== 'cued' || !this.spare) return false;
    const old = this.active;
    const left = old.duration > 0 ? old.duration - old.livePosition() : seconds;
    const length = Math.max(MIN_OVERLAP_S, Math.min(seconds, left));
    const key = this.other.track.key;
    this.swap();
    this.other = { kind: 'tail', startedAt: this.clock.now(), ms: length * 1000, then: null };
    this.step();
    this.active.play();
    this.stopSteps = this.clock.every(STEP_MS, () => this.step());
    this.emit({ type: 'track', key, previousKey: old.currentKey, at: Date.now(), overlap: true });
    return true;
  }

  /** Makes the other deck the active one. The old deck gives up the lock screen. */
  private swap() {
    const old = this.active;
    if (!this.spare) return;
    this.active = this.spare;
    this.spare = old;
    old.dropLockScreen();
  }

  /** One volume step of the overlap; ends it when its time is over. */
  private step() {
    if (this.other.kind !== 'tail') return;
    const x = (this.clock.now() - this.other.startedAt) / this.other.ms;
    if (x >= 1) {
      this.endOverlap();
      return;
    }
    const g = overlapGains(x);
    this.active.setVolume(this.master * g.into);
    this.spare?.setVolume(this.master * g.out);
  }

  /** Stops the tail now. The active deck gets the full volume, and a waiting song is cued. */
  private endOverlap() {
    if (this.other.kind !== 'tail') return;
    const then = this.other.then;
    this.stopSteps?.();
    this.stopSteps = null;
    this.other = IDLE;
    this.spare?.release();
    this.active.setVolume(this.master);
    if (then) this.cue(then);
  }

  /** The cued song starts now with no overlap (Next, or the current song ended). */
  private startCued() {
    if (this.other.kind !== 'cued') return;
    const key = this.other.track.key;
    const old = this.active;
    const previousKey = old.currentKey;
    this.swap();
    this.other = IDLE;
    old.release();
    this.active.setVolume(this.master);
    this.active.play();
    this.emit({ type: 'track', key, previousKey, at: Date.now() });
  }

  /** Moves to the next track that is ready: the cued song, or the next in the active playlist. */
  next(): void {
    this.endOverlap();
    if (this.other.kind === 'cued') this.startCued();
    else this.active.next();
  }

  play(): void {
    this.active.play();
  }

  pause(): void {
    this.endOverlap();
    this.active.pause();
  }

  seekTo(seconds: number): void {
    this.endOverlap();
    this.active.seekTo(seconds);
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.active.setRate(rate);
    this.spare?.setRate(rate);
  }

  /** The volume of what plays (0 to 1). During an overlap it is shared between the two decks. */
  setVolume(volume: number): void {
    this.master = Math.max(0, Math.min(1, volume));
    if (this.other.kind === 'tail') this.step();
    else this.active.setVolume(this.master);
  }

  setLockScreen(info: LockScreenInfo, controls: LockScreenControls): void {
    this.active.setLockScreen(info, controls);
  }

  unload(): void {
    this.endOverlap();
    this.dropCue();
    this.active.unload();
  }

  resetAudioMode(): void {
    this.active.resetAudioMode();
    this.spare?.resetAudioMode();
  }
}
