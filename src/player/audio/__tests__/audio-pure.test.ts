import type { DeviceProfile } from '@/api/types';

import { appleCapabilities, buildDeviceProfile, exoCapabilities, mpvCapabilities, webCapabilities } from '../../device-profile';
import { isLongFormItem, isLongFormLibrary, isLongFormList } from '../long-form';
import { activeLine, fromLyricDto, mayHaveLyrics, parseLrc } from '../lyrics';
import { FINISHED_TAIL_SECONDS, PositionStore, resumeSeconds } from '../positions';
import { formatRemaining, sleepAtEnd, sleepDue, sleepFadeVolume, sleepFor, sleepOff, sleepRemaining } from '../sleep-timer';
import { ANY_AUDIO_CONTAINERS, formatLine, hasCodecInfo, predictPlayMethod, universalAudioUrl, universalContainers } from '../stream-url';

const min = (m: number) => m * 60 * 10_000_000;

describe('long-form detection', () => {
  it('audiobooks, long items and spoken genres are long-form', () => {
    expect(isLongFormItem({ Type: 'AudioBook', RunTimeTicks: min(3) })).toBe(true);
    expect(isLongFormItem({ Type: 'Audio', RunTimeTicks: min(20) })).toBe(true);
    expect(isLongFormItem({ Type: 'Audio', RunTimeTicks: min(19) })).toBe(false);
    expect(isLongFormItem({ Type: 'Audio', RunTimeTicks: min(4), Genres: ['Spoken Word'] })).toBe(true);
    expect(isLongFormItem({ Type: 'Audio', RunTimeTicks: min(4), Genres: ['Rock'] })).toBe(false);
  });

  it('books libraries are long-form', () => {
    expect(isLongFormLibrary({ CollectionType: 'books' })).toBe(true);
    expect(isLongFormLibrary({ CollectionType: 'music' })).toBe(false);
    expect(isLongFormList([{ RunTimeTicks: min(3) }], null, { CollectionType: 'books' })).toBe(true);
  });

  it('an album of long tracks (median 10 min or more) is long-form; a song album is not', () => {
    const lectures = [7, 9, 11, 12, 14, 21].map((m) => ({ Type: 'Audio', RunTimeTicks: min(m) }));
    const songs = [3, 4, 4, 5, 22].map((m) => ({ Type: 'Audio', RunTimeTicks: min(m) }));
    expect(isLongFormList(lectures)).toBe(true);
    expect(isLongFormList(songs)).toBe(false);
    expect(isLongFormList([{ RunTimeTicks: min(45) }])).toBe(true);
    expect(isLongFormList([{ RunTimeTicks: min(5) }])).toBe(false);
    expect(isLongFormList(songs, { Type: 'MusicAlbum', Genres: ['Recitation'] })).toBe(true);
  });
});

describe('lyrics', () => {
  it('asks for lyrics only when the item can have them', () => {
    expect(mayHaveLyrics({ HasLyrics: false })).toBe(false);
    expect(mayHaveLyrics({ HasLyrics: true })).toBe(true);
    expect(mayHaveLyrics({ HasLyrics: false, MediaSources: [{ MediaStreams: [{ Type: 'Audio' }, { Type: 'Lyric' }] }] })).toBe(true);
    // Unknown (an old saved queue): ask.
    expect(mayHaveLyrics({})).toBe(true);
  });

  it('reads the server answer, sorted, with seconds', () => {
    const l = fromLyricDto({ Lyrics: [{ Text: 'two', Start: 50_000_000 }, { Text: 'one', Start: 10_000_000 }, { Text: '', Start: 70_000_000 }] });
    expect(l?.synced).toBe(true);
    expect(l?.lines.map((x) => [x.text, x.start])).toEqual([
      ['one', 1],
      ['two', 5],
    ]);
  });

  it('plain lyrics when a line has no start, null when empty', () => {
    expect(fromLyricDto({ Lyrics: [{ Text: 'a' }, { Text: 'b', Start: 10 }] })?.synced).toBe(false);
    expect(fromLyricDto({ Lyrics: [] })).toBeNull();
    expect(fromLyricDto(null)).toBeNull();
    expect(fromLyricDto({ Lyrics: [{ Text: '  ' }] })).toBeNull();
  });

  it('parses LRC: several tags per line, fractions, metadata and offset', () => {
    const l = parseLrc('[ar:Someone]\n[ti:Song]\n[offset:+500]\n[00:01.50]Hello\n[00:10.00][00:20.5]Chorus\n[01:02.123]Bye\n');
    expect(l?.synced).toBe(true);
    expect(l?.lines.map((x) => [x.text, x.start])).toEqual([
      ['Hello', 1],
      ['Chorus', 9.5],
      ['Chorus', 20],
      ['Bye', 61.623],
    ]);
  });

  it('parses text without tags as plain lyrics, keeping Arabic text as is', () => {
    const l = parseLrc('بسم الله\r\nسطر ثان');
    expect(l).toEqual({ synced: false, lines: [{ text: 'بسم الله', start: null }, { text: 'سطر ثان', start: null }] });
  });

  it('finds the active line', () => {
    const l = parseLrc('[00:01]a\n[00:05]b\n[00:09]c');
    expect(activeLine(l, 0)).toBe(-1);
    expect(activeLine(l, 1)).toBe(0);
    expect(activeLine(l, 4.99)).toBe(1); // within 50 ms counts as started
    expect(activeLine(l, 5.5)).toBe(1);
    expect(activeLine(l, 100)).toBe(2);
    expect(activeLine(parseLrc('plain'), 3)).toBe(-1);
    expect(activeLine(null, 3)).toBe(-1);
  });
});

describe('sleep timer', () => {
  it('a minutes timer counts down, fades and is due at the end', () => {
    const t = sleepFor(15, 1_000);
    expect(sleepRemaining(t, 1_000)).toBe(15 * 60_000);
    expect(sleepDue(t, { now: 1_000 + 15 * 60_000 - 1, itemKey: 'a', position: 0, trackEnded: false })).toBe(false);
    expect(sleepDue(t, { now: 1_000 + 15 * 60_000, itemKey: 'a', position: 0, trackEnded: false })).toBe(true);
    expect(sleepFadeVolume(t, 1_000)).toBe(1);
    expect(sleepFadeVolume(t, 1_000 + 15 * 60_000 - 5_000)).toBeCloseTo(0.5);
    expect(sleepRemaining(sleepOff, 0)).toBeNull();
    expect(sleepDue(sleepOff, { now: 9e12, itemKey: null, position: 0, trackEnded: true })).toBe(false);
  });

  it('end of track is due when the track ends or the queue moves on', () => {
    const t = sleepAtEnd('k1', null);
    expect(sleepDue(t, { now: 0, itemKey: 'k1', position: 100, trackEnded: false })).toBe(false);
    expect(sleepDue(t, { now: 0, itemKey: 'k1', position: 100, trackEnded: true })).toBe(true);
    expect(sleepDue(t, { now: 0, itemKey: 'k2', position: 0, trackEnded: false })).toBe(true);
  });

  it('end of chapter is due at the chapter end', () => {
    const t = sleepAtEnd('k1', 600);
    expect(sleepDue(t, { now: 0, itemKey: 'k1', position: 599, trackEnded: false })).toBe(false);
    expect(sleepDue(t, { now: 0, itemKey: 'k1', position: 599.8, trackEnded: false })).toBe(true);
  });

  it('formats the remaining time, rounded up', () => {
    expect(formatRemaining(28 * 60_000)).toBe('28:00');
    expect(formatRemaining(59_001)).toBe('1:00');
    expect(formatRemaining(1)).toBe('0:01');
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
  });
});

describe('positions', () => {
  const memoryKv = () => {
    const m = new Map<string, string>();
    return { getString: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k), clearAll: () => m.clear() };
  };

  it('saves, forgets finished items and reloads from storage', () => {
    const kv = memoryKv();
    const p = new PositionStore(kv);
    p.save('a', 120, 3600, 1);
    expect(p.get('a')?.seconds).toBe(120);
    expect(new PositionStore(kv).get('a')?.seconds).toBe(120);
    p.save('a', 3600 - FINISHED_TAIL_SECONDS + 1, 3600, 2);
    expect(p.get('a')).toBeNull();
    p.save('b', 3, 3600);
    expect(p.get('b')).toBeNull();
  });

  it('keeps at most MAX_POSITIONS, dropping the oldest', () => {
    const p = new PositionStore(memoryKv());
    for (let i = 0; i < 405; i++) p.save(`i${i}`, 100, 1000, i);
    expect(p.get('i0')).toBeNull();
    expect(p.get('i404')?.seconds).toBe(100);
  });

  it('resumes at the later position unless nearly finished', () => {
    expect(resumeSeconds({ seconds: 300, duration: 3600, at: 0 }, 120, 3600)).toBe(300);
    expect(resumeSeconds(null, 500, 3600)).toBe(500);
    expect(resumeSeconds(null, 5, 3600)).toBe(0);
    expect(resumeSeconds(null, 3590, 3600)).toBe(0);
  });
});

describe('audio stream URL', () => {
  const server = { baseUrl: 'http://jellyfin.example.lan:8096/', token: 'tok', deviceId: 'dev1' };
  const apple = buildDeviceProfile(appleCapabilities({ av1: false, hevc: true }), { maxBitrate: 200_000_000 });

  it('lists our direct-play audio containers', () => {
    expect(universalContainers(apple)).toBe('aac,m4a|aac,m4b|aac,mp3,flac,m4a|alac,m4b|alac');
  });

  it('builds the universal URL with the profile, the session and ApiKey auth', () => {
    const url = universalAudioUrl(server, 'item1', apple, { userId: 'u1', maxBitrate: 200_000_000, playSessionId: 'ps1' });
    expect(url.startsWith('http://jellyfin.example.lan:8096/Audio/item1/universal?')).toBe(true);
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('UserId')).toBe('u1');
    expect(q.get('DeviceId')).toBe('dev1');
    expect(q.get('Container')).toBe('aac,m4a|aac,m4b|aac,mp3,flac,m4a|alac,m4b|alac');
    expect(q.get('TranscodingContainer')).toBe('mp3');
    expect(q.get('TranscodingProtocol')).toBe('http');
    expect(q.get('AudioCodec')).toBe('mp3');
    expect(q.get('PlaySessionId')).toBe('ps1');
    expect(q.get('EnableRedirection')).toBe('true');
    expect(q.get('ApiKey')).toBe('tok');
    expect(q.get('api_key')).toBeNull();
    expect(q.get('StartTimeTicks')).toBeNull();
    expect(universalAudioUrl(server, 'i', apple, { userId: 'u', maxBitrate: 1, playSessionId: 'p', startTicks: 50 })).toContain('StartTimeTicks=50');
  });

  it('predicts direct play or transcode from the file and the profile', () => {
    const mp3 = { MediaSources: [{ Container: 'mp3', Bitrate: 128_000, MediaStreams: [{ Type: 'Audio', Codec: 'mp3' }] }] };
    const ogg = { MediaSources: [{ Container: 'ogg', MediaStreams: [{ Type: 'Audio', Codec: 'vorbis' }] }] };
    expect(predictPlayMethod(mp3, apple, 200_000_000)).toBe('DirectPlay');
    expect(predictPlayMethod(ogg, apple, 200_000_000)).toBe('Transcode');
    expect(predictPlayMethod(mp3, apple, 64_000)).toBe('Transcode');
    expect(predictPlayMethod({}, apple, 1)).toBe('DirectPlay');
    const web = buildDeviceProfile(
      webCapabilities({ canPlay: (m) => m === 'audio/mpeg' || m.includes('avc1'), canMse: () => false, nativeHls: false }),
      { maxBitrate: 1e8 },
    );
    const flac = { Container: 'flac', MediaStreams: [{ Type: 'Audio', Codec: 'flac' }] };
    expect(predictPlayMethod(flac, web, 1e8)).toBe('Transcode');
  });

  it('describes the format', () => {
    expect(formatLine({ MediaSources: [{ Container: 'mp3', MediaStreams: [{ Type: 'Audio', Codec: 'mp3', BitRate: 128_000 }] }] })).toBe('MP3 · 128 kbps');
    const flac = { MediaStreams: [{ Type: 'Audio', Codec: 'flac', BitDepth: 24, SampleRate: 96_000 }] } as unknown as Parameters<typeof formatLine>[0];
    expect(formatLine(flac)).toBe('FLAC · 24/96');
    expect(formatLine({})).toBeNull();
  });

  it('profile without audio entries gives an empty container list', () => {
    expect(universalContainers({ DirectPlayProfiles: [] } as DeviceProfile)).toBe('');
  });

  describe('an audio entry with no container (libmpv: any container)', () => {
    const mpv = buildDeviceProfile(mpvCapabilities(), { maxBitrate: 200_000_000 });
    const m4a = { MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', MediaStreams: [{ Type: 'Audio', Codec: 'aac' }] }] };

    it('sends an explicit broad container list, never an empty one', () => {
      const list = universalContainers(mpv).split(',');
      expect(list).toEqual([...ANY_AUDIO_CONTAINERS]);
      for (const c of ['mp3', 'm4a', 'mov', 'mp4', 'flac', 'ogg', 'opus', 'wav', 'wma', 'ape', 'dsf']) expect(list).toContain(c);
      const url = universalAudioUrl(server, 'item1', mpv, { userId: 'u1', maxBitrate: 200_000_000, playSessionId: 'ps1' });
      expect(new URLSearchParams(url.split('?')[1]).get('Container')).toBe(ANY_AUDIO_CONTAINERS.join(','));
    });

    it('predicts direct play for any file', () => {
      expect(predictPlayMethod(m4a, mpv, 200_000_000)).toBe('DirectPlay');
      const ogg = { MediaSources: [{ Container: 'ogg', MediaStreams: [{ Type: 'Audio', Codec: 'vorbis' }] }] };
      expect(predictPlayMethod(ogg, mpv, 200_000_000)).toBe('DirectPlay');
      expect(predictPlayMethod({ Container: 'dsf' }, mpv, 200_000_000)).toBe('DirectPlay');
      // The bitrate limit still applies.
      expect(predictPlayMethod({ MediaSources: [{ Container: 'flac', Bitrate: 900_000 }] }, mpv, 320_000)).toBe('Transcode');
    });
  });

  it('keeps the apple and exo container lists as they were', () => {
    expect(universalContainers(apple)).toBe('aac,m4a|aac,m4b|aac,mp3,flac,m4a|alac,m4b|alac');
    const exo = buildDeviceProfile(exoCapabilities(null), { maxBitrate: 200_000_000 });
    expect(universalContainers(exo)).toBe('aac,m4a|aac,m4b|aac,mp3,flac,ogg|opus,opus,webm|opus');
  });

  it('matches a file container list on any of its names, like the server', () => {
    // Jellyfin reports an .m4a file as "mov,mp4,m4a,3gp,3g2,mj2"; the apple profile lists m4a.
    const m4a = { MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', MediaStreams: [{ Type: 'Audio', Codec: 'aac' }] }] };
    expect(predictPlayMethod(m4a, apple, 200_000_000)).toBe('DirectPlay');
    const alac = { MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', MediaStreams: [{ Type: 'Audio', Codec: 'alac' }] }] };
    expect(predictPlayMethod(alac, apple, 200_000_000)).toBe('DirectPlay');
    const exo = buildDeviceProfile(exoCapabilities(null), { maxBitrate: 200_000_000 });
    expect(predictPlayMethod(alac, exo, 200_000_000)).toBe('Transcode');
  });

  it('shows the codec, and M4A rather than MOV when only the container is known', () => {
    const m4a = { MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', Bitrate: 256_000, MediaStreams: [{ Type: 'Audio', Codec: 'aac', BitRate: 256_000 }] }] };
    expect(formatLine(m4a)).toBe('AAC · 256 kbps');
    expect(formatLine({ Container: 'mov,mp4,m4a,3gp,3g2,mj2' })).toBe('M4A');
    expect(formatLine({ Container: 'flac' })).toBe('FLAC');
    expect(hasCodecInfo(m4a)).toBe(true);
    expect(hasCodecInfo({ Container: 'mov,mp4,m4a,3gp,3g2,mj2' })).toBe(false);
  });
});
