/**
 * The desktop engine: libmpv in the Tauri app (`desktop/`). libmpv opens the
 * original file from the server (MKV, HEVC, AV1, DTS, ASS and PGS
 * subtitles), draws the video under the web page and switches tracks inside
 * the file. The player screen draws the controls over the video.
 */
import { desktopWindow, localPath, mpv, type MpvEvent, type MpvTrack, nowPlaying, type NowPlayingInfo, type RemoteCommand } from '@/platform/desktop';

import { bufferInputOf, mpvBufferOptions } from './buffer-ahead';
import { fromMpv } from './embedded-tracks';
import { type EngineEvent, type EngineListener, type EngineSource, type EngineSubtitle, sourceHeaders, type VideoEngine } from './engine-types';
import { PositionLine } from './position-line';

/** What Now Playing shows for the current state; null when nothing plays. */
export function nowPlayingInfo(
  meta: { title: string; subtitle?: string; artworkUri?: string } | null,
  state: { duration: number; position: number; paused: boolean; rate: number },
): NowPlayingInfo | null {
  if (!meta) return null;
  return {
    title: meta.title,
    subtitle: meta.subtitle,
    // Only http(s) artwork: Rust loads it; local files are not reachable by URL there.
    artworkUrl: meta.artworkUri && /^https?:\/\//.test(meta.artworkUri) ? meta.artworkUri : undefined,
    duration: state.duration,
    position: state.position,
    playing: !state.paused,
    rate: state.rate,
  };
}

/** The libmpv track for a Jellyfin stream index: the same stream index in the file, else the same position. */
export function trackFor(tracks: readonly MpvTrack[], type: 'audio' | 'sub', index: number, ordinal: number): MpvTrack | null {
  const ofType = tracks.filter((t) => t.type === type && !t.external);
  return ofType.find((t) => t.ffIndex === index) ?? ofType[ordinal] ?? null;
}

/** After a seek, old positions are left out for this long at most, ms (a lost `playback-restart` does not freeze the position). */
const SEEK_GUARD = 1500;

export class MpvEngine implements VideoEngine {
  readonly pipSupported = false;
  private listeners = new Set<EngineListener>();
  /** One libmpv call at a time, in order. */
  private chain: Promise<unknown> = Promise.resolve();
  private pos = 0;
  /**
   * The position while the video plays: libmpv reports it late, by a
   * different time each time (see position-line.ts). A real wait for data
   * comes as `paused-for-cache`.
   */
  private line = new PositionLine();
  /** True while the video waits: a seek, or the cache. */
  private seeking = false;
  /** Seeks that libmpv has not finished yet (queued, or sent and with no `playback-restart`). */
  private seeksOpen = 0;
  /** When the last seek reached libmpv (performance.now), for the guard below. */
  private seekSentAt = 0;
  /** The last position left out while a seek was open (libmpv sends one just before `playback-restart`). */
  private heldPos: number | null = null;
  private stalled = false;
  private cacheEnd = 0;
  /** A file is loading or loaded (libmpv also reports properties while idle). */
  private active = false;
  private loaded = false;
  /** libmpv's `pause` property, kept also while idle (it only reports changes). */
  private paused = false;
  private tracksNow: MpvTrack[] = [];
  /** Jellyfin indexes of the embedded audio and subtitle streams, in file order. */
  private audioOrder: number[] = [];
  private subOrder: number[] = [];
  private pendingAudio: number | null = null;
  private pendingSub: EngineSubtitle | null | undefined = undefined;
  /** External subtitle URLs already added to this file, with their libmpv track id. */
  private added = new Map<string, number>();
  /** Now Playing: the loaded item, its length and speed. */
  private meta: { title: string; subtitle?: string; artworkUri?: string } | null = null;
  private duration = 0;
  private rate = 1;

  constructor() {
    mpv.subscribe(this.onEvent);
    nowPlaying.onRemote(this.onRemote);
  }

  /** Sends the state to Now Playing (on load, play, pause, seek, speed and length changes). */
  private publish() {
    const info = nowPlayingInfo(this.active ? this.meta : null, { duration: this.duration, position: this.pos, paused: this.paused, rate: this.rate });
    void (info ? nowPlaying.update(info) : nowPlaying.clear()).catch(() => undefined);
  }

  private onRemote = (c: RemoteCommand) => {
    if (!this.active) return;
    switch (c.command) {
      case 'play':
        this.play();
        break;
      case 'pause':
        this.pause();
        break;
      case 'toggle':
        if (this.paused) this.play();
        else this.pause();
        break;
      case 'skip':
        this.seekTo(this.pos + c.seconds);
        break;
      case 'seek':
        this.seekTo(c.position);
        break;
      case 'next':
      case 'previous':
        this.emit({ type: 'remote', command: c.command });
        break;
    }
  };

  private emit(e: EngineEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private run(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).catch((e: unknown) => console.warn('[mpv]', e));
  }

  private onEvent = (e: MpvEvent) => {
    switch (e.type) {
      case 'prop':
        this.onProp(e.name, e.value);
        break;
      case 'tracks':
        this.tracksNow = e.tracks;
        // libmpv lists the tracks of any file or stream (IPTV uses them; Jellyfin items use `tracks`).
        if (this.active) this.emit({ type: 'embedded', tracks: fromMpv(e.tracks) });
        break;
      case 'playback-restart': {
        this.seeking = false;
        this.seeksOpen = Math.max(0, this.seeksOpen - 1);
        // The position libmpv sent with the restart (it came while the seek was still open).
        const held = this.heldPos;
        this.heldPos = null;
        if (this.seeksOpen === 0 && held !== null) this.onProp('time-pos', held);
        // After a seek: Now Playing moves its time from the new position.
        if (this.active) this.publish();
        break;
      }
      case 'file-loaded':
        this.loaded = true;
        this.applyPendingTracks();
        this.publish();
        this.emit({ type: 'status', status: 'ready' });
        this.emit({ type: 'playing', playing: !this.paused });
        break;
      case 'end-file':
        if (!this.active) break;
        if (e.reason === 'eof') {
          this.active = false;
          this.publish();
          this.emit({ type: 'ended' });
        } else if (e.reason === 'error') {
          this.active = false;
          this.publish();
          this.emit({ type: 'status', status: 'error', error: e.error ? `The video could not be played (${e.error}).` : 'The video could not be played.' });
        }
        break;
    }
  };

  private onProp(name: string, value: number | boolean | string | null) {
    if (name === 'pause' && typeof value === 'boolean') {
      this.paused = value;
      this.line.reset();
    }
    if (!this.active) return;
    switch (name) {
      case 'time-pos':
        // A position from before a seek that libmpv has not finished: the
        // seek target stays. (A report that left libmpv before the seek can
        // come after it, and it once moved a seek back.)
        if (this.seeksOpen > 0 && performance.now() - this.seekSentAt < SEEK_GUARD) {
          if (typeof value === 'number') this.heldPos = value;
          break;
        }
        if (typeof value === 'number') {
          this.pos = value;
          if (this.paused || this.seeking || this.stalled) this.line.reset();
          this.line.report(value, performance.now());
          this.emit({ type: 'time', position: value, buffered: Math.max(value, this.cacheEnd) });
        }
        break;
      case 'demuxer-cache-time':
        if (typeof value === 'number') this.cacheEnd = value;
        break;
      case 'duration':
        if (typeof value === 'number' && value > 0) {
          this.duration = value;
          this.publish();
          this.emit({ type: 'duration', duration: value });
        }
        break;
      case 'pause':
        if (typeof value === 'boolean') {
          this.publish();
          this.emit({ type: 'playing', playing: !value });
        }
        break;
      case 'seeking':
        if (typeof value === 'boolean') {
          this.seeking = value;
          this.line.reset();
        }
        break;
      case 'paused-for-cache':
        if (typeof value === 'boolean') {
          this.stalled = value;
          this.line.reset();
        }
        if (this.loaded && typeof value === 'boolean') this.emit({ type: 'status', status: value ? 'loading' : 'ready' });
        break;
      case 'speed':
        if (typeof value === 'number') {
          // Keep the position now, then move on at the new rate.
          this.line.rerate(performance.now(), this.rate);
          this.rate = value;
          this.publish();
          this.emit({ type: 'rate', rate: value });
        }
        break;
      case 'mute':
        if (typeof value === 'boolean') this.emit({ type: 'muted', muted: value });
        break;
      case 'video-codec':
      case 'hwdec-current':
        if (__DEV__ && value) console.log(`[mpv] ${name}: ${String(value)}`);
        break;
    }
  }

  /**
   * The position now. libmpv sends `time-pos` at most four times a second
   * (see mpv/player.rs), so the last value is up to 250 ms old: while the
   * video plays, it moves on by the time since it came. Watch together
   * compares positions to the millisecond.
   */
  get position(): number {
    if (!this.active || !this.loaded || this.paused || this.seeking || this.stalled) return this.pos;
    return this.line.at(performance.now(), this.rate) ?? this.pos;
  }

  load(source: EngineSource): void {
    const start = source.startSeconds > 0.5 ? source.startSeconds : 0;
    this.active = true;
    this.loaded = false;
    this.pos = start;
    this.line.reset();
    this.seeking = false;
    this.seeksOpen = 0;
    this.heldPos = null;
    this.stalled = false;
    this.cacheEnd = 0;
    this.tracksNow = [];
    this.added.clear();
    this.audioOrder = source.streams?.audio ?? [];
    this.subOrder = source.streams?.subtitles ?? [];
    this.pendingAudio = source.audioIndex ?? null;
    this.pendingSub = undefined;
    this.meta = { title: source.title, subtitle: source.subtitle, artworkUri: source.artworkUri };
    this.duration = 0;
    this.emit({ type: 'status', status: 'loading' });
    const paused = source.autoplay === false;
    this.run(async () => {
      await mpv.set('pause', paused);
      await mpv.set('force-media-title', source.title);
      // An IPTV provider can ask for its own user agent; everything else gets libmpv's default.
      const headers = sourceHeaders(source);
      const ua = Object.entries(headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1];
      await mpv.set('user-agent', ua || 'libmpv');
      // An extension's headers: set (or cleared) on every load, so they never reach the next stream.
      await mpv.set('http-header-fields', mpvHeaderFields(headers));
      // Subtitles stay off until the session picks one; audio follows the plan.
      // A download plays from its file on the disk.
      // A stream from a nearby host reads less ahead: every guest shares the host's upload.
      // "Load the whole video ahead" raises the cache for this file only (buffer-ahead.ts).
      const ahead = mpvBufferOptions(bufferInputOf(source));
      await mpv.command('loadfile', localPath(source.uri), 'replace', '-1', `start=${start.toFixed(3)},sid=no${ahead}`);
    });
  }

  unload(): void {
    if (!this.active && !this.loaded) return;
    this.active = false;
    this.loaded = false;
    this.pos = 0;
    this.meta = null;
    this.publish();
    this.run(() => mpv.command('stop'));
  }

  play(): void {
    this.run(() => mpv.set('pause', false));
  }

  pause(): void {
    this.run(() => mpv.set('pause', true));
  }

  seekTo(seconds: number): void {
    // The target now: the call waits in the chain, and `pos` can change before it goes.
    const target = Math.max(0, seconds);
    this.pos = target;
    this.seeking = true;
    this.line.reset();
    this.seeksOpen += 1;
    this.seekSentAt = performance.now();
    this.run(async () => {
      this.seekSentAt = performance.now();
      try {
        await mpv.command('seek', target.toFixed(3), 'absolute');
      } catch (e) {
        this.seeksOpen = Math.max(0, this.seeksOpen - 1);
        throw e;
      }
    });
  }

  setRate(rate: number): void {
    this.run(() => mpv.set('speed', rate));
  }

  setMuted(muted: boolean): void {
    this.run(() => mpv.set('mute', muted));
  }

  startPip(): void {
    // libmpv has no Picture in Picture here.
  }

  toggleFullscreen(): void {
    void desktopWindow.toggleFullscreen().catch(() => undefined);
  }

  readonly tracks = {
    selectAudio: (index: number) => {
      this.pendingAudio = index;
      if (this.loaded) this.applyPendingTracks();
    },
    selectSubtitle: (subtitle: EngineSubtitle | null) => {
      this.pendingSub = subtitle;
      if (this.loaded) this.applyPendingTracks();
    },
  };

  /** Switches by libmpv's own track ids (from `fromMpv`). */
  readonly embedded = {
    selectAudio: (id: string) => {
      const n = Number(id);
      if (Number.isInteger(n)) this.run(() => mpv.set('aid', n));
    },
    selectSubtitle: (id: string | null) => {
      const n = id === null ? null : Number(id);
      if (n === null) this.run(() => mpv.set('sid', 'no'));
      else if (Number.isInteger(n)) this.run(() => mpv.set('sid', n));
    },
  };

  private applyPendingTracks(): void {
    const audio = this.pendingAudio;
    if (audio !== null) {
      this.pendingAudio = null;
      const track = trackFor(this.tracksNow, 'audio', audio, this.audioOrder.indexOf(audio));
      if (track?.id != null) {
        const id = track.id;
        this.run(() => mpv.set('aid', id));
      }
    }
    const sub = this.pendingSub;
    if (sub === undefined) return;
    this.pendingSub = undefined;
    if (sub === null) {
      this.run(() => mpv.set('sid', 'no'));
      return;
    }
    if (sub.url) {
      const known = this.added.get(sub.url);
      if (known !== undefined) {
        this.run(() => mpv.set('sid', known));
        return;
      }
      const url = sub.url;
      this.run(async () => {
        await mpv.command('sub-add', localPath(url), 'select', sub.label, sub.language ?? '');
        const id = Number(await mpv.get('sid'));
        if (Number.isFinite(id)) this.added.set(url, id);
      });
      return;
    }
    const track = trackFor(this.tracksNow, 'sub', sub.index, this.subOrder.indexOf(sub.index));
    if (track?.id != null) {
      const id = track.id;
      this.run(() => mpv.set('sid', id));
    }
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * The headers as libmpv's `http-header-fields` list (`Name: value,…`), with
 * no User-Agent (its own option). A value with a comma is left out: the
 * list has no escape for one.
 */
export function mpvHeaderFields(headers: Record<string, string>): string {
  return Object.entries(headers)
    .filter(([k, v]) => k.toLowerCase() !== 'user-agent' && !v.includes(','))
    .map(([k, v]) => `${k}: ${v}`)
    .join(',');
}
