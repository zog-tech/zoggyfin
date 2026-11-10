/**
 * The web engine: one HTML video element for the app's life. HLS plays
 * natively in Safari and through hls.js elsewhere (expo-video's web player
 * has no HLS support of its own). Works on plain http.
 */
import type HlsJs from 'hls.js';
import { type ComponentRef, useEffect, useRef } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { hasMpv, mpv, showVideoThrough } from '@/platform/desktop';

import { MpvEngine } from './engine-mpv';
import { type ElementTrackLike, fromHls, fromMediaElement } from './embedded-tracks';
import { type EngineListener, type EngineSource, headersForRequest, sourceHeaders, type VideoEngine, type VideoFit } from './engine-types';

type MediaSessionAction = 'play' | 'pause' | 'seekbackward' | 'seekforward' | 'seekto' | 'nexttrack' | 'previoustrack';

/** A media element's AudioTrackList or TextTrackList: Safari has both; Chromium has no AudioTrackList. */
type TrackList = EventTarget & { readonly length: number; [index: number]: ElementTrackLike };

function listOf(list: TrackList | undefined): ElementTrackLike[] {
  const out: ElementTrackLike[] = [];
  for (let i = 0; list && i < list.length; i++) out.push(list[i]);
  return out;
}

/** Text tracks that are subtitles (hls.js also adds metadata and chapter tracks). */
const isSubtitle = (t: ElementTrackLike) => t.kind === 'subtitles' || t.kind === 'captions' || t.kind === 'forced';

class WebEngine implements VideoEngine {
  readonly video: HTMLVideoElement | null;
  private hls: HlsJs | null = null;
  private listeners = new Set<EngineListener>();
  private loadToken = 0;
  /**
   * hls.js picks its own renditions when it parses the playlist (DEFAULT,
   * AUTOSELECT). A choice made before that waits here, then wins.
   */
  private hlsParsed = false;
  private hlsPending: { audio?: number; subtitle?: number } = {};
  /**
   * The subtitle asked for. hls.js reads the subtitle back from the text
   * track modes when it makes its text tracks, and can drop a choice made
   * just before: it is set again then (a few times at most).
   */
  private hlsSubtitle: { index: number; retries: number } | null = null;

  constructor() {
    this.video = typeof document !== 'undefined' ? document.createElement('video') : null;
    const v = this.video;
    if (!v) return;
    v.playsInline = true;
    v.preload = 'auto';
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.backgroundColor = '#000';
    v.style.objectFit = 'contain';
    v.style.display = 'block';
    v.addEventListener('play', () => this.emit({ type: 'playing', playing: true }));
    v.addEventListener('pause', () => this.emit({ type: 'playing', playing: false }));
    v.addEventListener('waiting', () => this.emit({ type: 'status', status: 'loading' }));
    v.addEventListener('playing', () => this.emit({ type: 'status', status: 'ready' }));
    v.addEventListener('canplay', () => this.emit({ type: 'status', status: 'ready' }));
    v.addEventListener('ended', () => this.emit({ type: 'ended' }));
    v.addEventListener('ratechange', () => this.emit({ type: 'rate', rate: v.playbackRate }));
    v.addEventListener('volumechange', () => this.emit({ type: 'muted', muted: v.muted }));
    v.addEventListener('durationchange', () => {
      if (Number.isFinite(v.duration)) this.emit({ type: 'duration', duration: v.duration });
    });
    // The browser knows the size, not the bitrate (hls.js plays one variant from the server).
    v.addEventListener('resize', () =>
      this.emit({ type: 'video', video: v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight, bitrate: null, frameRate: null, codec: null } : null }),
    );
    v.addEventListener('timeupdate', () => this.emit({ type: 'time', position: v.currentTime, buffered: this.buffered() }));
    v.addEventListener('enterpictureinpicture', () => this.emit({ type: 'pip', active: true }));
    v.addEventListener('leavepictureinpicture', () => this.emit({ type: 'pip', active: false }));
    v.addEventListener('error', () => {
      if (!v.getAttribute('src') && !this.hls) return;
      this.emit({ type: 'status', status: 'error', error: v.error?.message || 'The video could not be played.' });
    });
    // The tracks inside a file or a natively played HLS stream (Safari). hls.js reports its own.
    for (const list of [this.audioList(), this.textList()]) {
      for (const type of ['addtrack', 'removetrack', 'change']) list?.addEventListener(type, () => this.emitElementTracks());
    }
  }

  private audioList(): TrackList | undefined {
    return (this.video as unknown as { audioTracks?: TrackList } | null)?.audioTracks;
  }

  private textList(): TrackList | undefined {
    return (this.video as unknown as { textTracks?: TrackList } | null)?.textTracks;
  }

  private emitElementTracks(): void {
    if (this.hls || !this.video?.getAttribute('src')) return;
    this.emit({ type: 'embedded', tracks: fromMediaElement(listOf(this.audioList()), listOf(this.textList())) });
  }

  private emitHlsTracks(): void {
    const h = this.hls;
    if (!h) return;
    this.emit({ type: 'embedded', tracks: fromHls(h.audioTracks, h.audioTrack, h.subtitleTracks, h.subtitleDisplay ? h.subtitleTrack : -1) });
  }

  /**
   * hls.js switches the renditions of the playlist (`EXT-X-MEDIA`) and the
   * browser draws the WebVTT cues. Without hls.js: the element's own lists
   * (Safari: native HLS, MP4). Ids come from `embedded-tracks.ts`.
   */
  readonly embedded = {
    selectAudio: (id: string) => {
      const i = Number(id);
      if (this.hls) {
        if (this.hlsParsed) this.hls.audioTrack = i;
        else this.hlsPending.audio = i;
        return;
      }
      const list = this.audioList();
      if (!list) return;
      for (let k = 0; k < list.length; k++) list[k].enabled = k === i;
      this.emitElementTracks();
    },
    selectSubtitle: (id: string | null) => {
      const i = id === null ? -1 : Number(id);
      if (this.hls) {
        if (!this.hlsParsed) {
          this.hlsPending.subtitle = i;
          return;
        }
        this.setHlsSubtitle(this.hls, i);
        return;
      }
      const list = this.textList();
      if (!list) return;
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        if (isSubtitle(t)) t.mode = k === i ? 'showing' : 'disabled';
      }
      this.emitElementTracks();
    },
  };

  private emit: EngineListener = (e) => this.listeners.forEach((l) => l(e));

  private buffered(): number {
    const v = this.video;
    if (!v) return 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) return v.buffered.end(i);
    }
    return v.currentTime;
  }

  get position(): number {
    return this.video?.currentTime ?? 0;
  }

  get pipSupported(): boolean {
    return typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
  }

  load(source: EngineSource): void {
    const v = this.video;
    if (!v) return;
    const token = ++this.loadToken;
    this.teardownHls();
    this.emit({ type: 'status', status: 'loading' });
    const start = source.startSeconds > 0.5 ? source.startSeconds : 0;
    const begin = () => {
      if (token !== this.loadToken) return;
      if (start) v.currentTime = start;
      if (source.autoplay === false) {
        this.emit({ type: 'status', status: 'ready' });
        return;
      }
      v.play().catch(() => this.emit({ type: 'playing', playing: false }));
    };
    // Chromium also plays HLS itself now, but lists no audio or subtitle renditions
    // (no AudioTrackList): it keeps hls.js. Safari has both and plays HLS natively.
    const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== '' && 'audioTracks' in v;
    // A page cannot set the User-Agent. Other headers (an extension's) go on every
    // hls.js request, so a stream with headers uses hls.js even where Safari plays HLS.
    const headers = webHeaders(source);
    const withHeaders = Object.keys(headers).length > 0;
    if (source.isHls && (!nativeHls || withHeaders)) {
      void import('hls.js').then(({ default: HlsClass }) => {
        if (token !== this.loadToken) return;
        if (!HlsClass.isSupported()) {
          this.emit({ type: 'status', status: 'error', error: 'This browser cannot play streamed video.' });
          return;
        }
        const hls = new HlsClass({
          startPosition: start || -1,
          enableWorker: true,
          lowLatencyMode: false,
          ...(withHeaders
            ? {
                // Only to the stream's origin: segments on another server get no headers.
                xhrSetup: (xhr: XMLHttpRequest, url: string) => {
                  for (const [k, value] of Object.entries(headersForRequest(headers, source.uri, url))) xhr.setRequestHeader(k, value);
                },
                fetchSetup: (context: { url: string }, init: RequestInit) =>
                  new Request(context.url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headersForRequest(headers, source.uri, context.url) } }),
              }
            : null),
        });
        this.hls = hls;
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (data.fatal) this.emit({ type: 'status', status: 'error', error: `Stream error: ${data.details}` });
        });
        const tracks = () => {
          if (this.hls === hls) this.emitHlsTracks();
        };
        hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, tracks);
        hls.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, tracks);
        hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, tracks);
        hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
          const want = this.hlsSubtitle;
          if (this.hls === hls && want && data.id !== want.index && want.retries > 0) {
            want.retries--;
            // After hls.js has finished this switch.
            setTimeout(() => {
              if (this.hls === hls && this.hlsSubtitle === want && hls.subtitleTrack !== want.index) this.setHlsSubtitle(hls, want.index);
            }, 0);
          }
          tracks();
        });
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          if (this.hls === hls) {
            this.hlsParsed = true;
            const pending = this.hlsPending;
            this.hlsPending = {};
            if (pending.audio !== undefined) hls.audioTrack = pending.audio;
            if (pending.subtitle !== undefined) this.setHlsSubtitle(hls, pending.subtitle);
          }
          if (token !== this.loadToken || source.autoplay === false) return;
          v.play().catch(() => this.emit({ type: 'playing', playing: false }));
        });
        hls.loadSource(source.uri);
        hls.attachMedia(v);
      });
    } else {
      v.src = source.uri;
      v.addEventListener('loadedmetadata', begin, { once: true });
      v.load();
    }
    this.setMediaSession(source);
  }

  private setMediaSession(source: EngineSource): void {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const ms = nav && 'mediaSession' in nav ? nav.mediaSession : null;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new MediaMetadata({
        title: source.title,
        artist: source.subtitle ?? '',
        artwork: source.artworkUri ? [{ src: source.artworkUri }] : [],
      });
      const v = this.video;
      const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
        ['play', () => this.play()],
        ['pause', () => this.pause()],
        ['seekbackward', (d) => this.seekTo(this.position - (d.seekOffset ?? 10))],
        ['seekforward', (d) => this.seekTo(this.position + (d.seekOffset ?? 10))],
        ['seekto', (d) => (typeof d.seekTime === 'number' && v ? this.seekTo(d.seekTime) : undefined)],
        ['nexttrack', () => this.emit({ type: 'remote', command: 'next' })],
        ['previoustrack', () => this.emit({ type: 'remote', command: 'previous' })],
      ];
      for (const [action, handler] of handlers) {
        try {
          ms.setActionHandler(action, handler);
        } catch {
          // The browser does not support this action.
        }
      }
    } catch {
      // Media Session is a nicety.
    }
  }

  private setHlsSubtitle(hls: HlsJs, index: number): void {
    if (this.hlsSubtitle?.index !== index) this.hlsSubtitle = { index, retries: 5 };
    hls.subtitleDisplay = index >= 0;
    hls.subtitleTrack = index;
    this.emitHlsTracks();
  }

  private teardownHls(): void {
    this.hlsParsed = false;
    this.hlsPending = {};
    this.hlsSubtitle = null;
    this.hls?.destroy();
    this.hls = null;
  }

  unload(): void {
    const v = this.video;
    this.loadToken++;
    this.teardownHls();
    if (!v) return;
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  play(): void {
    this.video?.play().catch(() => undefined);
  }

  pause(): void {
    this.video?.pause();
  }

  seekTo(seconds: number): void {
    const v = this.video;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : seconds;
    v.currentTime = Math.min(Math.max(0, seconds), max);
  }

  setRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }

  setMuted(muted: boolean): void {
    if (this.video) this.video.muted = muted;
  }

  startPip(): void {
    const v = this.video;
    if (!v || !this.pipSupported) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void v.requestPictureInPicture().catch(() => undefined);
  }

  toggleFullscreen(element: unknown): void {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const target = (element as HTMLElement | null) ?? document.documentElement;
    if (typeof target.requestFullscreen === 'function') void target.requestFullscreen().catch(() => undefined);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let engine: WebEngine | null = null;

function webEngine(): WebEngine {
  engine ??= new WebEngine();
  return engine;
}

let mpvEngine: MpvEngine | null = null;

/** The HTML video element, or libmpv in the desktop app. */
export function getEngine(): VideoEngine {
  if (hasMpv) {
    mpvEngine ??= new MpvEngine();
    return mpvEngine;
  }
  return webEngine();
}

function mountVideo(node: HTMLElement): () => void {
  const v = webEngine().video;
  if (!v) return () => undefined;
  node.appendChild(v);
  return () => {
    if (v.parentNode === node) node.removeChild(v);
  };
}

function setFit(fit: VideoFit) {
  if (hasMpv) {
    // `panscan` crops the video to the window, like `object-fit: cover`; no `keepaspect` stretches it.
    void mpv.set('panscan', fit === 'cover' ? 1 : 0).catch(() => undefined);
    void mpv.set('keepaspect', fit !== 'fill').catch(() => undefined);
    return;
  }
  const v = webEngine().video;
  if (v) v.style.objectFit = fit;
}

/**
 * Moves the one video element into this view while it is mounted. In the
 * desktop app, libmpv draws the video under the page and this view lets it
 * show through.
 */
export function VideoSurface({ fit, style }: { fit: VideoFit; style?: StyleProp<ViewStyle> }) {
  const host = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!node) return undefined;
    return hasMpv ? showVideoThrough(node) : mountVideo(node);
  }, []);
  useEffect(() => setFit(fit), [fit]);
  return <View ref={host} style={style} />;
}

/** The headers a page may set on a stream request: all but the User-Agent (the browser owns it). */
export function webHeaders(source: Pick<EngineSource, 'headers' | 'userAgent'>): Record<string, string> {
  const out = sourceHeaders(source);
  for (const k of Object.keys(out)) if (k.toLowerCase() === 'user-agent') delete out[k];
  return out;
}
