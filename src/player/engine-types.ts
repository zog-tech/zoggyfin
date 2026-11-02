/**
 * The engine seam: one interface over expo-video (native) and an HTML video
 * element with hls.js (web). The session drives it; screens never touch it.
 */

export interface EngineSource {
  uri: string;
  isHls: boolean;
  /** Where to start, in seconds. */
  startSeconds: number;
  /** Lock screen / Now Playing metadata. */
  title: string;
  subtitle?: string;
  artworkUri?: string;
  /** Start playing when ready (default true). False loads paused at `startSeconds`. */
  autoplay?: boolean;
  /** Engines with `tracks`: the audio stream to start with (Jellyfin stream index). */
  audioIndex?: number | null;
  /** Engines with `tracks`: Jellyfin indexes of the streams inside the file, in file order. */
  streams?: { audio: number[]; subtitles: number[] };
  /**
   * The most media the player reads ahead, seconds. Watch together sets it for
   * a stream from a nearby host, whose upload all the guests share. Unset:
   * the player's default.
   */
  readAhead?: number;
  /**
   * The User-Agent header for the stream (IPTV providers can ask for one).
   * expo-video and libmpv send it; a browser does not let a page set it.
   */
  userAgent?: string | null;
}

/** A subtitle for an engine that draws subtitles itself. */
export interface EngineSubtitle {
  /** Jellyfin stream index (the stream index in the file for embedded subtitles). */
  index: number;
  /** A separate subtitle file to load, or null for a subtitle inside the video file. */
  url: string | null;
  label: string;
  language: string | null;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * How the video fills the window: `contain` shows the whole frame, `cover`
 * crops to the window, `fill` stretches to it (the CSS `object-fit` names).
 */
export type VideoFit = 'contain' | 'cover' | 'fill';

/** The video track that plays now, as the player reports it. */
export interface VideoTrackInfo {
  width: number;
  height: number;
  /** Bits per second, or null when the player does not know. */
  bitrate: number | null;
  frameRate: number | null;
  /** A MIME type or codec name (`video/hevc`, `h264`), or null. */
  codec: string | null;
  /** The server's video range (`SDR`, `HDR10`, `DOVIWithHDR10`), for the file on the server. */
  range?: string | null;
}

/**
 * An audio or subtitle track inside the stream or file, as the engine lists
 * it (IPTV films, episodes and channels, which have no Jellyfin streams).
 */
export interface EmbeddedTrack {
  /** The engine's own id for the track; only that engine understands it. */
  id: string;
  /** The track's title in the file or playlist, or null. */
  title: string | null;
  /** An ISO 639 code (`en`, `fre`, `pt-BR`, `und`) or null. */
  language: string | null;
  /** A codec name (`ac3`, `mp4a.40.2`, `subrip`, `hdmv_pgs_subtitle`) or null when not known. */
  codec: string | null;
  isDefault: boolean;
  isForced: boolean;
}

/** The tracks of the stream that plays, and the selected ones. */
export interface EmbeddedTracks {
  audio: EmbeddedTrack[];
  subtitles: EmbeddedTrack[];
  /** The selected audio track, or null when not known. */
  audioId: string | null;
  /** The selected subtitle, or null when subtitles are off. */
  subtitleId: string | null;
}

export const NO_EMBEDDED_TRACKS: EmbeddedTracks = { audio: [], subtitles: [], audioId: null, subtitleId: null };

export type EngineEvent =
  | { type: 'status'; status: EngineStatus; error?: string }
  | { type: 'playing'; playing: boolean }
  | { type: 'time'; position: number; buffered: number }
  | { type: 'duration'; duration: number }
  | { type: 'rate'; rate: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'ended' }
  | { type: 'pip'; active: boolean }
  /** The playing video track changed (a new source, an adaptive switch). Null: not known yet. */
  | { type: 'video'; video: VideoTrackInfo | null }
  /** A remote command from the lock screen or a headset (web Media Session). */
  | { type: 'remote'; command: 'next' | 'previous' }
  /** Engines with `embedded`: the tracks inside the stream, or the selection, changed. */
  | { type: 'embedded'; tracks: EmbeddedTracks };

export type EngineListener = (event: EngineEvent) => void;

export interface VideoEngine {
  load(source: EngineSource): void;
  unload(): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  readonly position: number;
  readonly pipSupported: boolean;
  startPip(): void;
  /** Web only: full screen for the element that holds the player. */
  toggleFullscreen?(element: unknown): void;
  /**
   * Engines that switch the audio and subtitle tracks inside a direct-played
   * file themselves (libmpv in the desktop app). Without it, the server makes
   * a new stream for another audio track, and the app draws text subtitles.
   */
  tracks?: {
    selectAudio(index: number): void;
    /** null turns subtitles off. */
    selectSubtitle(subtitle: EngineSubtitle | null): void;
  };
  /**
   * Engines that list and switch the tracks inside any stream they play, by
   * their own ids (the `embedded` event). The session uses it only for IPTV,
   * where no server knows the tracks. An engine that cannot list the tracks
   * of a stream sends no list (or an empty one).
   */
  embedded?: {
    selectAudio(id: string): void;
    /** null turns subtitles off. */
    selectSubtitle(id: string | null): void;
  };
  subscribe(listener: EngineListener): () => void;
}
