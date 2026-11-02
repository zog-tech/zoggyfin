/**
 * The device profile sent with PlaybackInfo. It tells the server what this
 * client can play as is; the server remuxes or transcodes the rest to HLS.
 *
 * Pure: the capabilities come in as data, so the profile is unit-tested.
 */
import type {
  CodecProfile,
  DeviceProfile,
  DirectPlayProfile,
  ProfileCondition,
  SubtitleProfile,
  TranscodingProfile,
} from '@/api/types';

export type VideoCodec = 'h264' | 'hevc' | 'av1' | 'vp9';
export type AudioCodec = 'aac' | 'ac3' | 'eac3' | 'mp3' | 'flac' | 'alac' | 'opus';

export interface MediaCapabilities {
  /**
   * `apple` is AVPlayer (iPhone, iPad, Mac). `web` is a browser `<video>` element.
   * `mpv` is libmpv in the desktop app: it direct plays almost every file.
   * `exo` is ExoPlayer (Media3) on Android, through expo-video.
   */
  engine: 'apple' | 'web' | 'mpv' | 'exo';
  /** Video codecs the device can direct play. */
  videoCodecs: readonly VideoCodec[];
  /** Audio codecs the device can direct play. */
  audioCodecs: readonly AudioCodec[];
  /** Containers for direct play. */
  containers: readonly string[];
  /** The device plays HLS: natively (AVPlayer, Safari) or through Media Source Extensions (hls.js). */
  hls: boolean;
  /** Codecs the HLS player accepts in transcoded streams. */
  hlsVideoCodecs: readonly VideoCodec[];
  hlsAudioCodecs: readonly AudioCodec[];
  maxAudioChannels: number;
  /** The highest H.264 level the decoder plays, in server numbers (5.1 is 51). Default: 52 for AVPlayer, else 51. */
  h264Level?: number;
  /** The highest HEVC level, in server numbers (5.1 is 153). Default: 183. */
  hevcLevel?: number;
  /** HEVC video ranges the device shows correctly, `|`-separated. Default: the AVPlayer list. */
  hevcRanges?: string;
  /** False when the HEVC decoder plays 8-bit video only. Default: true. */
  hevcTenBit?: boolean;
  /** AV1 video ranges the device shows correctly, `|`-separated. Default: SDR, HDR10, HDR10+ and HLG. */
  av1Ranges?: string;
}

export interface ProfileOptions {
  /** Maximum bitrate in bits per second, from the quality setting. */
  maxBitrate: number;
}

/** AVPlayer: what Apple's decoders play from an mp4/mov file. */
export function appleCapabilities(hardware: { av1: boolean; hevc: boolean }): MediaCapabilities {
  const video: VideoCodec[] = ['h264'];
  if (hardware.hevc) video.push('hevc');
  // AV1 software decode is not available to AVPlayer: only list it with a hardware decoder.
  if (hardware.av1) video.push('av1');
  const audio: AudioCodec[] = ['aac', 'ac3', 'eac3', 'mp3', 'flac', 'alac'];
  return {
    engine: 'apple',
    videoCodecs: video,
    audioCodecs: audio,
    containers: ['mp4', 'm4v', 'mov'],
    hls: true,
    hlsVideoCodecs: hardware.hevc ? ['hevc', 'h264'] : ['h264'],
    hlsAudioCodecs: ['aac', 'ac3', 'eac3', 'mp3'],
    maxAudioChannels: 6,
  };
}

/**
 * libmpv (desktop app): FFmpeg decodes almost every codec and container, and
 * libmpv draws every subtitle format itself (ASS, PGS, DVD).
 */
export function mpvCapabilities(): MediaCapabilities {
  return {
    engine: 'mpv',
    videoCodecs: ['h264', 'hevc', 'av1', 'vp9'],
    audioCodecs: ['aac', 'ac3', 'eac3', 'mp3', 'flac', 'alac', 'opus'],
    containers: ['mkv', 'mp4', 'm4v', 'mov', 'webm', 'avi', 'ts', 'm2ts'],
    hls: true,
    hlsVideoCodecs: ['hevc', 'h264'],
    hlsAudioCodecs: ['aac', 'ac3', 'eac3', 'mp3'],
    maxAudioChannels: 8,
  };
}

/** Subtitle formats libmpv draws from the file or from a separate file. */
const MPV_TEXT_SUBTITLES = ['ass', 'ssa', 'srt', 'subrip', 'vtt', 'webvtt', 'mov_text', 'smi', 'sub', 'ttml'];
const MPV_IMAGE_SUBTITLES = ['pgssub', 'pgs', 'dvdsub', 'dvbsub', 'vobsub', 'sup'];

/**
 * The libmpv profile: direct play for every container and codec (an empty
 * list means "any" to the server), subtitles stay in the file. HLS is only a
 * fallback when the bitrate limit is lower than the file's bitrate.
 */
function mpvProfile(caps: MediaCapabilities, options: ProfileOptions): DeviceProfile {
  const subtitles: SubtitleProfile[] = [
    ...[...MPV_TEXT_SUBTITLES, ...MPV_IMAGE_SUBTITLES].map((Format): SubtitleProfile => ({ Format, Method: 'Embed' })),
    ...[...MPV_TEXT_SUBTITLES, ...MPV_IMAGE_SUBTITLES].map((Format): SubtitleProfile => ({ Format, Method: 'External' })),
  ];
  return {
    Name: 'Zoggyfin (mpv)',
    MaxStreamingBitrate: options.maxBitrate,
    MaxStaticBitrate: options.maxBitrate,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
    TranscodingProfiles: [
      {
        Container: 'mp4',
        Type: 'Video',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: caps.hlsVideoCodecs.join(','),
        AudioCodec: caps.hlsAudioCodecs.join(','),
        MaxAudioChannels: String(caps.maxAudioChannels),
        MinSegments: 2,
        BreakOnNonKeyFrames: true,
      },
      { Container: 'mp3', Type: 'Audio', Protocol: 'http', Context: 'Streaming', AudioCodec: 'mp3', MaxAudioChannels: '2' },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: subtitles,
  };
}

/** One decoder family, from MediaCodecList (modules/zoggyfin-native, Android). */
export interface DecoderInfo {
  hardware: boolean;
  software: boolean;
  /** Server numbers: H.264 5.1 is 51, HEVC 5.1 is 153. 0 when unknown. */
  maxLevel: number;
  tenBit: boolean;
}

/** The decoders of an Android device and the HDR types of its display. */
export interface AndroidDecoders {
  codecs: Partial<Record<string, DecoderInfo>>;
  /** `hdr10`, `hdr10Plus`, `hlg`, `dolbyVision`. */
  hdr: readonly string[];
  sdk: number;
}

/**
 * ExoPlayer (Android). With no decoder report (a build without the native
 * module) the answer is conservative: H.264 and HEVC in SDR, no Dolby audio.
 * Video codecs other than H.264 count only with a hardware decoder: the
 * software decoders are too slow for full HD on most phones.
 */
export function exoCapabilities(report: AndroidDecoders | null): MediaCapabilities {
  const has = (k: string) => {
    const d = report?.codecs[k];
    return !!d && (d.hardware || d.software);
  };
  const hw = (k: string) => !!report?.codecs[k]?.hardware;
  const video: VideoCodec[] = ['h264'];
  const hevc = report ? hw('hevc') : true;
  if (hevc) video.push('hevc');
  if (hw('vp9')) video.push('vp9');
  if (hw('av1')) video.push('av1');
  const audio: AudioCodec[] = ['aac', 'mp3'];
  if (!report || has('flac')) audio.push('flac');
  if (!report || has('opus')) audio.push('opus');
  if (has('alac')) audio.push('alac');
  if (has('ac3')) audio.push('ac3');
  if (has('eac3')) audio.push('eac3');
  const hlsAudio = (['aac', 'mp3', 'ac3', 'eac3'] as const).filter((c) => audio.includes(c));
  const hdr = report?.hdr ?? [];
  const tenBit = report ? !!report.codecs.hevc?.tenBit : false;
  // Dolby Vision with a fallback layer plays as that layer (HDR10, HLG or SDR).
  const exoRanges = (tenBitDecoder: boolean) => {
    const out = ['SDR'];
    if (tenBitDecoder && hdr.includes('hdr10')) out.push('HDR10', 'DOVIWithHDR10');
    if (tenBitDecoder && hdr.includes('hdr10Plus')) out.push('HDR10Plus', 'DOVIWithHDR10Plus');
    if (tenBitDecoder && hdr.includes('hlg')) out.push('HLG', 'DOVIWithHLG');
    out.push('DOVIWithSDR');
    return out;
  };
  const ranges = exoRanges(tenBit);
  // Dolby Vision profile 5 has no fallback layer: only with a Dolby Vision decoder and display.
  if (has('dolbyVision') && hdr.includes('dolbyVision')) ranges.push('DOVI');
  // AV1 had the AVPlayer list, which has no Dolby Vision: an AV1 film with a Dolby Vision
  // layer was converted to H.264, slower than real time on many servers.
  const av1TenBit = !!report?.codecs.av1?.tenBit;
  const level = (k: string, fallback: number) => {
    const n = report?.codecs[k]?.maxLevel ?? 0;
    return n > 0 ? n : fallback;
  };
  return {
    engine: 'exo',
    videoCodecs: video,
    audioCodecs: audio,
    containers: ['mp4', 'm4v', 'mov', 'mkv', 'webm'],
    hls: true,
    hlsVideoCodecs: hevc ? ['hevc', 'h264'] : ['h264'],
    hlsAudioCodecs: hlsAudio,
    maxAudioChannels: 6,
    h264Level: level('h264', 51),
    hevcLevel: level('hevc', 153),
    hevcRanges: ranges.join('|'),
    hevcTenBit: tenBit,
    av1Ranges: exoRanges(av1TenBit).join('|'),
  };
}

/** A probe answer: true when the browser says it can play the MIME type. */
export type CanPlay = (mime: string) => boolean;

/**
 * Browser capabilities from `video.canPlayType` (direct play) and
 * `MediaSource.isTypeSupported` (hls.js). Safari plays HLS natively.
 */
export function webCapabilities(probe: { canPlay: CanPlay; canMse: CanPlay; nativeHls: boolean }): MediaCapabilities {
  const { canPlay, canMse, nativeHls } = probe;
  const either: CanPlay = (m) => canPlay(m) || canMse(m);
  const videoTests: [VideoCodec, string][] = [
    ['h264', 'video/mp4; codecs="avc1.640029"'],
    ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
    ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
    ['vp9', 'video/mp4; codecs="vp09.00.40.08"'],
  ];
  const audioTests: [AudioCodec, string][] = [
    ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
    ['mp3', 'audio/mpeg'],
    ['ac3', 'audio/mp4; codecs="ac-3"'],
    ['eac3', 'audio/mp4; codecs="ec-3"'],
    ['flac', 'audio/mp4; codecs="flac"'],
    ['opus', 'audio/mp4; codecs="opus"'],
    ['alac', 'audio/mp4; codecs="alac"'],
  ];
  const videoCodecs = videoTests.filter(([, m]) => canPlay(m)).map(([c]) => c);
  const audioCodecs = audioTests.filter(([, m]) => canPlay(m)).map(([c]) => c);
  const mse = canMse('video/mp4; codecs="avc1.640029,mp4a.40.2"');
  const hlsTest: CanPlay = nativeHls ? canPlay : canMse;
  // HEVC first: the server encodes to the first codec in the list that it supports.
  const hlsVideoCodecs = (['hevc', 'h264'] as const).filter((c) =>
    hlsTest(videoTests.find(([v]) => v === c)?.[1] ?? ''),
  );
  const hlsAudioCodecs = audioTests.filter(([c, m]) => (c === 'aac' || c === 'mp3' || c === 'ac3' || c === 'eac3') && hlsTest(m)).map(([c]) => c);
  return {
    engine: 'web',
    videoCodecs: videoCodecs.length ? videoCodecs : ['h264'],
    audioCodecs: audioCodecs.length ? audioCodecs : ['aac', 'mp3'],
    containers: either('video/webm; codecs="vp9"') ? ['mp4', 'm4v', 'webm'] : ['mp4', 'm4v'],
    hls: nativeHls || mse,
    hlsVideoCodecs: hlsVideoCodecs.length ? hlsVideoCodecs : ['h264'],
    hlsAudioCodecs: hlsAudioCodecs.length ? hlsAudioCodecs : ['aac'],
    maxAudioChannels: 2,
  };
}

function cond(Condition: ProfileCondition['Condition'], Property: ProfileCondition['Property'], Value: string, IsRequired = false): ProfileCondition {
  return { Condition, Property, Value, IsRequired };
}

/** Video ranges AVPlayer shows correctly. Dolby Vision profile 5 ("DOVI") has no fallback layer: leave it out. */
const HEVC_RANGES = 'SDR|HDR10|HDR10Plus|HLG|DOVIWithHDR10|DOVIWithHLG|DOVIWithSDR|DOVIWithHDR10Plus';
const AV1_RANGES = 'SDR|HDR10|HDR10Plus|HLG';

/**
 * No `IsAnamorphic` rule: AVPlayer and browsers honour the pixel aspect ratio,
 * and the server marks many ordinary files as anamorphic.
 */
function codecProfiles(caps: MediaCapabilities): CodecProfile[] {
  const out: CodecProfile[] = [
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        cond('EqualsAny', 'VideoProfile', 'high|main|baseline|constrained baseline'),
        cond('EqualsAny', 'VideoRangeType', 'SDR'),
        cond('LessThanEqual', 'VideoLevel', String(caps.h264Level ?? (caps.engine === 'apple' ? 52 : 51))),
        cond('LessThanEqual', 'VideoBitDepth', '8'),
        cond('NotEquals', 'IsInterlaced', 'true'),
      ],
    },
    {
      Type: 'VideoAudio',
      Conditions: [cond('LessThanEqual', 'AudioChannels', String(caps.maxAudioChannels))],
    },
  ];
  if (caps.videoCodecs.includes('hevc') || caps.hlsVideoCodecs.includes('hevc')) {
    out.push({
      Type: 'Video',
      Codec: 'hevc',
      Conditions: [
        cond('EqualsAny', 'VideoProfile', 'main|main 10'),
        cond('EqualsAny', 'VideoRangeType', caps.hevcRanges ?? HEVC_RANGES),
        cond('LessThanEqual', 'VideoLevel', String(caps.hevcLevel ?? 183)),
        ...(caps.hevcTenBit === false ? [cond('LessThanEqual', 'VideoBitDepth', '8')] : []),
        cond('NotEquals', 'IsInterlaced', 'true'),
        // AVPlayer only opens HEVC in mp4 with the `hvc1` (or Dolby Vision `dvh1`) sample entry, not `hev1`.
        ...(caps.engine === 'apple' ? [cond('EqualsAny', 'VideoCodecTag', 'hvc1|dvh1', true)] : []),
      ],
    });
  }
  if (caps.videoCodecs.includes('av1')) {
    out.push({
      Type: 'Video',
      Codec: 'av1',
      Conditions: [
        cond('EqualsAny', 'VideoProfile', 'main'),
        cond('EqualsAny', 'VideoRangeType', caps.av1Ranges ?? AV1_RANGES),
        cond('LessThanEqual', 'VideoBitDepth', '10'),
      ],
    });
  }
  return out;
}

/** Text subtitles come as WebVTT files that the app draws; image subtitles are burned in by the server. */
const SUBTITLES: SubtitleProfile[] = [
  { Format: 'vtt', Method: 'External' },
  { Format: 'pgssub', Method: 'Encode' },
  { Format: 'pgs', Method: 'Encode' },
  { Format: 'dvdsub', Method: 'Encode' },
  { Format: 'dvbsub', Method: 'Encode' },
  { Format: 'vobsub', Method: 'Encode' },
];

/** Containers ExoPlayer reads for each video codec. */
function exoDirectPlay(caps: MediaCapabilities): DirectPlayProfile[] {
  const join = (xs: readonly string[]) => xs.join(',');
  const notOpus = caps.audioCodecs.filter((c) => c !== 'opus');
  const out: DirectPlayProfile[] = [
    {
      Container: 'mp4,m4v,mov',
      Type: 'Video',
      VideoCodec: join(caps.videoCodecs.filter((c) => c !== 'vp9')),
      AudioCodec: join(notOpus),
    },
    { Container: 'mkv', Type: 'Video', VideoCodec: join(caps.videoCodecs), AudioCodec: join(caps.audioCodecs) },
  ];
  const webmVideo = caps.videoCodecs.filter((c) => c === 'vp9' || c === 'av1');
  if (webmVideo.length) {
    // Every Android version that Zoggyfin supports decodes Opus.
    out.push({ Container: 'webm', Type: 'Video', VideoCodec: join(webmVideo), AudioCodec: 'opus' });
  }
  return out;
}

const AUDIO_CONTAINERS: Partial<Record<AudioCodec, string>> = {
  mp3: 'mp3',
  aac: 'aac,m4a,m4b',
  flac: 'flac',
  alac: 'm4a,m4b',
  opus: 'ogg,opus,webm',
};

const PROFILE_NAMES: Record<MediaCapabilities['engine'], string> = {
  apple: 'Zoggyfin (AVPlayer)',
  web: 'Zoggyfin (Web)',
  mpv: 'Zoggyfin (mpv)',
  exo: 'Zoggyfin (ExoPlayer)',
};

export function buildDeviceProfile(caps: MediaCapabilities, options: ProfileOptions): DeviceProfile {
  if (caps.engine === 'mpv') return mpvProfile(caps, options);
  const join = (xs: readonly string[]) => xs.join(',');
  const directPlay: DirectPlayProfile[] = caps.engine === 'exo' ? exoDirectPlay(caps) : [
    {
      Container: join(caps.containers.filter((c) => c !== 'webm')),
      Type: 'Video',
      VideoCodec: join(caps.videoCodecs.filter((c) => c !== 'vp9')),
      AudioCodec: join(caps.audioCodecs.filter((c) => c !== 'opus')),
    },
  ];
  if (caps.engine !== 'exo' && caps.containers.includes('webm')) {
    directPlay.push({
      Container: 'webm',
      Type: 'Video',
      VideoCodec: join(caps.videoCodecs.filter((c) => c === 'vp9' || c === 'av1')),
      AudioCodec: join(caps.audioCodecs.filter((c) => c === 'opus')),
    });
  }
  for (const codec of caps.audioCodecs) {
    const container = AUDIO_CONTAINERS[codec];
    if (container) directPlay.push({ Container: container, Type: 'Audio', AudioCodec: codec });
  }

  const hlsVideo = caps.hlsVideoCodecs;
  // fMP4 segments carry HEVC; plain h264 uses MPEG-TS, the most compatible HLS form.
  // ExoPlayer always takes MPEG-TS (it reads HEVC there too): a transcode that starts
  // mid-file (resume, a quality change) can give fMP4 a negative `tfdt`, and its
  // fragmented MP4 extractor stops with "Top bit not zero".
  const segmentContainer = caps.engine === 'exo' || !hlsVideo.includes('hevc') ? 'ts' : 'mp4';
  const transcoding: TranscodingProfile[] = [
    {
      Container: segmentContainer,
      Type: 'Video',
      Protocol: 'hls',
      Context: 'Streaming',
      VideoCodec: join(hlsVideo),
      AudioCodec: join(caps.hlsAudioCodecs),
      MaxAudioChannels: String(caps.maxAudioChannels),
      MinSegments: 2,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: 'mp3',
      Type: 'Audio',
      Protocol: 'http',
      Context: 'Streaming',
      AudioCodec: 'mp3',
      MaxAudioChannels: '2',
    },
  ];

  return {
    Name: PROFILE_NAMES[caps.engine],
    MaxStreamingBitrate: options.maxBitrate,
    MaxStaticBitrate: options.maxBitrate,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: transcoding,
    ContainerProfiles: [],
    CodecProfiles: codecProfiles(caps),
    SubtitleProfiles: SUBTITLES,
  };
}
