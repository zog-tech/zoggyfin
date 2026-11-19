/**
 * Turns a PlaybackInfo answer into something an engine can open: the URL,
 * the play method, and the audio and subtitle tracks the user can pick.
 * Pure, so the rules are unit-tested.
 */
import type { DeviceProfile, MediaSourceInfo, MediaStream, PlaybackInfoDto, PlayMethod } from '@/api/types';

import type { VideoTrackInfo } from './engine-types';
import { originalVideo, type TranscodeTarget, transcodeTarget } from './stream-info';

/** Jellyfin 12 adds `DirectStreamUrl` to media sources. 10.11 does not send it. */
export type MediaSource = MediaSourceInfo & { DirectStreamUrl?: string | null };

export interface StreamServer {
  baseUrl: string;
  token: string | null;
  deviceId: string;
}

export interface AudioOption {
  index: number;
  label: string;
  language: string | null;
  isDefault: boolean;
}

export interface SubtitleOption {
  index: number;
  label: string;
  language: string | null;
  isDefault: boolean;
  isForced: boolean;
  /** Text subtitles are drawn by the app; image subtitles need a burned-in transcode. */
  isText: boolean;
  /** WebVTT URL for text subtitles delivered as an external file. */
  url: string | null;
  /** A separate subtitle file on the server, not a stream inside the video file. */
  isExternal?: boolean;
}

export interface StreamPlan {
  url: string;
  isHls: boolean;
  playMethod: PlayMethod;
  mediaSourceId: string;
  playSessionId: string | null;
  audio: AudioOption[];
  subtitles: SubtitleOption[];
  audioIndex: number | null;
  subtitleIndex: number | null;
  /** True when the server burns the chosen subtitle into the video. */
  burnedSubtitle: boolean;
  /** A downloaded file on this device: no server stream, no track or quality switches. */
  isLocal?: boolean;
  /** The file streams from a nearby host (watch together). Implies `isLocal` rules. */
  fromPeer?: boolean;
  /** The video stream of the file on the server (the stream info in the player). */
  original?: VideoTrackInfo | null;
  /** A transcode: the size and bitrate the server was asked for. */
  target?: TranscodeTarget | null;
  /**
   * The codec of the chosen audio track when the server may copy it into the
   * HLS stream (lower case), else null. See `dolbyAudioFallback`.
   */
  copiedAudio?: string | null;
}

export interface PlaybackInfoInput {
  userId: string;
  profile: DeviceProfile;
  maxBitrate: number;
  startTicks?: number;
  mediaSourceId?: string;
  audioIndex?: number | null;
  subtitleIndex?: number | null;
  /** Ask the server for HLS even when the file could direct play (for example to switch audio). */
  forceStream?: boolean;
}

export function playbackInfoBody(input: PlaybackInfoInput): PlaybackInfoDto {
  return {
    UserId: input.userId,
    DeviceProfile: input.profile,
    MaxStreamingBitrate: input.maxBitrate,
    StartTimeTicks: input.startTicks ?? 0,
    MediaSourceId: input.mediaSourceId,
    AudioStreamIndex: input.audioIndex ?? undefined,
    // -1 means "no subtitles" to the server.
    SubtitleStreamIndex: input.subtitleIndex ?? -1,
    EnableDirectPlay: !input.forceStream,
    EnableDirectStream: !input.forceStream,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    AutoOpenLiveStream: true,
    AlwaysBurnInSubtitleWhenTranscoding: false,
  };
}

/** Removes any old-style key and adds `ApiKey=`, the only form Jellyfin 12 accepts in URLs. */
export function withStreamAuth(url: string, token: string | null): string {
  const [path, query = ''] = url.split('?', 2) as [string, string?];
  const params = query
    .split('&')
    .filter((p) => p && !/^(api_key|apikey)=/i.test(p));
  if (token) params.push(`ApiKey=${encodeURIComponent(token)}`);
  return params.length ? `${path}?${params.join('&')}` : path;
}

/** Makes a server-relative path absolute. Absolute URLs pass through. */
export function absolute(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/+$/, '')}/${pathOrUrl.replace(/^\/+/, '')}`;
}

function query(params: Record<string, string | null | undefined>): string {
  return Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/** The static file URL for direct play: the file as it is on the server. */
export function directPlayUrl(server: StreamServer, itemId: string, source: MediaSource, playSessionId: string | null): string {
  if (source.DirectStreamUrl) return withStreamAuth(absolute(server.baseUrl, source.DirectStreamUrl), server.token);
  const container = (source.Container ?? 'mp4').split(',')[0];
  const q = query({
    static: 'true',
    mediaSourceId: source.Id ?? itemId,
    playSessionId,
    deviceId: server.deviceId,
    Tag: source.ETag,
  });
  return withStreamAuth(absolute(server.baseUrl, `/Videos/${itemId}/stream.${container}?${q}`), server.token);
}

function streamLabel(s: MediaStream, fallback: string): string {
  return s.DisplayTitle || s.Title || s.Language || fallback;
}

export function audioOptions(source: MediaSource): AudioOption[] {
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Audio' && typeof s.Index === 'number')
    .map((s, i) => ({
      index: s.Index as number,
      label: streamLabel(s, `Track ${i + 1}`),
      language: s.Language ?? null,
      isDefault: !!s.IsDefault,
    }));
}

export function subtitleOptions(server: StreamServer, source: MediaSource): SubtitleOption[] {
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Subtitle' && typeof s.Index === 'number')
    .map((s, i) => {
      const isText = s.IsTextSubtitleStream !== false;
      const delivery = s.DeliveryMethod === 'External' && s.DeliveryUrl ? s.DeliveryUrl : null;
      return {
        index: s.Index as number,
        label: streamLabel(s, `Subtitle ${i + 1}`),
        language: s.Language ?? null,
        isDefault: !!s.IsDefault,
        isForced: !!s.IsForced,
        isText,
        url: delivery ? withStreamAuth(absolute(server.baseUrl, delivery), server.token) : null,
        isExternal: !!s.IsExternal,
      };
    });
}

/**
 * The plan for one media source. Direct play opens the file; otherwise the
 * server's TranscodingUrl (HLS) is used, with fresh `ApiKey` auth.
 */
export function planStream(
  server: StreamServer,
  itemId: string,
  source: MediaSource,
  playSessionId: string | null,
  chosen: { audioIndex?: number | null; subtitleIndex?: number | null } = {},
): StreamPlan {
  const subtitles = subtitleOptions(server, source);
  const audioIndex = chosen.audioIndex ?? source.DefaultAudioStreamIndex ?? audioOptions(source)[0]?.index ?? null;
  const subtitleIndex = chosen.subtitleIndex != null && chosen.subtitleIndex >= 0 ? chosen.subtitleIndex : null;
  const sub = subtitles.find((s) => s.index === subtitleIndex);
  const base = {
    mediaSourceId: source.Id ?? itemId,
    playSessionId,
    audio: audioOptions(source),
    subtitles,
    audioIndex,
    subtitleIndex,
    original: originalVideo(source),
  };
  if (source.SupportsDirectPlay || (!source.TranscodingUrl && source.SupportsDirectStream)) {
    const url = directPlayUrl(server, itemId, source, playSessionId);
    return { ...base, url, isHls: false, playMethod: source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream', burnedSubtitle: false };
  }
  if (!source.TranscodingUrl) throw new Error('The server cannot stream this file to this device.');
  const url = withStreamAuth(absolute(server.baseUrl, source.TranscodingUrl), server.token);
  return {
    ...base,
    url,
    isHls: (source.TranscodingSubProtocol ?? '').toLowerCase() === 'hls' || /\.m3u8(\?|$)/i.test(url),
    playMethod: 'Transcode',
    burnedSubtitle: !!sub && !sub.isText,
    target: transcodeTarget(source.TranscodingUrl),
    copiedAudio: copiedAudioCodec(source, audioIndex),
  };
}

/** The chosen track's codec when the transcode URL lets the server copy it. */
function copiedAudioCodec(source: MediaSource, audioIndex: number | null): string | null {
  const track = (source.MediaStreams ?? []).find((s) => s.Type === 'Audio' && s.Index === audioIndex);
  const codec = track?.Codec?.toLowerCase();
  if (!codec || !source.TranscodingUrl) return null;
  const allowed = /[?&]AudioCodec=([^&]*)/i.exec(source.TranscodingUrl)?.[1];
  if (!allowed) return null;
  const list = decodeURIComponent(allowed).toLowerCase().split(',');
  return list.includes(codec) ? codec : null;
}

/**
 * True when a failed HLS stream should be asked for again with AAC audio.
 *
 * A file whose AC-3 or E-AC-3 track starts after the video (a common web
 * release: the audio starts 15 s in) breaks the server's fMP4 HLS remux:
 * FFmpeg must write the init segment before it saw an audio packet, so the
 * audio entry stays empty ("Cannot write moov atom before EAC3 packets
 * parsed"). AVPlayer then stops with CoreMediaErrorDomain -16172. The server's
 * data does not show when a track starts, so the player tries AAC only after
 * such a stream fails. AAC is encoded at once, so its entry is never empty.
 */
export function dolbyAudioFallback(plan: Pick<StreamPlan, 'isHls' | 'isLocal' | 'copiedAudio'>): boolean {
  return plan.isHls && !plan.isLocal && (plan.copiedAudio === 'ac3' || plan.copiedAudio === 'eac3');
}

/**
 * True when picking this audio track needs a new stream from the server:
 * a direct-played file always plays its default track, so another track
 * needs a remux.
 */
export function audioSwitchNeedsStream(plan: Pick<StreamPlan, 'playMethod' | 'audio'>, index: number): boolean {
  if (plan.playMethod === 'Transcode') return true;
  const first = plan.audio.find((a) => a.isDefault) ?? plan.audio[0];
  return !!first && first.index !== index;
}

/** Picks the media source to play: the requested one, or the first. */
export function pickSource(sources: readonly MediaSource[] | null | undefined, mediaSourceId?: string): MediaSource | null {
  if (!sources?.length) return null;
  return sources.find((s) => s.Id === mediaSourceId) ?? sources[0] ?? null;
}
