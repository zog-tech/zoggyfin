import { ExtensionError } from '../http';
import { buildReport, parseDownloadDescription, parseStreamDescription } from '../media';

const base = 'https://media.example.org';
const other = 'https://other.example.net';

const stream = {
  stream: { url: '/hls/e123/master.m3u8', type: 'hls' },
  alternatives: [{ url: '/files/e123.mp4', type: 'file' }],
  title: 'An entry',
  subtitle: 'Example Media',
  image: '/img/e123.jpg',
  duration: 734,
  resume: 120.5,
  qualities: [
    { id: 'auto', label: 'Auto', url: '/hls/e123/master.m3u8' },
    { id: '720', label: '720p', url: '/hls/e123/720.m3u8' },
  ],
  subtitles: [{ id: 'en', label: 'English', language: 'en', url: '/subs/e123.en.vtt' }],
  segments: [
    { label: 'promo', start: 200, end: 245 },
    { label: 'intro', start: 0, end: 12.5 },
  ],
  chapters: [
    { title: 'Part 2', start: 380 },
    { title: 'Part 1', start: 0 },
  ],
  next: { id: 'e124', title: 'Next entry', image: '/img/e124.jpg', media: { id: 'e124', kind: 'video', playback: '/api/entries/e124/play' } },
  report: { path: '/api/entries/e123/progress', intervalSeconds: 10 },
};

describe('parseStreamDescription', () => {
  it('reads a full description with full URLs on the origin', () => {
    const d = parseStreamDescription(stream, base);
    expect(d.streams).toEqual([
      { url: `${base}/hls/e123/master.m3u8`, type: 'hls' },
      { url: `${base}/files/e123.mp4`, type: 'file' },
    ]);
    expect(d).toMatchObject({ live: false, title: 'An entry', subtitle: 'Example Media', imageUrl: `${base}/img/e123.jpg`, duration: 734, resume: 120.5 });
    expect(d.qualities.map((q) => [q.id, q.url])).toEqual([
      ['auto', `${base}/hls/e123/master.m3u8`],
      ['720', `${base}/hls/e123/720.m3u8`],
    ]);
    expect(d.subtitles).toEqual([{ id: 'en', label: 'English', language: 'en', url: `${base}/subs/e123.en.vtt` }]);
    expect(d.segments.map((s) => s.label)).toEqual(['intro', 'promo']);
    expect(d.chapters.map((c) => c.title)).toEqual(['Part 1', 'Part 2']);
    expect(d.next).toMatchObject({ key: 'e124', title: 'Next entry', media: { id: 'e124', playback: `${base}/api/entries/e124/play` } });
    expect(d.report).toEqual({ url: `${base}/api/entries/e123/progress`, intervalSeconds: 10 });
  });

  it('reads a live stream with no duration and no resume', () => {
    const d = parseStreamDescription({ ...stream, live: true }, base);
    expect(d.live).toBe(true);
    expect(d.duration).toBeUndefined();
    expect(d.resume).toBeUndefined();
  });

  it('guesses the type from the URL when it is missing', () => {
    const d = parseStreamDescription({ stream: { url: '/a/index.m3u8?t=1' }, alternatives: [{ url: '/a.mp4' }] }, base);
    expect(d.streams.map((s) => s.type)).toEqual(['hls', 'file']);
  });

  it('leaves out streams on another origin and plays the next one', () => {
    const d = parseStreamDescription({ ...stream, stream: { url: `${other}/master.m3u8`, type: 'hls' } }, base);
    expect(d.streams).toEqual([{ url: `${base}/files/e123.mp4`, type: 'file' }]);
  });

  it('refuses a description with nothing to play, with no URL in the error', () => {
    const run = (data: unknown) => () => parseStreamDescription(data, base);
    expect(run({ stream: { url: `${other}/master.m3u8` } })).toThrow(ExtensionError);
    expect(run({ stream: { url: `${other}/master.m3u8` } })).toThrow('The extension sent no stream the app can play.');
    expect(run({ title: 'No stream' })).toThrow(ExtensionError);
    expect(run(null)).toThrow(ExtensionError);
    expect(run([stream])).toThrow(ExtensionError);
    try {
      parseStreamDescription({ stream: { url: `${other}/secret.m3u8?token=abc` } }, base);
    } catch (e) {
      expect(String(e)).not.toMatch(/other\.example|token/);
    }
  });

  it('leaves out bad and off-origin entries one by one', () => {
    const d = parseStreamDescription(
      {
        ...stream,
        qualities: [{ id: '1080', label: '1080p', url: `${other}/1080.m3u8` }, { id: 'x' }, stream.qualities[1], { ...stream.qualities[1], label: 'Again' }],
        subtitles: [{ label: 'French', url: `${other}/fr.vtt` }, { label: 'German', url: '/de.vtt' }, { url: '/no-label.vtt' }],
        segments: [{ label: 'intro', start: 10, end: 5 }, { label: '', start: 0, end: 1 }, { label: 'recap', start: 1, end: 9 }],
        chapters: [{ title: 'A', start: -1 }, { title: 'B', start: 3 }],
        next: { id: 'e124', title: 'Next entry', media: { id: 'e124', download: '/f.mp4' } },
        report: { path: `${other}/progress` },
      },
      base,
    );
    expect(d.qualities.map((q) => [q.id, q.label])).toEqual([['720', '720p']]);
    expect(d.subtitles).toEqual([{ id: '1', label: 'German', url: `${base}/de.vtt` }]);
    expect(d.segments).toEqual([{ label: 'recap', start: 1, end: 9 }]);
    expect(d.chapters).toEqual([{ title: 'B', start: 3 }]);
    expect(d.next).toBeUndefined();
    expect(d.report).toBeUndefined();
  });

  it('keeps free segment labels and leaves out bad head fields alone', () => {
    const d = parseStreamDescription({ ...stream, title: 5, duration: -3, resume: 'soon', segments: [{ label: 'sponsor message', start: 0, end: 1 }] }, base);
    expect(d.title).toBeUndefined();
    expect(d.duration).toBeUndefined();
    expect(d.resume).toBeUndefined();
    expect(d.subtitle).toBe('Example Media');
    expect(d.segments[0].label).toBe('sponsor message');
  });

  it('ignores a resume point at or past the end', () => {
    expect(parseStreamDescription({ ...stream, resume: 734 }, base).resume).toBeUndefined();
  });

  it('uses 10 s reports by default', () => {
    expect(parseStreamDescription({ ...stream, report: { path: '/p' } }, base).report?.intervalSeconds).toBe(10);
  });
});

describe('buildReport', () => {
  it('builds the body', () => {
    expect(buildReport({ event: 'progress', mediaId: 'e123', position: 130.24, duration: 734, rate: 1.5, quality: '720' })).toEqual({
      event: 'progress',
      mediaId: 'e123',
      position: 130.2,
      duration: 734,
      rate: 1.5,
      quality: '720',
      offline: false,
    });
  });

  it('leaves out an unknown duration and quality, and fixes bad numbers', () => {
    expect(buildReport({ event: 'stop', mediaId: 'e1', position: -4, duration: Infinity, rate: 0, quality: null, offline: true })).toEqual({
      event: 'stop',
      mediaId: 'e1',
      position: 0,
      rate: 1,
      offline: true,
    });
    expect(buildReport({ event: 'start', mediaId: 'e1', position: NaN }).position).toBe(0);
  });
});

describe('parseDownloadDescription', () => {
  const file = {
    url: '/files/e123-720.mp4',
    bytes: 123456789,
    container: 'MP4',
    label: '720p',
    subtitles: [{ label: 'English', language: 'en', url: '/subs/e123.en.vtt' }],
    image: '/img/e123.jpg',
  };

  it('reads a file', () => {
    expect(parseDownloadDescription(file, base)).toEqual({
      url: `${base}/files/e123-720.mp4`,
      bytes: 123456789,
      container: 'mp4',
      label: '720p',
      subtitles: [{ label: 'English', language: 'en', url: `${base}/subs/e123.en.vtt` }],
      imageUrl: `${base}/img/e123.jpg`,
      options: [],
    });
  });

  it('reads options with or without a file', () => {
    const options = [
      { id: '720', label: '720p · 310 MB', download: '/api/entries/e123/download?q=720' },
      { id: '1080', label: '1080p', download: `${other}/d` },
      { id: '720', label: 'Again', download: '/x' },
      { label: 'No id', download: '/y' },
    ];
    const d = parseDownloadDescription({ options }, base);
    expect(d.url).toBeUndefined();
    expect(d.options).toEqual([{ id: '720', label: '720p · 310 MB', download: `${base}/api/entries/e123/download?q=720` }]);
    expect(parseDownloadDescription({ ...file, options }, base).options).toHaveLength(1);
  });

  it('leaves out HLS, other origins and bad fields', () => {
    const d = parseDownloadDescription({ ...file, bytes: -1, container: 'mp4; rm', subtitles: [{ label: 'X', url: `${other}/x.vtt` }], image: `${other}/i.jpg`, options: [{ id: 'a', label: 'A', download: '/a' }] }, base);
    expect(d).toEqual({ url: `${base}/files/e123-720.mp4`, label: '720p', subtitles: [], options: [{ id: 'a', label: 'A', download: `${base}/a` }] });
    expect(parseDownloadDescription({ url: '/hls/master.m3u8', options: [{ id: 'a', label: 'A', download: '/a' }] }, base).url).toBeUndefined();
  });

  it('refuses a reply with nothing to save, with no URL in the error', () => {
    expect(() => parseDownloadDescription({ url: `${other}/f.mp4` }, base)).toThrow('The extension sent no file the app can save.');
    expect(() => parseDownloadDescription({ url: '/hls/master.m3u8' }, base)).toThrow(ExtensionError);
    expect(() => parseDownloadDescription('file', base)).toThrow(ExtensionError);
  });
});
