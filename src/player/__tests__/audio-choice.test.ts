import type { MediaStream } from '@/api/types';

import { engineAudioId, playableAudioInstead, playingAudioIndex } from '../audio-choice';
import type { EmbeddedTrack, EmbeddedTracks } from '../engine-types';
import type { MediaSource } from '../stream';

/** A TV with a Dolby Digital decoder and no TrueHD or DTS (exoCapabilities). */
const tv = { codecs: ['aac', 'mp3', 'flac', 'opus', 'ac3', 'eac3'], maxChannels: 6 };

const video: MediaStream = { Type: 'Video', Index: 0, Codec: 'hevc' };

/** A 4K Blu-ray remux: TrueHD Atmos by default, a Dolby Digital compatibility track and a commentary. */
function remux(audio: MediaStream[], extra: Partial<MediaSource> = {}): MediaSource {
  return { Id: 'src', SupportsDirectPlay: false, DefaultAudioStreamIndex: audio[0]?.Index, MediaStreams: [video, ...audio], ...extra };
}

const trueHd: MediaStream = { Type: 'Audio', Index: 1, Codec: 'truehd', Channels: 8, Language: 'eng', DisplayTitle: 'Dolby Atmos Mix - English - Dolby TrueHD + Dolby Atmos - 7.1 - Default' };
const compat: MediaStream = { Type: 'Audio', Index: 2, Codec: 'ac3', Channels: 6, Language: 'eng', DisplayTitle: 'Compatibility Track - English - Dolby Digital - 5.1' };
const commentary: MediaStream = { Type: 'Audio', Index: 3, Codec: 'flac', Channels: 2, Language: 'eng', DisplayTitle: 'Commentary by the director - English - FLAC - Stereo' };

const audioOnly = ['AudioCodecNotSupported', 'AudioChannelsNotSupported'];

describe('playableAudioInstead', () => {
  it('picks the compatibility track when only the audio stops the file playing as it is', () => {
    expect(playableAudioInstead(remux([trueHd, compat, commentary]), audioOnly, tv)).toBe(2);
  });

  it('keeps the server answer when a video reason needs a stream anyway', () => {
    expect(playableAudioInstead(remux([trueHd, compat]), ['AudioCodecNotSupported', 'VideoRangeTypeNotSupported'], tv)).toBeNull();
    expect(playableAudioInstead(remux([trueHd, compat]), ['ContainerBitrateExceedsLimit'], tv)).toBeNull();
  });

  it('does nothing for a file that plays as it is, or with no reasons', () => {
    expect(playableAudioInstead(remux([trueHd, compat], { SupportsDirectPlay: true }), audioOnly, tv)).toBeNull();
    expect(playableAudioInstead(remux([trueHd, compat]), [], tv)).toBeNull();
  });

  it('never swaps to another language', () => {
    const french: MediaStream = { ...compat, Language: 'fre', DisplayTitle: 'French - Dolby Digital - 5.1' };
    expect(playableAudioInstead(remux([trueHd, french]), audioOnly, tv)).toBeNull();
  });

  it('never picks a commentary or a described track', () => {
    const described: MediaStream = { Type: 'Audio', Index: 4, Codec: 'ac3', Channels: 2, Language: 'eng', Title: 'Descriptive Audio' };
    expect(playableAudioInstead(remux([trueHd, commentary, described]), audioOnly, tv)).toBeNull();
  });

  it('skips a track the device cannot play and prefers more channels', () => {
    const dts: MediaStream = { Type: 'Audio', Index: 5, Codec: 'dts', Channels: 6, Language: 'eng' };
    const stereo: MediaStream = { Type: 'Audio', Index: 6, Codec: 'aac', Channels: 2, Language: 'eng' };
    expect(playableAudioInstead(remux([trueHd, dts, stereo, compat]), audioOnly, tv)).toBe(2);
    expect(playableAudioInstead(remux([trueHd, dts, stereo]), audioOnly, tv)).toBe(6);
    // Too many channels for the device.
    const eac3Eight: MediaStream = { Type: 'Audio', Index: 7, Codec: 'eac3', Channels: 8, Language: 'eng' };
    expect(playableAudioInstead(remux([trueHd, eac3Eight]), audioOnly, tv)).toBeNull();
  });

  it('starts from the default track, not the first one', () => {
    const first: MediaStream = { ...compat, Index: 1 };
    const def: MediaStream = { ...trueHd, Index: 2 };
    expect(playableAudioInstead(remux([first, def], { DefaultAudioStreamIndex: 2 }), audioOnly, tv)).toBe(1);
  });

  it('matches a track with no language only to another with no language', () => {
    const noLang = { ...trueHd, Language: null };
    expect(playableAudioInstead(remux([noLang, { ...compat, Language: 'und' }]), audioOnly, tv)).toBe(2);
    expect(playableAudioInstead(remux([noLang, compat]), audioOnly, tv)).toBeNull();
  });

  it('compares codecs and languages without case', () => {
    expect(playableAudioInstead(remux([trueHd, { ...compat, Codec: 'AC3', Language: 'ENG' }]), audioOnly, tv)).toBe(2);
  });
});

/** ExoPlayer's list of the same file: its own ids, in file order. */
function engineList(count: number, playing: number | null): EmbeddedTracks {
  const audio: EmbeddedTrack[] = Array.from({ length: count }, (_, i) => ({ id: `a${i}`, title: null, language: 'en', codec: null, isDefault: i === 0, isForced: false }));
  return { audio, subtitles: [], audioId: playing === null ? null : `a${playing}`, subtitleId: null };
}

const serverAudio = [{ index: 1 }, { index: 2 }, { index: 3 }];

describe('playingAudioIndex', () => {
  it('names the server track the engine plays, by position', () => {
    // The TV decodes TrueHD itself: ExoPlayer plays the Atmos track, not the compatibility track asked for.
    expect(playingAudioIndex(serverAudio, engineList(3, 0))).toBe(1);
    expect(playingAudioIndex(serverAudio, engineList(3, 1))).toBe(2);
  });

  it('says nothing when the lists differ or nothing is selected', () => {
    expect(playingAudioIndex(serverAudio, engineList(2, 0))).toBeNull();
    expect(playingAudioIndex(serverAudio, engineList(3, null))).toBeNull();
    expect(playingAudioIndex([], engineList(0, null))).toBeNull();
  });
});

describe('engineAudioId', () => {
  it('finds the engine id of a server track, by position', () => {
    expect(engineAudioId(serverAudio, engineList(3, 0), 2)).toBe('a1');
    expect(engineAudioId(serverAudio, engineList(3, 0), 3)).toBe('a2');
  });

  it('gives null for an unknown track or lists that differ, so the server makes a stream as before', () => {
    expect(engineAudioId(serverAudio, engineList(3, 0), 9)).toBeNull();
    expect(engineAudioId(serverAudio, engineList(2, 0), 2)).toBeNull();
  });
});
