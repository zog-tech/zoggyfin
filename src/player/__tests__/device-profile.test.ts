import type { CodecProfile, DeviceProfile } from '@/api/types';

import {
  type AndroidDecoders,
  appleCapabilities,
  buildDeviceProfile,
  exoCapabilities,
  mpvCapabilities,
  webCapabilities,
} from '../device-profile';

const opts = { maxBitrate: 20_000_000 };

function videoDirect(p: DeviceProfile) {
  return (p.DirectPlayProfiles ?? []).filter((d) => d.Type === 'Video');
}
function codec(p: DeviceProfile, name: string): CodecProfile | undefined {
  return (p.CodecProfiles ?? []).find((c) => c.Codec === name);
}

describe('Apple device profile', () => {
  const noAv1 = buildDeviceProfile(appleCapabilities({ av1: false, hevc: true }), opts);
  const av1 = buildDeviceProfile(appleCapabilities({ av1: true, hevc: true }), opts);

  it('direct plays mp4, m4v and mov with h264 and hevc', () => {
    const [dp] = videoDirect(noAv1);
    expect(dp?.Container).toBe('mp4,m4v,mov');
    expect(dp?.VideoCodec).toBe('h264,hevc');
    expect(dp?.AudioCodec).toBe('aac,ac3,eac3,mp3,flac,alac');
  });

  it('lists AV1 only with a hardware decoder', () => {
    expect(videoDirect(noAv1)[0]?.VideoCodec).not.toContain('av1');
    expect(videoDirect(av1)[0]?.VideoCodec).toContain('av1');
    expect(codec(noAv1, 'av1')).toBeUndefined();
    expect(codec(av1, 'av1')).toBeDefined();
  });

  it('excludes Dolby Vision profile 5 and requires the hvc1 tag for hevc', () => {
    const hevc = codec(noAv1, 'hevc');
    const range = hevc?.Conditions?.find((c) => c.Property === 'VideoRangeType')?.Value ?? '';
    expect(range.split('|')).not.toContain('DOVI');
    expect(range.split('|')).toContain('DOVIWithHDR10');
    const tag = hevc?.Conditions?.find((c) => c.Property === 'VideoCodecTag');
    expect(tag).toMatchObject({ Condition: 'EqualsAny', Value: 'hvc1|dvh1', IsRequired: true });
  });

  it('transcodes to HLS with fMP4 segments, hevc first', () => {
    const t = (noAv1.TranscodingProfiles ?? []).find((x) => x.Type === 'Video');
    expect(t).toMatchObject({ Protocol: 'hls', Container: 'mp4', Context: 'Streaming', VideoCodec: 'hevc,h264' });
  });

  it('uses MPEG-TS segments when the device has no HEVC', () => {
    const p = buildDeviceProfile(appleCapabilities({ av1: false, hevc: false }), opts);
    expect((p.TranscodingProfiles ?? [])[0]).toMatchObject({ Container: 'ts', VideoCodec: 'h264' });
  });

  it('carries the bitrate limit', () => {
    expect(noAv1.MaxStreamingBitrate).toBe(20_000_000);
    expect(noAv1.MaxStaticBitrate).toBe(20_000_000);
  });

  it('delivers text subtitles as external WebVTT and burns in image subtitles', () => {
    const subs = noAv1.SubtitleProfiles ?? [];
    expect(subs).toContainEqual({ Format: 'vtt', Method: 'External' });
    for (const f of ['pgssub', 'dvdsub', 'dvbsub']) expect(subs).toContainEqual({ Format: f, Method: 'Encode' });
  });

  it('does not reject anamorphic video', () => {
    const all = (noAv1.CodecProfiles ?? []).flatMap((c) => c.Conditions ?? []);
    expect(all.some((c) => c.Property === 'IsAnamorphic')).toBe(false);
  });
});

describe('web device profile', () => {
  const chrome = webCapabilities({
    canPlay: (m) => /avc1|mp4a|audio\/mpeg|vp09|av01|webm|opus|flac/.test(m),
    canMse: (m) => /avc1|mp4a|hvc1/.test(m),
    nativeHls: false,
  });
  const safari = webCapabilities({
    canPlay: (m) => /avc1|hvc1|mp4a|audio\/mpeg|ac-3|ec-3|flac|alac|mpegurl/.test(m),
    canMse: () => true,
    nativeHls: true,
  });

  it('probes direct-play codecs from the browser', () => {
    expect(chrome.videoCodecs).toEqual(['h264', 'av1', 'vp9']);
    expect(chrome.containers).toContain('webm');
    expect(safari.videoCodecs).toEqual(['h264', 'hevc']);
  });

  it('uses hls.js codecs when the browser has no native HLS', () => {
    expect(chrome.hls).toBe(true);
    expect(chrome.hlsVideoCodecs).toEqual(['hevc', 'h264']);
    expect(chrome.maxAudioChannels).toBe(2);
  });

  it('builds a webm direct-play entry for VP9 and AV1', () => {
    const p = buildDeviceProfile(chrome, opts);
    const webm = (p.DirectPlayProfiles ?? []).find((d) => d.Container === 'webm');
    expect(webm?.VideoCodec).toBe('av1,vp9');
    expect(webm?.AudioCodec).toBe('opus');
  });

  it('falls back to h264 when nothing probes', () => {
    const none = webCapabilities({ canPlay: () => false, canMse: () => false, nativeHls: false });
    expect(none.videoCodecs).toEqual(['h264']);
    expect(none.hls).toBe(false);
  });
});

describe('mpv device profile (desktop app)', () => {
  const profile = buildDeviceProfile(mpvCapabilities(), { maxBitrate: 120_000_000 });

  it('direct plays every container and codec', () => {
    expect(profile.DirectPlayProfiles).toEqual([{ Type: 'Video' }, { Type: 'Audio' }]);
    expect(profile.CodecProfiles).toEqual([]);
  });

  it('keeps text and image subtitles in the file', () => {
    const embed = (profile.SubtitleProfiles ?? []).filter((p) => p.Method === 'Embed').map((p) => p.Format);
    expect(embed).toEqual(expect.arrayContaining(['ass', 'srt', 'subrip', 'pgssub', 'dvdsub']));
    expect((profile.SubtitleProfiles ?? []).some((p) => p.Method === 'Encode')).toBe(false);
  });

  it('carries the bitrate limit and an HLS fallback', () => {
    expect(profile.MaxStaticBitrate).toBe(120_000_000);
    expect(profile.TranscodingProfiles?.[0]?.Protocol).toBe('hls');
  });
});

describe('ExoPlayer device profile (Android)', () => {
  const d = (hardware: boolean, maxLevel = 0, tenBit = false) => ({ hardware, software: !hardware, maxLevel, tenBit });
  /** A 2017 phone: HEVC and VP9 in hardware, no AV1, an HDR10 display, no Dolby audio. */
  const phone: AndroidDecoders = {
    codecs: { h264: d(true, 52), hevc: d(true, 153, true), vp9: d(true), av1: undefined, aac: d(false), mp3: d(false), flac: d(false), opus: d(false) },
    hdr: ['hdr10', 'hlg'],
    sdk: 28,
  };
  const profile = buildDeviceProfile(exoCapabilities(phone), opts);

  it('direct plays mp4 and mkv with the hardware video codecs', () => {
    const [mp4, mkv, webm] = videoDirect(profile);
    expect(mp4).toMatchObject({ Container: 'mp4,m4v,mov', VideoCodec: 'h264,hevc', AudioCodec: 'aac,mp3,flac' });
    expect(mkv).toMatchObject({ Container: 'mkv', VideoCodec: 'h264,hevc,vp9', AudioCodec: 'aac,mp3,flac,opus' });
    expect(webm).toMatchObject({ Container: 'webm', VideoCodec: 'vp9', AudioCodec: 'opus' });
    expect(profile.Name).toBe('Zoggyfin (ExoPlayer)');
  });

  it('leaves out AV1 and Dolby audio with no decoder', () => {
    const all = videoDirect(profile).map((p) => `${p.VideoCodec} ${p.AudioCodec}`).join(' ');
    expect(all).not.toMatch(/av1|ac3|eac3/);
    expect(profile.TranscodingProfiles?.[0]?.AudioCodec).toBe('aac,mp3');
  });

  it('uses the decoder levels and the HDR types of the display', () => {
    const h264 = codec(profile, 'h264')?.Conditions?.find((c) => c.Property === 'VideoLevel');
    expect(h264?.Value).toBe('52');
    const hevc = codec(profile, 'hevc');
    expect(hevc?.Conditions?.find((c) => c.Property === 'VideoLevel')?.Value).toBe('153');
    const ranges = (hevc?.Conditions?.find((c) => c.Property === 'VideoRangeType')?.Value ?? '').split('|');
    expect(ranges).toEqual(expect.arrayContaining(['SDR', 'HDR10', 'HLG', 'DOVIWithHDR10']));
    expect(ranges).not.toContain('DOVI');
    expect(ranges).not.toContain('HDR10Plus');
    // No hvc1 rule: ExoPlayer plays hev1 too.
    expect(hevc?.Conditions?.some((c) => c.Property === 'VideoCodecTag')).toBe(false);
  });

  it('direct plays AV1 with a Dolby Vision layer on a 10-bit decoder and an HDR display', () => {
    const tv = buildDeviceProfile(exoCapabilities({ ...phone, codecs: { ...phone.codecs, av1: d(true, 0, true) } }), opts);
    const av1 = codec(tv, 'av1');
    const ranges = (av1?.Conditions?.find((c) => c.Property === 'VideoRangeType')?.Value ?? '').split('|');
    expect(ranges).toEqual(expect.arrayContaining(['SDR', 'HDR10', 'HLG', 'DOVIWithHDR10', 'DOVIWithSDR']));
    expect(ranges).not.toContain('DOVI');
    // An 8-bit-only AV1 decoder (or an older build with no report): SDR only.
    const eight = exoCapabilities({ ...phone, codecs: { ...phone.codecs, av1: d(true) } });
    expect(eight.av1Ranges).toBe('SDR|DOVIWithSDR');
  });

  it('adds AC3 and E-AC3 when the device decodes them', () => {
    const dolby = exoCapabilities({ ...phone, codecs: { ...phone.codecs, ac3: d(false), eac3: d(false) } });
    expect(dolby.audioCodecs).toEqual(expect.arrayContaining(['ac3', 'eac3']));
    expect(dolby.hlsAudioCodecs).toEqual(['aac', 'mp3', 'ac3', 'eac3']);
  });

  it('is conservative with no decoder report (a build without the native module)', () => {
    const caps = exoCapabilities(null);
    expect(caps.videoCodecs).toEqual(['h264', 'hevc']);
    expect(caps.hevcRanges).toBe('SDR|DOVIWithSDR');
    expect(caps.hevcTenBit).toBe(false);
    const p = buildDeviceProfile(caps, opts);
    expect(codec(p, 'hevc')?.Conditions?.find((c) => c.Property === 'VideoBitDepth')?.Value).toBe('8');
    expect(p.TranscodingProfiles?.[0]).toMatchObject({ Container: 'ts', Protocol: 'hls', VideoCodec: 'hevc,h264' });
  });

  it('transcodes to HLS with MPEG-TS segments, also for hevc (fMP4 can start with a negative tfdt)', () => {
    const p = buildDeviceProfile(exoCapabilities(phone), opts);
    const t = (p.TranscodingProfiles ?? []).find((x) => x.Type === 'Video');
    expect(t).toMatchObject({ Protocol: 'hls', Container: 'ts', VideoCodec: 'hevc,h264' });
  });
});
