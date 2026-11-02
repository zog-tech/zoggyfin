/**
 * What the player shows about the video stream: the resolution and bitrate
 * that play now and those of the original file, so a viewer can tell whether
 * a higher quality setting would help. The player's own report wins; without
 * one, a direct-played file plays as it is, and a transcode plays at the size
 * and bitrate its URL asks the server for. Pure, so it is unit-tested.
 */
import type { PlayMethod } from '@/api/types';

import type { VideoTrackInfo } from './engine-types';
import type { MediaSource } from './stream';

/** The limits a transcode asks the server for. */
export interface TranscodeTarget {
  maxWidth: number | null;
  maxHeight: number | null;
  /** Bits per second. */
  videoBitrate: number | null;
  /** The server's `TranscodeReasons` (for example `AudioCodecNotSupported`). */
  reasons: string[];
}

/** The video stream of the file on the server, or null when it has none. */
export function originalVideo(source: MediaSource): VideoTrackInfo | null {
  const v = (source.MediaStreams ?? []).find((m) => m.Type === 'Video');
  if (!v?.Width || !v.Height) return null;
  return {
    width: v.Width,
    height: v.Height,
    bitrate: v.BitRate ?? source.Bitrate ?? null,
    frameRate: v.RealFrameRate ?? v.AverageFrameRate ?? null,
    codec: v.Codec ?? null,
    range: v.VideoRangeType ?? null,
  };
}

/** Reads `MaxWidth`, `MaxHeight`, `VideoBitrate` and `TranscodeReasons` from a Jellyfin transcode URL (any case). */
export function transcodeTarget(url: string): TranscodeTarget {
  const params = new Map<string, string>();
  const q = url.indexOf('?');
  for (const part of q < 0 ? [] : url.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    try {
      params.set(decodeURIComponent(part.slice(0, eq)).toLowerCase(), decodeURIComponent(part.slice(eq + 1)));
    } catch {
      // A malformed escape: skip the parameter.
    }
  }
  const num = (k: string) => {
    const n = Number(params.get(k));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const reasons = (params.get('transcodereasons') ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  return { maxWidth: num('maxwidth'), maxHeight: num('maxheight'), videoBitrate: num('videobitrate'), reasons };
}

const REASONS: Record<string, string> = {
  ContainerNotSupported: 'file format',
  VideoCodecNotSupported: 'video codec',
  AudioCodecNotSupported: 'audio codec',
  SubtitleCodecNotSupported: 'subtitles burned in',
  AudioChannelsNotSupported: 'audio channels',
  AudioProfileNotSupported: 'audio profile',
  AudioSampleRateNotSupported: 'audio sample rate',
  AudioBitDepthNotSupported: 'audio bit depth',
  AudioBitrateNotSupported: 'audio bitrate',
  AudioIsExternal: 'external audio file',
  SecondaryAudioNotSupported: 'audio track',
  VideoProfileNotSupported: 'video profile',
  VideoLevelNotSupported: 'video level',
  VideoResolutionNotSupported: 'resolution',
  VideoBitDepthNotSupported: 'video bit depth',
  VideoFramerateNotSupported: 'frame rate',
  VideoRangeTypeNotSupported: 'HDR type',
  VideoCodecTagNotSupported: 'video codec tag',
  RefFramesNotSupported: 'reference frames',
  AnamorphicVideoNotSupported: 'anamorphic video',
  InterlacedVideoNotSupported: 'interlaced video',
  ContainerBitrateExceedsLimit: 'quality limit',
  VideoBitrateNotSupported: 'quality limit',
  UnknownVideoStreamInfo: 'unknown video',
  UnknownAudioStreamInfo: 'unknown audio',
  DirectPlayError: 'a direct play error',
  StreamCountExceedsLimit: 'too many streams',
};

/** Why the server converts the file, in words: "audio codec, subtitles burned in". Null with no reason. */
export function transcodeReasonText(reasons: readonly string[]): string | null {
  const words = reasons.map((r) => REASONS[r] ?? r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const unique = [...new Set(words)];
  return unique.length ? unique.join(', ') : null;
}

/** The video that plays now: the player's report, else what the server sends. */
export function playingVideo(
  reported: VideoTrackInfo | null,
  method: PlayMethod,
  original: VideoTrackInfo | null,
  target: TranscodeTarget | null,
): VideoTrackInfo | null {
  const direct = method !== 'Transcode';
  const bitrate = (direct ? original?.bitrate : target?.videoBitrate) ?? null;
  if (reported) return { ...reported, bitrate: reported.bitrate ?? bitrate };
  if (direct || !original) return original;
  // The server scales down to fit both limits and keeps the shape.
  const scale = Math.min(
    1,
    target?.maxWidth ? target.maxWidth / original.width : 1,
    target?.maxHeight ? target.maxHeight / original.height : 1,
  );
  return {
    width: Math.round(original.width * scale),
    height: Math.round(original.height * scale),
    bitrate,
    frameRate: original.frameRate,
    codec: null,
  };
}

const LADDER: readonly [number, string][] = [
  [2160, '4K'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p'],
  [576, '576p'],
  [540, '540p'],
  [480, '480p'],
  [360, '360p'],
  [240, '240p'],
];

/**
 * The usual name for a size. Wide films count by their width, so 1920×800
 * is 1080p, and a few lines short of a step (1920×1036) still count.
 */
export function resolutionLabel(width: number, height: number): string {
  const lines = Math.max(height, Math.round((width * 9) / 16));
  for (const [step, label] of LADDER) if (lines >= step * 0.95) return label;
  return `${lines}p`;
}

/** 8.2 Mbps, 25 Mbps, 640 kbps. */
export function formatBitrate(bps: number): string {
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`;
  const m = bps / 1_000_000;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} Mbps`;
}

const CODECS: Record<string, string> = {
  h264: 'H.264',
  avc: 'H.264',
  'video/avc': 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  'video/hevc': 'HEVC',
  av1: 'AV1',
  'video/av01': 'AV1',
  vp9: 'VP9',
  'video/x-vnd.on2.vp9': 'VP9',
  // ExoPlayer names the Dolby Vision decoder, not the base codec.
  'video/dolby-vision': 'Dolby Vision',
};

/** A codec name or MIME type as people know it (HEVC, H.264). */
export function codecLabel(codec: string): string {
  return CODECS[codec.toLowerCase()] ?? codec.replace(/^video\//i, '').toUpperCase();
}

/** One short line: "1080p · 8.2 Mbps". */
export function videoSummary(v: VideoTrackInfo): string {
  return [resolutionLabel(v.width, v.height), v.bitrate ? formatBitrate(v.bitrate) : null].filter(Boolean).join(' · ');
}

const RANGES: Record<string, string> = {
  HDR10: 'HDR10',
  HDR10Plus: 'HDR10+',
  HLG: 'HLG',
  DOVI: 'Dolby Vision',
  DOVIWithHDR10: 'Dolby Vision · HDR10',
  DOVIWithHDR10Plus: 'Dolby Vision · HDR10+',
  DOVIWithHLG: 'Dolby Vision · HLG',
  DOVIWithSDR: 'Dolby Vision · SDR',
};

/** The HDR type as people know it, or null for SDR and an unknown range. */
export function rangeLabel(range: string | null | undefined): string | null {
  return range ? (RANGES[range] ?? null) : null;
}

/** The details: "1920×1080 · HEVC · HDR10 · 23.976 fps". */
export function videoDetail(v: VideoTrackInfo): string {
  const fps = v.frameRate ? `${Number(v.frameRate.toFixed(3))} fps` : null;
  return [`${v.width}×${v.height}`, v.codec ? codecLabel(v.codec) : null, rangeLabel(v.range), fps].filter(Boolean).join(' · ');
}
