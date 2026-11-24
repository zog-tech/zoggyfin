/**
 * A playable audio track in place of a default one this device cannot play.
 *
 * A Blu-ray remux often has a Dolby TrueHD or DTS-HD default track and a
 * Dolby Digital "compatibility" track in the same language. With the default
 * track, the server cannot send the file as it is and makes a stream instead.
 * For a 4K HDR film that meant converting the whole picture on the server's
 * CPU (to H.264, with the HDR toned down), slower than real time on a NAS: the
 * film stopped to buffer, then failed. With the compatibility track the file
 * plays as it is.
 *
 * The rules: only when every reason the server gave is about the audio (a
 * video reason needs a stream anyway); a track in the same language as the
 * default one, never a commentary or a described track; a codec and channel
 * count the device plays; the most channels first, then file order.
 *
 * Pure, so it is unit-tested. The session asks the server again with the
 * track and keeps the answer only if the file then plays as it is.
 *
 * ExoPlayer would then play the best track it can decode, which may still be
 * the default one (a TV that decodes TrueHD in its own audio chip), and
 * expo-video names no track until one is set, so the menu could not tell.
 * The session sets the track asked for in the engine (`engineAudioId`), the
 * menu then follows the engine (`playingAudioIndex`), and a choice in the
 * menu switches inside the file instead of asking the server for a stream.
 * The engine lists the file's audio tracks in file order, like the server, so
 * the two lists match by position, and only when they have the same length.
 */
import type { MediaStream } from '@/api/types';

import type { EmbeddedTracks } from './engine-types';
import type { MediaSource } from './stream';

/** The server's transcode reasons that are about the audio alone. */
const AUDIO_REASONS = new Set([
  'AudioCodecNotSupported',
  'AudioChannelsNotSupported',
  'AudioProfileNotSupported',
  'AudioSampleRateNotSupported',
  'AudioBitDepthNotSupported',
  'AudioBitrateNotSupported',
  'UnknownAudioStreamInfo',
]);

/** Commentary and described tracks: never a stand-in for the main track. */
const EXTRA_TRACK = /commentary|descriptive|description|narrat/i;

/** ISO 639 codes the server uses for "no language". */
const NO_LANGUAGE = new Set(['', 'und', 'unk', 'mis', 'zxx']);

function language(s: MediaStream): string {
  return (s.Language ?? '').trim().toLowerCase();
}

function isExtra(s: MediaStream): boolean {
  return EXTRA_TRACK.test(`${s.Title ?? ''} ${s.DisplayTitle ?? ''}`);
}

export interface AudioAbility {
  /** Audio codecs the device plays in a file as it is (lower case, Jellyfin names). */
  codecs: readonly string[];
  maxChannels: number;
}

/**
 * The stream index of a track to ask for instead of the default one, or null
 * to keep the server's answer. `reasons` are the server's `TranscodeReasons`.
 */
export function playableAudioInstead(source: MediaSource, reasons: readonly string[], ability: AudioAbility): number | null {
  if (source.SupportsDirectPlay) return null;
  if (!reasons.length || reasons.some((r) => !AUDIO_REASONS.has(r))) return null;
  const audio = (source.MediaStreams ?? []).filter((s) => s.Type === 'Audio' && typeof s.Index === 'number');
  const current = audio.find((s) => s.Index === source.DefaultAudioStreamIndex) ?? audio[0];
  if (!current) return null;
  const codecs = new Set(ability.codecs.map((c) => c.toLowerCase()));
  const plays = (s: MediaStream) => !!s.Codec && codecs.has(s.Codec.toLowerCase()) && (s.Channels ?? 2) <= ability.maxChannels;
  const lang = language(current);
  const sameLanguage = (s: MediaStream) => (NO_LANGUAGE.has(lang) ? NO_LANGUAGE.has(language(s)) : language(s) === lang);
  const candidates = audio.filter((s) => s !== current && plays(s) && sameLanguage(s) && !isExtra(s));
  if (!candidates.length) return null;
  // The most channels first; `filter` keeps file order for a tie, and `sort` is stable.
  const best = [...candidates].sort((a, b) => (b.Channels ?? 2) - (a.Channels ?? 2))[0];
  return best.Index ?? null;
}

/** The server's audio tracks of the file, in file order (the plan's `audio`). */
type ServerAudio = readonly { index: number }[];

/** The server's index of the audio track the engine plays, or null when the lists do not match. */
export function playingAudioIndex(audio: ServerAudio, tracks: EmbeddedTracks): number | null {
  if (!tracks.audioId || !audio.length || tracks.audio.length !== audio.length) return null;
  const pos = tracks.audio.findIndex((t) => t.id === tracks.audioId);
  return pos >= 0 ? (audio[pos]?.index ?? null) : null;
}

/** The engine's id of the server's audio track `index`, or null when the lists do not match. */
export function engineAudioId(audio: ServerAudio, tracks: EmbeddedTracks, index: number): string | null {
  if (!audio.length || tracks.audio.length !== audio.length) return null;
  const pos = audio.findIndex((a) => a.index === index);
  return pos >= 0 ? (tracks.audio[pos]?.id ?? null) : null;
}
