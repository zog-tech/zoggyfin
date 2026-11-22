/**
 * "Load the whole video ahead": how much each engine reads ahead of the
 * play position. Off, every engine keeps its defaults, except the Android
 * byte cap below 3 GB (below). On, the engine reads ahead as far as its
 * memory cap lets it, up to the end of the video. Nothing is saved: the
 * buffer goes when the player closes.
 *
 * Rules: a live stream and a stream from a nearby host (`readAhead`, watch
 * together) never change their time target; a local file needs no buffer.
 * The byte caps keep the app alive on small devices:
 * - Android: ExoPlayer keeps its buffer on the Java heap. Its own default is
 *   about 141 MB. The heap per app (no `largeHeap`) is 128 MB on a 1 GB TV
 *   stick, 192 MB on most devices with 1.5 to 3 GB (TVs, streaming sticks,
 *   small phones) and 256 to 512 MB on larger phones. The default ran the
 *   app out of memory on both small sizes: a Fire TV Stick lost the app
 *   during a preview and during playback, and a Google TV with 2.4 GB (192 MB
 *   heap) lost it after a minute of playback, with 141 MB of video next to
 *   the app's own 40 to 50 MB. So below 3 GB (or when the memory is not
 *   known) every load, on or off, gets a byte cap: `SMALL_DEVICE_BUFFER_BYTES`
 *   in Lite mode (`platform/lite.ts`, Auto on for 1 GB sticks), else
 *   `MID_DEVICE_BUFFER_BYTES`. From 3 GB, off keeps ExoPlayer's own size.
 * - Browsers: a Media Source buffer holds about 150 MB of video in Chromium
 *   (less in Firefox) before it throws a quota error.
 * - The Mac app: libmpv keeps its cache in memory; Apple silicon Macs have
 *   8 GB or more.
 * - iOS: AVPlayer has no byte setting; it limits the buffer itself.
 *
 * Pure, so it is unit-tested.
 */
import type { EngineSource } from './engine-types';

/** What decides the buffer of one load. */
export interface BufferInput {
  /** The user's setting "Load the whole video ahead". */
  wholeVideo: boolean;
  /** The length of the video in seconds; 0 or null when not known. */
  durationSeconds: number | null;
  /** A live stream: the setting never applies. */
  live: boolean;
  /** Watch together's read-ahead for a nearby host's stream; it wins. */
  readAhead?: number;
}

/** The buffer input of an engine source. */
export function bufferInputOf(source: Pick<EngineSource, 'loadAhead' | 'readAhead'>): BufferInput {
  return { wholeVideo: !!source.loadAhead, durationSeconds: source.loadAhead?.durationSeconds ?? null, live: false, readAhead: source.readAhead };
}

/** The read-ahead in seconds when the length is not known: 4 hours. */
export const UNKNOWN_LENGTH_SECONDS = 4 * 60 * 60;

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** True when the setting changes this load. */
export function loadsWholeVideo(input: BufferInput): boolean {
  return input.wholeVideo && !input.live && !input.readAhead;
}

/** The seconds to read ahead when the setting applies: to the end, plus a margin. */
function aheadSeconds(durationSeconds: number | null): number {
  return durationSeconds && durationSeconds > 0 ? Math.ceil(durationSeconds) + 60 : UNKNOWN_LENGTH_SECONDS;
}

// ---------------------------------------------------------------------------
// Native: expo-video `bufferOptions`
// ---------------------------------------------------------------------------

/** The fields of expo-video's `BufferOptions` that the app sets. */
export interface NativeBufferOptions {
  preferredForwardBufferDuration: number;
  minBufferForPlayback: number;
  waitsToMinimizeStalling: boolean;
  /** Android only. 0: ExoPlayer picks the size (about 141 MB). */
  maxBufferBytes?: number;
  /** Android only. False: the byte cap wins over the time target. */
  prioritizeTimeOverSizeThreshold?: boolean;
}

/** Android in Lite mode: the most bytes ExoPlayer holds for any load (about 60 s of 1080p). */
export const SMALL_DEVICE_BUFFER_BYTES = 40 * MB;

/**
 * Android below 3 GB, Lite mode off: the most bytes ExoPlayer holds for any load. A third of a
 * 192 MB heap, so the app keeps room for its own 40 to 50 MB and a paused Home preview. About 50 s
 * of 1080p at 10 Mbit/s, or 10 s of a 4K file at 50 Mbit/s.
 */
export const MID_DEVICE_BUFFER_BYTES = 64 * MB;

/**
 * Android: the byte cap of every load, on or off, or null for none. Lite mode, below 3 GB, and an
 * unknown memory size (assume the small heap) have one.
 */
function androidLoadCap(totalMemoryBytes: number | null | undefined, lite: boolean): number | null {
  if (lite) return SMALL_DEVICE_BUFFER_BYTES;
  if (!totalMemoryBytes || totalMemoryBytes < 3 * GB) return MID_DEVICE_BUFFER_BYTES;
  return null;
}

/**
 * Android: the most bytes ExoPlayer holds with the setting on, by the device's
 * memory. Below 3 GB or not known: `MID_DEVICE_BUFFER_BYTES`, as for every
 * load there. expo-video turns the value into a 32-bit int, so it must stay
 * under 2 GB.
 */
export function androidBufferBytes(totalMemoryBytes: number | null | undefined): number {
  if (!totalMemoryBytes || totalMemoryBytes < 3 * GB) return MID_DEVICE_BUFFER_BYTES;
  if (totalMemoryBytes < 6 * GB) return 160 * MB;
  return 200 * MB;
}

export function nativeBufferOptions(input: BufferInput, os: string, totalMemoryBytes: number | null | undefined, lite = false): NativeBufferOptions {
  const android = os === 'android';
  const loadCap = android ? androidLoadCap(totalMemoryBytes, lite) : null;
  // A byte cap on every load, and it wins over the time target.
  const cap = loadCap !== null ? { maxBufferBytes: loadCap, prioritizeTimeOverSizeThreshold: false } : {};
  if (input.readAhead) return { preferredForwardBufferDuration: input.readAhead, minBufferForPlayback: 2, waitsToMinimizeStalling: true, ...cap };
  if (!loadsWholeVideo(input)) {
    // Android's default is 20 s; iOS's 0 lets AVPlayer decide (it can read minutes ahead).
    return { preferredForwardBufferDuration: os === 'ios' ? 0 : 20, minBufferForPlayback: 2, waitsToMinimizeStalling: true, ...cap };
  }
  const seconds = aheadSeconds(input.durationSeconds);
  if (!android) return { preferredForwardBufferDuration: seconds, minBufferForPlayback: 2, waitsToMinimizeStalling: true };
  return {
    preferredForwardBufferDuration: seconds,
    minBufferForPlayback: 2,
    waitsToMinimizeStalling: true,
    maxBufferBytes: loadCap ?? androidBufferBytes(totalMemoryBytes),
    // True would let ExoPlayer pass the byte cap to reach the time target: the whole video.
    prioritizeTimeOverSizeThreshold: false,
  };
}

/**
 * A Home preview on TV: a short clip, so a short buffer. 10 s ahead, and on Android at most 8 MB
 * (the default buffer took about 45 MB of a 1 GB stick's 128 MB Java heap).
 */
export function previewBufferOptions(os: string): NativeBufferOptions {
  const base = { preferredForwardBufferDuration: 10, minBufferForPlayback: 2, waitsToMinimizeStalling: true };
  return os === 'android' ? { ...base, maxBufferBytes: 8 * MB, prioritizeTimeOverSizeThreshold: false } : base;
}

// ---------------------------------------------------------------------------
// Web: hls.js
// ---------------------------------------------------------------------------

/** The hls.js buffer settings that the app sets. */
export interface HlsBufferConfig {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
  backBufferLength: number;
}

/** The bytes hls.js reads ahead with the setting on: under Chromium's 150 MB video quota. */
export const WEB_BUFFER_BYTES = 120 * MB;

/**
 * hls.js settings, or null for its defaults (30 s, at most 600 s, 60 MB).
 * hls.js reads ahead `maxBufferSize` bytes worth of seconds at the stream's
 * bitrate, at least `maxBufferLength`, at most `maxMaxBufferLength`. On, the
 * byte cap decides and the end of the video is the limit. The back buffer
 * is cut to 30 s, so the quota stays for the media ahead.
 */
export function hlsBufferConfig(input: BufferInput): HlsBufferConfig | null {
  if (!loadsWholeVideo(input)) return null;
  return { maxBufferLength: 30, maxMaxBufferLength: aheadSeconds(input.durationSeconds), maxBufferSize: WEB_BUFFER_BYTES, backBufferLength: 30 };
}

// ---------------------------------------------------------------------------
// Mac app: libmpv per-file options
// ---------------------------------------------------------------------------

/** The libmpv demuxer cache with the setting on (the app's default is 150 MiB). */
export const MPV_CACHE = '1024MiB';

/**
 * The per-file options for `loadfile` (each starts with a comma), or ''.
 * libmpv's `cache-secs` already has no real limit, so the byte cap decides.
 * Per-file options end with the file, so the next load has the defaults.
 */
export function mpvBufferOptions(input: BufferInput): string {
  if (input.readAhead) return `,cache-secs=${input.readAhead},demuxer-readahead-secs=${input.readAhead}`;
  if (!loadsWholeVideo(input)) return '';
  return `,demuxer-max-bytes=${MPV_CACHE}`;
}
