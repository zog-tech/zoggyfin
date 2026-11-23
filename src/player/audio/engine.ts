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
 *
 * On iOS the engine also keeps the audio session alive (`session-phase.ts`):
 * after a pause it did not ask for, it activates the session again before
 * the next play. With the patched expo-audio (`patches/expo-audio@*.patch`),
 * the lock screen next and previous commands come here as events, so the
 * JavaScript queue moves, not only the native window. An older binary has
 * neither the event nor `setRemoteTrackCommands`: it keeps the old behaviour.
 *
 * On iOS and Android the engine also watches each start the app asks for
 * (`start-watch.ts`): a track that comes ready but stays silent (a catalog
 * song after a long first answer) gets its play again.
 */
import { type AudioPlaylist, createAudioPlaylist, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { Platform } from 'react-native';

import { type SessionPhase, resumedByItself, transition } from './session-phase';
import { START_KICK_DELAY_MS, type StartStatus, type StartWatch, startVerdict } from './start-watch';

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
  /** The lock screen (or a headset) asked for the next or previous track. */
  | { type: 'remote'; command: 'next' | 'previous' }
  | { type: 'error'; message: string };

export type AudioEngineListener = (e: AudioEngineEvent) => void;

/** The parts of the patched expo-audio playlist that an older binary does not have. */
interface RemoteTrackPlaylist {
  setRemoteTrackCommands?: (toJs: boolean) => void;
  addListener(name: 'remoteTrackCommand', l: (e: { command?: string }) => void): unknown;
}

/** iOS only: the session handling of the other platforms works as it is. */
const guardSession = Platform.OS === 'ios';
/** Native players only: a browser refuses a play that no tap started, so a second try changes nothing there. */
const watchStarts = Platform.OS !== 'web';

/** How far (s) a status of a track that loads may be from its start, or from 0 before its start seek. */
const STALE_SLACK_S = 3;

/**
 * True for a status that cannot be the track that loads: a finish, the second item of the list, or
 * a position far from both 0 and the start. Such a status is the old track's, sent after the list
 * was emptied.
 */
export function staleStatus(s: { didJustFinish?: boolean; currentIndex?: number; currentTime: number }, start: number, byPosition: boolean): boolean {
  if (s.didJustFinish || (s.currentIndex ?? 0) !== 0) return true;
  // Only ExoPlayer (Android) sends the old track's position after the list was emptied.
  return byPosition && s.currentTime > STALE_SLACK_S && Math.abs(s.currentTime - start) > STALE_SLACK_S;
}

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
  /** The start inside the stream of the track being loaded: its first statuses are near it (or at 0). */
  private loadStart = 0;
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
  /** Whether the session can give sound (`session-phase.ts`). */
  private phase: SessionPhase = 'idle';
  /** Goes up on every play and pause: a play that waits for the session must not run after a pause. */
  private intent = 0;
  /** A start that has given no sound yet (`start-watch.ts`), its last status and the timer of the next try. */
  private start: StartWatch | null = null;
  private startStatus: StartStatus | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  /** The load whose track gave sound: its later plays are not watched, so a pause the app did not ask for is never undone. */
  private soundToken = -1;

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
      // A new load empties the native playlist, and ExoPlayer then sends the last statuses of the
      // old track: loaded at its old position, then finished. They are not about the new track.
      if (this.loading && staleStatus(s, this.loadStart, Platform.OS === 'android')) return;
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
      if (!this.loading && this.pendingStart === null) {
        const st = { playing: s.playing, buffering: s.isBuffering, loaded: s.isLoaded, finished: !!s.didJustFinish && index >= this.keys.length - 1 };
        this.onPhase({ type: 'status', ...st });
        this.watchStart(st);
      }
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
    this.remoteTracks(p);
    if (this.volume !== 1) p.volume = this.volume;
    this.playlist = p;
    return p;
  }

  /** Lock screen next and previous go to the queue in JavaScript (patched expo-audio only). */
  private remoteTracks(p: AudioPlaylist) {
    if (!guardSession) return;
    const r = p as unknown as RemoteTrackPlaylist;
    if (typeof r.setRemoteTrackCommands !== 'function') return;
    try {
      r.addListener('remoteTrackCommand', (e) => {
        if (e?.command === 'next' || e?.command === 'previous') this.emit({ type: 'remote', command: e.command });
      });
      r.setRemoteTrackCommands(true);
    } catch {
      // The native side refused: the lock screen keeps moving the native window.
    }
  }

  private onPhase(e: Parameters<typeof transition>[1]) {
    const prev = this.phase;
    this.phase = transition(prev, e);
    if (!guardSession || !resumedByItself(prev, this.phase)) return;
    // The player plays again without the app (lock screen, headset). The session may still be
    // inactive: activate it, then play once more so the sound starts.
    const token = this.loadToken;
    const intent = this.intent;
    void this.restoreSession().then(() => {
      if (token !== this.loadToken || intent !== this.intent || this.phase !== 'playing') return;
      if (this.playlist) this.playNow(this.playlist);
    });
  }

  /** A status while a start is watched: stop watching once sound came, or play again when the track sits ready and silent. */
  private watchStart(st: StartStatus) {
    if (st.playing && !st.buffering) this.soundToken = this.loadToken;
    const w = this.start;
    if (!w) return;
    this.startStatus = st;
    const verdict = startVerdict(w, st, Date.now());
    if (verdict === 'started' || verdict === 'give-up') {
      this.clearStart();
      return;
    }
    if (verdict === 'wait') {
      this.cancelStartTimer();
      return;
    }
    if (this.startTimer) return;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.kickStart(w);
    }, START_KICK_DELAY_MS);
  }

  /** Plays the watched start again, when it still sits ready and silent and nothing replaced it. */
  private kickStart(w: StartWatch) {
    const p = this.playlist;
    const st = this.startStatus;
    if (!p || !st || this.start !== w || w.token !== this.loadToken) return;
    if (startVerdict(w, st, Date.now()) !== 'kick') return;
    w.kicks += 1;
    if (__DEV__) console.log(`[audio] start stayed silent, play again (${w.kicks})`);
    if (guardSession && this.phase === 'lost') {
      // The player stopped by itself: the session may be inactive, so activate it before the play.
      const intent = this.intent;
      void this.restoreSession().then(() => {
        if (this.start === w && w.token === this.loadToken && intent === this.intent) this.playNow(p);
      });
      return;
    }
    this.playNow(p);
  }

  private cancelStartTimer() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private clearStart() {
    this.cancelStartTimer();
    this.start = null;
    this.startStatus = null;
  }

  /** Sets the audio mode and activates the session again after it was lost. Never throws. */
  private async restoreSession(): Promise<void> {
    this.modeSet = false;
    await this.audioMode();
    try {
      await setIsAudioActiveAsync(true);
    } catch {
      // Another app still holds the audio: the play below tries anyway.
    }
    this.phase = transition(this.phase, { type: 'restored' });
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
    if (guardSession && this.phase === 'lost') await this.restoreSession();
    else await this.audioMode();
    const p = this.ensure();
    this.loadToken += 1;
    this.clearStart();
    this.loading = true;
    p.pause();
    this.phase = transition(this.phase, { type: 'pause' });
    p.clear();
    this.keys = [];
    this.offsets = [];
    this.lastIndex = 0;
    this.lastPosition = startSeconds;
    this.lastDuration = 0;
    this.loadStart = Math.max(0, startSeconds - (current.offset ?? 0));
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
    this.intent += 1;
    if (this.pendingStart !== null) {
      this.pendingPlay = true;
      return;
    }
    const p = this.playlist;
    if (!p) return;
    if (guardSession && this.phase === 'lost') {
      // An interruption (camera, call) left the session inactive: activate it first, or the play is silent.
      const token = this.loadToken;
      const intent = this.intent;
      void this.restoreSession().then(() => {
        if (token === this.loadToken && intent === this.intent) this.playNow(p);
      });
      return;
    }
    this.playNow(p);
  }

  /** Plays, then sets the rate again: on iOS, play() puts the rate back to 1. */
  private playNow(p: AudioPlaylist): void {
    this.phase = transition(this.phase, { type: 'play' });
    // Watch the start until it gives sound (start-watch.ts). A second play of the same start keeps its count.
    if (watchStarts && this.soundToken !== this.loadToken && (!this.start || this.start.token !== this.loadToken)) {
      this.start = { token: this.loadToken, kicks: 0, since: Date.now() };
    }
    p.play();
    if (this.rate !== 1) p.playbackRate = this.rate;
  }

  pause(): void {
    this.intent += 1;
    this.clearStart();
    this.phase = transition(this.phase, { type: 'pause' });
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

  /** The volume of the playlist (0 to 1). It holds for a playlist that is made later too. */
  private volume = 1;

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (!this.playlist) return;
    this.playlist.volume = this.volume;
    // The web playlist gives the preloaded next track the volume of the moment it preloaded, so after
    // a fade-out the next song began at full volume until its fade-in began. Native players have one volume.
    const next = (this.playlist as unknown as { _nextMedia?: { volume: number } | null })._nextMedia;
    if (next && typeof next.volume === 'number') next.volume = this.volume;
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
    this.clearStart();
    this.phase = transition(this.phase, { type: 'pause' });
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
