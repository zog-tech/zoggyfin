import { previewStart, previewUrl } from '../preview';

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
