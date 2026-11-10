import { sourceHeaders } from '../engine-types';
import { mpvHeaderFields } from '../engine-mpv';
import {
  cleanStreamError,
  externalFailureText,
  externalItem,
  externalStart,
  externalSubtitleOptions,
  externalTransport,
  mainQualityId,
  qualityCandidates,
  reloadPosition,
  subtitleLoader,
  withStreamFacts,
} from '../external';
import { ProgressReporter, secondsToTicks, type Timer } from '../progress-reporter';
import type { ExternalReportEvent, ExternalReportSnapshot, ExternalSource, ExternalStream } from '../types';

const iptv: ExternalSource = { providerId: 'p1', resolve: async () => ({ candidates: [], userAgent: null, unsupported: null }) };
const ext: ExternalSource = { ...iptv, providerId: 'ext:org.example', itemId: (r) => `ext:org.example:${r.id}` };

describe('external items', () => {
  it('keeps the IPTV item ids and shapes', () => {
    expect(externalItem({ id: '9', kind: 'episode', title: 'Two', poster: null, seriesName: 'Show', season: 1, episode: 2, duration: 60 }, iptv)).toEqual({
      Id: 'iptv-vod:p1:episode:9',
      Name: 'Two',
      Type: 'Episode',
      SeriesName: 'Show',
      ParentIndexNumber: 1,
      IndexNumber: 2,
      RunTimeTicks: secondsToTicks(60),
    });
    expect(externalItem({ id: 'f', kind: 'film', title: 'Film', poster: null, year: 1999 }, iptv)).toMatchObject({ Id: 'iptv-vod:p1:film:f', Type: 'Movie', ProductionYear: 1999 });
  });

  it('uses the source item id for extension media and the stream facts', () => {
    const ref = withStreamFacts({ id: 'e1', kind: 'film', title: 'Card', poster: null, duration: 5 }, { candidates: [], userAgent: null, unsupported: null, title: 'Real', artwork: 'https://x/i.jpg', duration: 70 });
    expect(ref).toMatchObject({ title: 'Real', poster: 'https://x/i.jpg', duration: 70 });
    expect(externalItem(ref, ext).Id).toBe('ext:org.example:e1');
    expect(withStreamFacts(ref, { candidates: [], userAgent: null, unsupported: null, live: true }).duration).toBeUndefined();
  });
});

describe('error text', () => {
  it('never shows a URL', () => {
    expect(cleanStreamError('Stream error: manifestLoadError')).toBe('Stream error: manifestLoadError');
    expect(cleanStreamError('failed https://x.example/a.m3u8')).toBeNull();
    expect(cleanStreamError('failed //x.example/a')).toBeNull();
    expect(externalFailureText({ played: false, unsupported: null, error: 'open http://u:p@x/1.ts' })).toBe('This title could not be played.');
    expect(externalFailureText({ played: false, unsupported: 'MKV does not play here.', error: 'decode' })).toBe('MKV does not play here.');
    expect(externalFailureText({ played: true, unsupported: 'MKV does not play here.', error: 'decode' })).toBe('decode');
  });
});

describe('qualities and reload position', () => {
  const stream: Pick<ExternalStream, 'candidates' | 'qualities'> = {
    candidates: [
      { url: 'https://m/master.m3u8', isHls: true },
      { url: 'https://m/file.mp4', isHls: false },
    ],
    qualities: [
      { id: 'auto', label: 'Auto', url: 'https://m/master.m3u8', isHls: true },
      { id: '720', label: '720p', url: 'https://m/720.m3u8', isHls: true },
    ],
  };

  it('tries the chosen URL first, then the source forms', () => {
    expect(qualityCandidates(stream, null)).toBe(stream.candidates);
    expect(qualityCandidates(stream, 'missing')).toBe(stream.candidates);
    expect(qualityCandidates(stream, '720').map((c) => c.url)).toEqual(['https://m/720.m3u8', 'https://m/master.m3u8', 'https://m/file.mp4']);
    expect(qualityCandidates(stream, 'auto').map((c) => c.url)).toEqual(['https://m/master.m3u8', 'https://m/file.mp4']);
  });

  it('knows the source’s own Auto entry', () => {
    expect(mainQualityId(stream)).toBe('auto');
    expect(mainQualityId({ ...stream, qualities: stream.qualities?.slice(1) })).toBeNull();
  });

  it('reloads where the title is once it played, else where it wanted to start, live at the edge', () => {
    expect(reloadPosition({ live: false, played: true, enginePosition: 321, statePosition: 300, attemptStart: 10 })).toBe(321);
    expect(reloadPosition({ live: false, played: true, enginePosition: 0, statePosition: 300, attemptStart: 10 })).toBe(300);
    expect(reloadPosition({ live: false, played: false, enginePosition: 5, statePosition: 300, attemptStart: 10 })).toBe(10);
    expect(reloadPosition({ live: true, played: true, enginePosition: 321, statePosition: 300, attemptStart: 10 })).toBe(0);
  });

  it('starts at the request, else the resume point; live at 0', () => {
    expect(externalStart(undefined, { resume: 40 })).toBe(40);
    expect(externalStart(0, { resume: 40 })).toBe(0);
    expect(externalStart(12, {})).toBe(12);
    expect(externalStart(12, { live: true, resume: 40 })).toBe(0);
  });
});

describe('subtitles', () => {
  it('lists the files as app-drawn text subtitles', () => {
    expect(externalSubtitleOptions([{ id: 'en', label: 'English', language: 'en', url: 'https://m/en.vtt' }])).toEqual([
      { index: 0, label: 'English', language: 'en', isDefault: false, isForced: false, isText: true, url: 'https://m/en.vtt', isExternal: true },
    ]);
  });

  it('never routes an external title through the Jellyfin client', () => {
    expect(subtitleLoader('https://m/en.vtt', true)).toBe('source');
    expect(subtitleLoader('https://jf/Videos/1/Subtitles/2/Stream.vtt', false)).toBe('jellyfin');
    expect(subtitleLoader('file:///d/sub.vtt', false)).toBe('local');
  });
});

describe('external progress transport', () => {
  function fakeTimer() {
    let fn: (() => void) | null = null;
    let ms = 0;
    const timer: Timer = {
      setInterval: (f, every) => {
        fn = f;
        ms = every;
        return 1;
      },
      clearInterval: () => {
        fn = null;
      },
    };
    return { timer, fire: () => fn?.(), interval: () => ms };
  }

  it('maps the reporter calls to report events at the source interval', async () => {
    const sent: [ExternalReportEvent, ExternalReportSnapshot][] = [];
    let ended = false;
    const transport = externalTransport(
      { intervalMs: 15_000, send: async (e, s) => void sent.push([e, s]) },
      { duration: () => 700, quality: () => '720', ended: () => ended },
    );
    const snap = { positionTicks: secondsToTicks(12.5), isPaused: false, isMuted: false, playbackRate: 1.25, audioStreamIndex: null, subtitleStreamIndex: null };
    const t = fakeTimer();
    const r = new ProgressReporter(transport, () => snap, t.timer, 15_000);
    r.start({ itemId: 'e1', mediaSourceId: '', playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
    expect(t.interval()).toBe(15_000);
    t.fire();
    r.tick('Pause');
    r.tick('Unpause');
    r.tick('Seek');
    r.tick('Background');
    ended = true;
    await r.stop();
    expect(sent.map(([e]) => e)).toEqual(['start', 'progress', 'pause', 'resume', 'seek', 'progress', 'finished']);
    expect(sent[0][1]).toEqual({ position: 12.5, duration: 700, rate: 1.25, quality: '720' });
  });

  it('a stop before the end is stop', async () => {
    const sent: ExternalReportEvent[] = [];
    const transport = externalTransport({ intervalMs: 10_000, send: async (e) => void sent.push(e) }, { duration: () => 0, quality: () => null, ended: () => false });
    await transport.stopped({ itemId: 'e', mediaSourceId: '', playSessionId: null, playMethod: 'DirectPlay', canSeek: false, positionTicks: 0, isPaused: true, isMuted: false, playbackRate: 1, audioStreamIndex: null, subtitleStreamIndex: null });
    expect(sent).toEqual(['stop']);
  });
});

describe('stream headers', () => {
  it('joins the headers and the user agent; headers win', () => {
    expect(sourceHeaders({ userAgent: 'VLC' })).toEqual({ 'User-Agent': 'VLC' });
    expect(sourceHeaders({ userAgent: 'VLC', headers: { 'user-agent': 'Mine', 'X-Key': 'k' } })).toEqual({ 'user-agent': 'Mine', 'X-Key': 'k' });
    expect(sourceHeaders({ headers: { 'X-Bad': 'a\r\nb', '': 'x', 'X-Empty': '' } })).toEqual({});
  });

  it('libmpv gets the header list with no user agent and no value with a comma', () => {
    expect(mpvHeaderFields({ 'User-Agent': 'VLC', 'X-Key': 'k', Authorization: 'MediaBrowser Token="t"', 'X-List': 'a,b' })).toBe('X-Key: k,Authorization: MediaBrowser Token="t"');
    expect(mpvHeaderFields({})).toBe('');
  });
});
