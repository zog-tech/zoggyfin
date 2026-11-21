import { previewPlayable, previewStart, previewUrl } from '../preview';

const min = (m: number) => m * 60 * 10_000_000;

describe('previewStart', () => {
  it('starts 12 % into a movie', () => {
    expect(previewStart({ Type: 'Movie', RunTimeTicks: min(100) })).toBe(720);
  });
  it('starts at least a minute in and at most 15 minutes in', () => {
    expect(previewStart({ Type: 'Episode', RunTimeTicks: min(6) })).toBe(60);
    expect(previewStart({ Type: 'Movie', RunTimeTicks: min(180) })).toBe(900);
  });
  it('has none for shows, music and short or unknown items', () => {
    expect(previewStart({ Type: 'Series', RunTimeTicks: min(40) })).toBeNull();
    expect(previewStart({ Type: 'Audio', RunTimeTicks: min(4) })).toBeNull();
    expect(previewStart({ Type: 'Movie', RunTimeTicks: min(3) })).toBeNull();
    expect(previewStart({ Type: 'Movie' })).toBeNull();
  });
});

describe('previewUrl', () => {
  it('streams the original file with the key', () => {
    const url = previewUrl({ baseUrl: 'http://jf.example:8096/', itemId: 'abc', token: 't' });
    expect(url.startsWith('http://jf.example:8096/Videos/abc/stream?')).toBe(true);
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('static')).toBe('true');
    expect(q.get('ApiKey')).toBe('t');
  });
});

describe('previewPlayable', () => {
  const stick = { videoCodecs: ['h264', 'hevc'] as const, maxSize: { h264: { width: 1920, height: 1080 }, hevc: { width: 1920, height: 1080 } }, hevcTenBit: false };
  const item = (Codec: string, Width: number, Height: number, BitDepth = 8) => ({ MediaStreams: [{ Type: 'Audio' as const, Codec: 'aac' }, { Type: 'Video' as const, Codec, Width, Height, BitDepth }] });

  it('plays a file the device decodes', () => {
    expect(previewPlayable(item('h264', 1920, 1080), stick)).toBe(true);
  });
  it('skips a file that only its sound would play (4K, 10-bit HEVC, an unknown codec)', () => {
    expect(previewPlayable(item('hevc', 3840, 2160), stick)).toBe(false);
    expect(previewPlayable(item('hevc', 1920, 1080, 10), stick)).toBe(false);
    expect(previewPlayable(item('av1', 1920, 1080), stick)).toBe(false);
    expect(previewPlayable(item('mpeg2video', 720, 576), stick)).toBe(false);
  });
  it('waits for the full item with its streams', () => {
    expect(previewPlayable({}, stick)).toBe(false);
    expect(previewPlayable({ MediaStreams: [] }, stick)).toBe(false);
  });
});
