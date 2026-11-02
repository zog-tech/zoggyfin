import type { MediaSource } from '../stream';
import {
  codecLabel,
  formatBitrate,
  originalVideo,
  playingVideo,
  resolutionLabel,
  transcodeReasonText,
  transcodeTarget,
  videoDetail,
  videoSummary,
} from '../stream-info';

const uhd: MediaSource = {
  Id: 'src1',
  Bitrate: 30_000_000,
  MediaStreams: [
    { Type: 'Audio', Index: 0 },
    { Type: 'Video', Index: 1, Width: 3840, Height: 1600, BitRate: 25_000_000, Codec: 'hevc', RealFrameRate: 23.976 },
  ],
};

describe('originalVideo', () => {
  it('reads the video stream of the file', () => {
    expect(originalVideo(uhd)).toEqual({ width: 3840, height: 1600, bitrate: 25_000_000, frameRate: 23.976, codec: 'hevc', range: null });
  });
  it('falls back to the source bitrate', () => {
    const s: MediaSource = { Bitrate: 5_000_000, MediaStreams: [{ Type: 'Video', Index: 0, Width: 1280, Height: 720 }] };
    expect(originalVideo(s)?.bitrate).toBe(5_000_000);
  });
  it('is null without a sized video stream', () => {
    expect(originalVideo({ MediaStreams: [{ Type: 'Audio', Index: 0 }] })).toBeNull();
    expect(originalVideo({ MediaStreams: [{ Type: 'Video', Index: 0 }] })).toBeNull();
  });
});

describe('transcodeTarget', () => {
  it('reads the limits in any case', () => {
    const url = '/videos/1/master.m3u8?VideoCodec=hevc&videoBitrate=7616000&MaxWidth=1920&maxheight=1080&ApiKey=x';
    expect(transcodeTarget(url)).toEqual({ maxWidth: 1920, maxHeight: 1080, videoBitrate: 7_616_000, reasons: [] });
  });
  it('gives nulls for missing or bad values', () => {
    const none = { maxWidth: null, maxHeight: null, videoBitrate: null, reasons: [] };
    expect(transcodeTarget('/videos/1/master.m3u8?VideoBitrate=abc&%E0%A4%A=1')).toEqual(none);
    expect(transcodeTarget('/videos/1/master.m3u8')).toEqual(none);
  });
  it('reads the transcode reasons', () => {
    const url = '/videos/1/master.m3u8?TranscodeReasons=AudioCodecNotSupported%2CSubtitleCodecNotSupported';
    expect(transcodeTarget(url).reasons).toEqual(['AudioCodecNotSupported', 'SubtitleCodecNotSupported']);
  });
});

describe('transcodeReasonText', () => {
  it('names the reasons in words, once each', () => {
    expect(transcodeReasonText(['AudioChannelsNotSupported', 'ContainerBitrateExceedsLimit', 'VideoBitrateNotSupported'])).toBe(
      'audio channels, quality limit',
    );
  });
  it('splits an unknown reason into words, and gives null with none', () => {
    expect(transcodeReasonText(['SomethingNewNotSupported'])).toBe('something new not supported');
    expect(transcodeReasonText([])).toBeNull();
  });
});

describe('playingVideo', () => {
  const original = originalVideo(uhd);

  it("prefers the player's report and fills a missing bitrate", () => {
    const reported = { width: 1920, height: 800, bitrate: null, frameRate: 24, codec: 'video/hevc' };
    expect(playingVideo(reported, 'Transcode', original, { maxWidth: 1920, maxHeight: null, videoBitrate: 8_000_000, reasons: [] })).toEqual({
      ...reported,
      bitrate: 8_000_000,
    });
  });
  it('is the original for direct play', () => {
    expect(playingVideo(null, 'DirectPlay', original, null)).toEqual(original);
    expect(playingVideo(null, 'DirectStream', original, null)).toEqual(original);
  });
  it('scales the original to the transcode limits, keeping the shape', () => {
    expect(playingVideo(null, 'Transcode', original, { maxWidth: 1920, maxHeight: 1080, videoBitrate: 8_000_000, reasons: [] })).toEqual({
      width: 1920,
      height: 800,
      bitrate: 8_000_000,
      frameRate: 23.976,
      codec: null,
    });
  });
  it('never scales up', () => {
    expect(playingVideo(null, 'Transcode', original, { maxWidth: 7680, maxHeight: null, videoBitrate: null, reasons: [] })?.width).toBe(3840);
  });
  it('is null when nothing is known', () => {
    expect(playingVideo(null, 'Transcode', null, null)).toBeNull();
  });
});

describe('labels', () => {
  it('names sizes, wide films by their width', () => {
    expect(resolutionLabel(3840, 2160)).toBe('4K');
    expect(resolutionLabel(3840, 1600)).toBe('4K');
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(1920, 1036)).toBe('1080p');
    expect(resolutionLabel(1440, 1080)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(resolutionLabel(1280, 544)).toBe('720p');
    expect(resolutionLabel(960, 540)).toBe('540p');
    expect(resolutionLabel(720, 576)).toBe('576p');
    expect(resolutionLabel(720, 480)).toBe('480p');
    expect(resolutionLabel(160, 90)).toBe('90p');
  });
  it('formats bitrates', () => {
    expect(formatBitrate(640_000)).toBe('640 kbps');
    expect(formatBitrate(8_150_000)).toBe('8.2 Mbps');
    expect(formatBitrate(25_400_000)).toBe('25 Mbps');
  });
  it('names codecs', () => {
    expect(codecLabel('video/hevc')).toBe('HEVC');
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('video/av01')).toBe('AV1');
    expect(codecLabel('video/dolby-vision')).toBe('Dolby Vision');
    expect(codecLabel('mpeg4')).toBe('MPEG4');
  });
  it('builds the summary and the detail lines', () => {
    const v = { width: 1920, height: 1080, bitrate: 8_150_000, frameRate: 23.976023, codec: 'video/avc' };
    expect(videoSummary(v)).toBe('1080p · 8.2 Mbps');
    expect(videoSummary({ ...v, bitrate: null })).toBe('1080p');
    expect(videoDetail(v)).toBe('1920×1080 · H.264 · 23.976 fps');
    expect(videoDetail({ ...v, codec: null, frameRate: null })).toBe('1920×1080');
  });
  it('names an HDR type and leaves out SDR', () => {
    const v = { width: 1920, height: 1080, bitrate: null, frameRate: 23.976, codec: 'h264' };
    expect(videoDetail({ ...v, codec: 'av1', range: 'DOVIWithHDR10' })).toBe('1920×1080 · AV1 · Dolby Vision · HDR10 · 23.976 fps');
    expect(videoDetail({ ...v, range: 'SDR' })).toBe('1920×1080 · H.264 · 23.976 fps');
  });
});
