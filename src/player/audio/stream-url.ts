/**
 * The audio stream URL: GET /Audio/{id}/universal. The server direct-plays
 * the file when its container and codec are in our device profile (it
 * redirects to the static file) and transcodes to mp3 over plain HTTP
 * otherwise. Auth is `ApiKey=` in the query, the only URL form Jellyfin 12
 * accepts. Pure, so it is unit-tested.
 */
import type { DeviceProfile, PlayMethod } from '@/api/types';

import { absolute, type StreamServer, withStreamAuth } from '../stream';

export interface AudioStreamOptions {
  userId: string;
  maxBitrate: number;
  playSessionId: string;
  /** Start of a transcoded stream, in ticks. Direct play seeks in the file instead. */
  startTicks?: number;
}

/**
 * Audio containers for a direct-play entry with no `Container` (the libmpv
 * profile: "any container"). The universal endpoint has no form for "any":
 * an empty `Container` means "no direct play", and the server then
 * transcodes every song. So the URL names the containers such a player
 * reads. Jellyfin reports an .m4a file as "mov,mp4,m4a,3gp,3g2,mj2", and a
 * match on any one of the names is enough.
 */
export const ANY_AUDIO_CONTAINERS = [
  'mp3', 'aac', 'm4a', 'm4b', 'mp4', 'mov', 'flac', 'alac', 'ogg', 'oga', 'opus', 'webm',
  'wav', 'wma', 'asf', 'mka', 'ape', 'wv', 'dsf', 'dff', 'aiff', 'aif',
] as const;

/**
 * The universal endpoint's `Container` list from the profile's audio
 * direct-play entries: "mp3,aac|aac,m4a|aac,flac|flac" (container or
 * container|codec). An entry with no `Container` stands for every container
 * (`ANY_AUDIO_CONTAINERS`).
 */
export function universalContainers(profile: DeviceProfile): string {
  const out: string[] = [];
  for (const p of profile.DirectPlayProfiles ?? []) {
    if (p.Type !== 'Audio') continue;
    const codecs = (p.AudioCodec ?? '').split(',').filter(Boolean);
    const containers = p.Container ? p.Container.split(',').filter(Boolean) : [...ANY_AUDIO_CONTAINERS];
    for (const container of containers) {
      if (!codecs.length || (codecs.length === 1 && codecs[0] === container)) out.push(container);
      else for (const codec of codecs) out.push(`${container}|${codec}`);
    }
  }
  return [...new Set(out)].join(',');
}

function transcodeProfile(profile: DeviceProfile) {
  return profile.TranscodingProfiles?.find((t) => t.Type === 'Audio') ?? null;
}

export function universalAudioUrl(server: StreamServer, itemId: string, profile: DeviceProfile, o: AudioStreamOptions): string {
  const t = transcodeProfile(profile);
  const params: Record<string, string> = {
    UserId: o.userId,
    DeviceId: server.deviceId,
    MaxStreamingBitrate: String(Math.round(o.maxBitrate)),
    Container: universalContainers(profile),
    TranscodingContainer: t?.Container ?? 'mp3',
    TranscodingProtocol: t?.Protocol === 'hls' ? 'hls' : 'http',
    AudioCodec: t?.AudioCodec ?? 'mp3',
    MaxAudioChannels: t?.MaxAudioChannels ?? '2',
    PlaySessionId: o.playSessionId,
    EnableRedirection: 'true',
    EnableRemoteMedia: 'false',
  };
  if (o.startTicks && o.startTicks > 0) params.StartTimeTicks = String(Math.round(o.startTicks));
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return withStreamAuth(absolute(server.baseUrl, `/Audio/${encodeURIComponent(itemId)}/universal?${q}`), server.token);
}

interface AudioItemLike {
  Container?: string | null;
  MediaSources?: readonly {
    Container?: string | null;
    Bitrate?: number | null;
    MediaStreams?: readonly { Type?: string | null; Codec?: string | null; BitRate?: number | null }[] | null;
  }[] | null;
  MediaStreams?: readonly { Type?: string | null; Codec?: string | null; BitRate?: number | null }[] | null;
}

/**
 * What the server will do with this file: direct play when the container and
 * codec match a direct-play entry and the bitrate fits, else a transcode.
 * Used for the progress reports, the seek path (a transcode seeks with a new
 * request) and the format line; when the file facts are missing, it assumes
 * direct play. Like the server, a file container list ("mov,mp4,m4a") matches
 * when any of its names is in the entry. An entry with no container or no
 * codec list matches any.
 */
export function predictPlayMethod(item: AudioItemLike, profile: DeviceProfile, maxBitrate: number): PlayMethod {
  const source = item.MediaSources?.[0];
  const containers = splitList(source?.Container ?? item.Container);
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const audio = streams.find((s) => s.Type === 'Audio');
  const codec = (audio?.Codec ?? '').toLowerCase();
  if (!containers.length) return 'DirectPlay';
  const bitrate = source?.Bitrate ?? audio?.BitRate ?? 0;
  if (bitrate && bitrate > maxBitrate) return 'Transcode';
  const ok = (profile.DirectPlayProfiles ?? []).some((p) => {
    if (p.Type !== 'Audio') return false;
    const allowed = splitList(p.Container);
    const codecs = splitList(p.AudioCodec);
    const containerOk = !allowed.length || containers.some((c) => allowed.includes(c));
    return containerOk && (!codec || !codecs.length || codecs.includes(codec));
  });
  return ok ? 'DirectPlay' : 'Transcode';
}

function splitList(v: string | null | undefined): string[] {
  return (v ?? '')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** A label for the file container when the codec is unknown: "mov,mp4,m4a,…" is an M4A file, not "MOV". */
function containerLabel(container: string | null | undefined): string | undefined {
  const list = splitList(container);
  if (list.includes('m4a')) return 'M4A';
  return list[0]?.toUpperCase();
}

/** True when the item carries the audio codec (a tile item has only the container). */
export function hasCodecInfo(item: AudioItemLike): boolean {
  const streams = item.MediaSources?.[0]?.MediaStreams ?? item.MediaStreams ?? [];
  return !!streams.find((s) => s.Type === 'Audio')?.Codec;
}

/** "MP3 · 128 kbps", "FLAC · 24/96" for the line under the scrubber. Null when unknown. */
export function formatLine(item: AudioItemLike): string | null {
  const source = item.MediaSources?.[0];
  const streams = source?.MediaStreams ?? item.MediaStreams ?? [];
  const audio = streams.find((s) => s.Type === 'Audio') as
    | { Codec?: string | null; BitRate?: number | null; BitDepth?: number | null; SampleRate?: number | null }
    | undefined;
  const codec = audio?.Codec?.toUpperCase() ?? containerLabel(source?.Container ?? item.Container);
  if (!codec) return null;
  const lossless = /FLAC|ALAC|WAV|PCM/.test(codec);
  if (lossless && audio?.BitDepth && audio.SampleRate) {
    return `${codec} · ${audio.BitDepth}/${Math.round(audio.SampleRate / 1000)}`;
  }
  const kbps = audio?.BitRate ?? source?.Bitrate;
  return kbps ? `${codec} · ${Math.round(kbps / 1000)} kbps` : codec;
}
