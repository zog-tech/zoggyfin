/**
 * The audio engine: one expo-audio `AudioPlaylist` for the app's life. On
 * iOS it is an AVQueuePlayer, which preloads the next item and plays it
 * without a gap; on the web it is an HTML audio element with the next one
 * preloaded. Both handle the lock screen / Media Session, interruptions
 * (calls, Siri) and route changes (pause when headphones are unplugged).
 *
 * The queue lives in JavaScript (queue.ts). The native playlist only holds
 * a window: what has played since the last load, the current track and the
 * one after it. Inserting before the current item would make expo-audio
 * rebuild the playlist and restart the current track, so the engine only
 * appends and only removes items after the current one.
 */
import { type AudioPlaylist, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

export interface EngineTrack {
  /** The queue entry key. */
  key: string;
  uri: string;
  /**
   * Where the stream starts in the track, in seconds. A server transcode
   * started with `StartTimeTicks` begins at that point, so its own time 0 is
   * this position. The engine adds it to every position it reports and
   * takes it off every seek.
   */
  offset?: number;
}

export interface LockScreenInfo {
  title: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
}

/** `tracks` shows next/previous on the lock screen; `seek` shows skip back/forward (long-form). */
export type LockScreenControls = 'tracks' | 'seek';

export type AudioEngineEvent =
  | { type: 'status'; position: number; duration: number; playing: boolean; buffering: boolean; loaded: boolean }
  /** The playlist moved to another track by itself (end of a track, lock screen, headset). */
  | { type: 'track'; key: string; previousKey: string | null; at: number }
  /** The last track ended and nothing follows. */
  | { type: 'ended' }
  | { type: 'error'; message: string };

export type AudioEngineListener = (e: AudioEngineEvent) => void;

export class AudioEngine {
  private playlist: AudioPlaylist | null = null;
  private keys: string[] = [];
  /** The `offset` of each entry in `keys`. */
  private offsets: number[] = [];
  private listeners = new Set<AudioEngineListener>();
  private pendingStart: number | null = null;
  private pendingPlay = false;
  private lastIndex = 0;
  private lastPosition = 0;
  private lastDuration = 0;
  private lockControls: LockScreenControls | null = null;
  private modeSet = false;
  private rate = 1;
  /** When the last status came (ms, performance clock), and whether it played. */
  private statusAt = 0;
  private statusPlaying = false;
  /** Ignore status from before a load (the native side can deliver late events). */
  private loading = false;
  /** One per load and unload: the start seek of an older load must not play the new one. */
  private loadToken = 0;

  /** The last web status: its track and time (see `webFix`). */
  private webLast: { index: number; time: number } | null = null;

  /**
   * expo-audio's web playlist (58.0.x) leaves `isLoaded` false and
   * `isBuffering` true after it moves to the preloaded next track: that
   * element's load events came while it preloaded. On the web, a time that
   * moves on the same track means the track is loaded and plays.
   */
  private webFix<T extends { currentIndex?: number; currentTime: number; isLoaded: boolean; isBuffering: boolean; playing: boolean; duration: number }>(s: T): T {
    if (Platform.OS !== 'web') return s;
    const index = s.currentIndex ?? 0;
    const last = this.webLast;
    this.webLast = { index, time: s.currentTime };
    const moved = !!last && last.index === index && s.playing && Math.abs(s.currentTime - last.time) > 0.001;
    if (!moved) return s.duration > 0 && !s.isLoaded ? { ...s, isLoaded: true } : s;
    return { ...s, isLoaded: true, isBuffering: false };
  }

  subscribe(l: AudioEngineListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: AudioEngineEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private ensure(): AudioPlaylist {
    if (this.playlist) return this.playlist;
    const p = createAudioPlaylist({ sources: [], updateInterval: 500, loop: 'none' });
    p.addListener('playlistStatusUpdate', (raw) => {
      const s = this.webFix(raw);
      const index = s.currentIndex ?? 0;
      const offset = this.offsets[index] ?? 0;
      if (this.pendingStart !== null && s.isLoaded && index === 0) {
        const start = this.pendingStart;
        const token = this.loadToken;
        this.pendingStart = null;
        void p.seekTo(start).finally(() => {
          if (token !== this.loadToken) return;
          if (this.pendingPlay) this.playNow(p);
          this.pendingPlay = false;
        });
      }
      // Until the new track is ready (and has seeked to its start), keep reporting the start position.
      if (this.loading && s.isLoaded && this.pendingStart === null) this.loading = false;
      this.lastIndex = index;
      if (!this.loading && s.currentTime >= 0) {
        this.lastPosition = s.currentTime + offset;
        this.statusAt = nowMs();
        this.statusPlaying = s.playing && !s.isBuffering;
      }
      // A progressive transcode can report an infinite or partial length: only a finite one counts.
      const duration = s.duration > 0 && Number.isFinite(s.duration) ? s.duration + offset : 0;
      if (duration > 0) this.lastDuration = duration;
      this.emit({
        type: 'status',
        position: this.lastPosition,
        duration,
        playing: s.playing,
        buffering: s.isBuffering,
        loaded: s.isLoaded,
      });
      if (s.didJustFinish && index >= this.keys.length - 1) this.emit({ type: 'ended' });
    });
    p.addListener('trackChanged', ({ previousIndex, currentIndex }) => {
      const key = this.keys[currentIndex];
      if (!key) return;
      this.lastIndex = currentIndex;
      this.emit({ type: 'track', key, previousKey: this.keys[previousIndex] ?? null, at: Date.now() });
    });
    this.playlist = p;
    return p;
  }

  private async audioMode() {
    if (this.modeSet) return;
    this.modeSet = true;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
        allowsRecording: false,
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      this.modeSet = false;
    }
  }

  /** The video player sets its own audio session; set ours again before the next load. */
  resetAudioMode(): void {
    this.modeSet = false;
  }

  get loaded(): boolean {
    return this.playlist !== null && this.keys.length > 0;
  }

  get position(): number {
    return this.lastPosition;
  }

  get duration(): number {
    return this.lastDuration;
  }

  /**
   * The position now: the last status (it comes every 500 ms) moved on by the
   * time since it came, while the player plays. Watch and listen together
   * compare positions to the millisecond, so the status alone is too old.
   */
  livePosition(): number {
    if (!this.statusPlaying || this.loading) return this.lastPosition;
    const moved = ((nowMs() - this.statusAt) / 1000) * this.rate;
    return this.lastPosition + Math.min(Math.max(0, moved), 1);
  }

  get currentKey(): string | null {
    return this.keys[this.lastIndex] ?? null;
  }

  /** The key the playlist plays after the current one, if any. */
  get nextKey(): string | null {
    return this.keys[this.lastIndex + 1] ?? null;
  }

  /** Replaces what plays: the current track (from `startSeconds`) and the one after it. */
  async load(current: EngineTrack, next: EngineTrack | null, startSeconds: number, autoplay: boolean): Promise<void> {
    await this.audioMode();
    const p = this.ensure();
    this.loadToken += 1;
    this.loading = true;
    p.pause();
    p.clear();
    this.keys = [];
    this.offsets = [];
    this.lastIndex = 0;
    this.lastPosition = startSeconds;
    this.lastDuration = 0;
    p.add({ uri: current.uri });
    this.keys.push(current.key);
    this.offsets.push(current.offset ?? 0);
    if (next) {
      p.add({ uri: next.uri });
      this.keys.push(next.key);
      this.offsets.push(next.offset ?? 0);
    }
    if (this.rate !== 1) p.playbackRate = this.rate;
    // The start inside the stream: a transcode that starts at `startSeconds` needs no seek.
    const local = startSeconds - (current.offset ?? 0);
    if (local > 0.5) {
      this.pendingStart = local;
      this.pendingPlay = autoplay;
    } else {
      this.pendingStart = null;
      this.pendingPlay = false;
      if (autoplay) this.playNow(p);
    }
  }

  /** Sets the track after the current one (or none) without touching the current one. */
  setNext(next: EngineTrack | null): void {
    const p = this.playlist;
    if (!p || !this.keys.length) return;
    const cur = this.lastIndex;
    if (next && this.keys.length === cur + 2 && this.keys[cur + 1] === next.key) return;
    if (!next && this.keys.length === cur + 1) return;
    for (let i = this.keys.length - 1; i > cur; i--) {
      p.remove(i);
      this.keys.pop();
      this.offsets.pop();
    }
    if (next) {
      p.add({ uri: next.uri });
      this.keys.push(next.key);
      this.offsets.push(next.offset ?? 0);
    }
  }

  /** Moves to the preloaded next track (gapless path). */
  next(): void {
    this.playlist?.next();
  }

  play(): void {
    if (this.pendingStart !== null) {
      this.pendingPlay = true;
      return;
    }
    if (this.playlist) this.playNow(this.playlist);
  }

  /** Plays, then sets the rate again: on iOS, play() puts the rate back to 1. */
  private playNow(p: AudioPlaylist): void {
    p.play();
    if (this.rate !== 1) p.playbackRate = this.rate;
  }

  pause(): void {
    this.lastPosition = this.livePosition();
    this.statusPlaying = false;
    this.pendingPlay = false;
    this.playlist?.pause();
  }

  seekTo(seconds: number): void {
    const p = this.playlist;
    if (!p) return;
    const s = Math.max(0, seconds);
    const local = Math.max(0, s - (this.offsets[this.lastIndex] ?? 0));
    if (this.pendingStart !== null) {
      this.pendingStart = local;
      return;
    }
    this.lastPosition = s;
    this.statusAt = nowMs();
    void p.seekTo(local);
  }

  setRate(rate: number): void {
    // Keep the live position right across the change.
    this.lastPosition = this.livePosition();
    this.statusAt = nowMs();
    this.rate = rate;
    if (this.playlist) this.playlist.playbackRate = rate;
  }

  setVolume(volume: number): void {
    if (this.playlist) this.playlist.volume = Math.max(0, Math.min(1, volume));
  }

  setLockScreen(info: LockScreenInfo, controls: LockScreenControls): void {
    const p = this.playlist;
    if (!p) return;
    const meta = { title: info.title, artist: info.artist, albumTitle: info.albumTitle, artworkUrl: info.artworkUrl };
    if (this.lockControls !== controls) {
      this.lockControls = controls;
      p.setActiveForLockScreen(true, meta, {
        showNextTrack: controls === 'tracks',
        showPreviousTrack: controls === 'tracks',
        showSeekForward: controls === 'seek',
        showSeekBackward: controls === 'seek',
      });
    } else {
      p.updateLockScreenMetadata(meta);
    }
  }

  unload(): void {
    const p = this.playlist;
    this.loadToken += 1;
    this.loading = false;
    this.pendingStart = null;
    this.pendingPlay = false;
    this.keys = [];
    this.offsets = [];
    this.lastIndex = 0;
    if (!p) return;
    try {
      p.pause();
      p.clear();
      if (this.lockControls) p.clearLockScreenControls();
    } catch {
      // Already gone.
    }
    this.lockControls = null;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let engine: AudioEngine | null = null;

export function audioEngine(): AudioEngine {
  engine ??= new AudioEngine();
  return engine;
}
