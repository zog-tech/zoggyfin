import { liveStreamFor, isHlsUrl, isTsUrl, xtreamHlsForm } from '../stream-url';
import { toBase64 } from '../test-utils/fixtures';
import type { Channel } from '../types';
import {
  normalizeXtreamInput,
  connectionLimitText,
  parseXtreamAuth,
  parseXtreamCategories,
  parseXtreamShortEpg,
  parseXtreamStreams,
  xtreamApiUrl,
  xtreamLiveUrl,
} from '../xtream';

const LOGIN = { server: 'http://panel.example.com:8080', username: 'jane', password: 'p@ss word' };

describe('normalizeXtreamInput', () => {
  it('adds the scheme and drops the API path', () => {
    expect(normalizeXtreamInput('panel.example.com:8080/')).toEqual({ server: 'http://panel.example.com:8080' });
    expect(normalizeXtreamInput('https://panel.example.com/player_api.php')).toEqual({ server: 'https://panel.example.com' });
    expect(normalizeXtreamInput('HTTP://panel.example.com/sub/')).toEqual({ server: 'http://panel.example.com/sub' });
  });
  it('takes the user name and password from a get.php link', () => {
    expect(normalizeXtreamInput('http://panel.example.com/get.php?username=jane&password=secret&type=m3u_plus')).toEqual({
      server: 'http://panel.example.com',
      username: 'jane',
      password: 'secret',
    });
  });
  it('refuses text that is not an address', () => {
    expect(normalizeXtreamInput('')).toBeNull();
    expect(normalizeXtreamInput('not an address')).toBeNull();
    expect(normalizeXtreamInput('ftp://x')).toBeNull();
  });
});

describe('URLs', () => {
  it('encodes the credentials', () => {
    expect(xtreamApiUrl(LOGIN)).toBe('http://panel.example.com:8080/player_api.php?username=jane&password=p%40ss%20word');
    expect(xtreamApiUrl(LOGIN, 'get_short_epg', { stream_id: 5, limit: 2 })).toBe(
      'http://panel.example.com:8080/player_api.php?username=jane&password=p%40ss%20word&action=get_short_epg&stream_id=5&limit=2',
    );
    expect(xtreamLiveUrl(LOGIN, 42, 'm3u8')).toBe('http://panel.example.com:8080/live/jane/p%40ss%20word/42.m3u8');
  });
});

describe('answers', () => {
  it('reads the login answer', () => {
    expect(parseXtreamAuth({ user_info: { auth: 1, status: 'Active', exp_date: '1800000000', max_connections: '2' } })).toEqual({
      ok: true,
      expires: 1_800_000_000_000,
      maxConnections: 2,
      activeConnections: null,
    });
    expect(parseXtreamAuth({ user_info: { auth: 0 } })).toEqual({ ok: false, reason: 'denied' });
    expect(parseXtreamAuth({ user_info: { auth: 1, status: 'Expired' } })).toEqual({ ok: false, reason: 'expired' });
    expect(parseXtreamAuth({ user_info: { auth: 1, status: 'Banned' } })).toEqual({ ok: false, reason: 'disabled' });
    expect(parseXtreamAuth([])).toEqual({ ok: false, reason: 'answer' });
  });

  it('says when every stream of the account is in use', () => {
    const auth = (max: unknown, active: unknown) => parseXtreamAuth({ user_info: { auth: 1, status: 'Active', max_connections: max, active_cons: active } });
    expect(connectionLimitText(auth('2', '2'))).toBe('This provider allows 2 streams at a time, and all are in use.');
    expect(connectionLimitText(auth(3, 4))).toBe('This provider allows 3 streams at a time, and all are in use.');
    expect(connectionLimitText(auth('1', '1'))).toBe('This provider allows 1 stream at a time, and it is in use.');
    expect(connectionLimitText(auth('2', '1'))).toBeNull();
    expect(connectionLimitText(auth(undefined, '1'))).toBeNull();
    expect(connectionLimitText(auth('0', '0'))).toBeNull();
    expect(connectionLimitText(parseXtreamAuth({ user_info: { auth: 0 } }))).toBeNull();
  });

  it('reads categories and streams', () => {
    const cats = parseXtreamCategories([{ category_id: '1', category_name: 'News' }, { category_id: 2, category_name: 'Sport' }, null]);
    const streams = parseXtreamStreams(
      [
        { num: 1, name: 'Example News', stream_id: 101, stream_icon: 'https://img.example.com/n.png', epg_channel_id: 'news.example', category_id: '1', tv_archive: 1, tv_archive_duration: '7' },
        { num: '2', name: 'Sport One', stream_id: '102', stream_icon: '', epg_channel_id: null, category_id: '2', tv_archive: 0 },
        { name: 'Duplicate', stream_id: 101 },
        { name: 'No id' },
        'junk',
      ],
      cats,
    );
    expect(streams).toEqual([
      { id: '101', name: 'Example News', group: 'News', streamId: 101, logo: 'https://img.example.com/n.png', number: 1, epgId: 'news.example', archiveDays: 7 },
      { id: '102', name: 'Sport One', group: 'Sport', streamId: 102, number: 2 },
    ]);
    expect(parseXtreamStreams({ error: 'x' }, cats)).toEqual([]);
  });

  it('reads the short guide with base64 titles', () => {
    const b64 = toBase64;
    const progs = parseXtreamShortEpg({
      epg_listings: [
        { title: b64('Later'), description: '', start_timestamp: '1800003600', stop_timestamp: '1800007200' },
        { title: b64('Now Show'), description: b64('About now'), start_timestamp: 1800000000, stop_timestamp: 1800003600 },
        { title: b64('Bad'), start_timestamp: 5, stop_timestamp: 1 },
      ],
    });
    expect(progs).toEqual([
      { start: 1_800_000_000_000, stop: 1_800_003_600_000, title: 'Now Show', description: 'About now' },
      { start: 1_800_003_600_000, stop: 1_800_007_200_000, title: 'Later' },
    ]);
    expect(parseXtreamShortEpg({})).toEqual([]);
  });
});

describe('stream choice', () => {
  const xtreamChannel: Channel = { id: '7', name: 'A', group: '', streamId: 7 };
  const xtream = { kind: 'xtream' as const, userAgent: 'Agent/1' };
  const m3u = { kind: 'm3u' as const, userAgent: null };

  it('asks Xtream for HLS on iOS and the web, TS elsewhere', () => {
    for (const p of ['ios', 'tvos', 'web'] as const) {
      expect(liveStreamFor(xtreamChannel, xtream, LOGIN, p).candidates).toEqual([{ url: xtreamLiveUrl(LOGIN, 7, 'm3u8'), isHls: true }]);
    }
    for (const p of ['android', 'desktop'] as const) {
      expect(liveStreamFor(xtreamChannel, xtream, LOGIN, p)).toEqual({ candidates: [{ url: xtreamLiveUrl(LOGIN, 7, 'ts'), isHls: false }], userAgent: 'Agent/1', unsupported: null });
    }
  });

  it('knows HLS and TS URLs', () => {
    expect(isHlsUrl('https://cdn.example.com/a/index.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('http://example.com/play?id=1&extension=m3u8')).toBe(true);
    expect(isTsUrl('http://example.com/1.ts?x=1')).toBe(true);
    expect(isTsUrl('http://example.com/1.mp4')).toBe(false);
  });

  it('rewrites only Xtream-shaped URLs to their HLS form', () => {
    expect(xtreamHlsForm('http://panel.example.com:8080/live/jane/secret/1001.ts')).toBe('http://panel.example.com:8080/live/jane/secret/1001.m3u8');
    expect(xtreamHlsForm('http://panel.example.com/jane/secret/1002')).toBe('http://panel.example.com/jane/secret/1002.m3u8');
    expect(xtreamHlsForm('http://panel.example.com/jane/secret/1002.ts?token=x')).toBe('http://panel.example.com/jane/secret/1002.m3u8?token=x');
    expect(xtreamHlsForm('http://example.com/channels/news.ts')).toBeNull();
    expect(xtreamHlsForm('http://example.com/a/b/c/d/1.ts')).toBeNull();
    expect(xtreamHlsForm('http://example.com/movie/jane/secret/1.mkv')).toBeNull();
  });

  it('tries the HLS form of an M3U .ts entry on iOS, then says the format does not play', () => {
    const ch: Channel = { id: '1', name: 'A', group: '', url: 'http://panel.example.com/live/jane/secret/1001.ts', userAgent: 'Entry/2' };
    expect(liveStreamFor(ch, m3u, null, 'ios')).toEqual({
      candidates: [{ url: 'http://panel.example.com/live/jane/secret/1001.m3u8', isHls: true }],
      userAgent: 'Entry/2',
      unsupported: "This channel's format does not play on iPhone and iPad.",
    });
    const plain: Channel = { id: '2', name: 'B', group: '', url: 'http://example.com/channels/news.ts' };
    expect(liveStreamFor(plain, m3u, null, 'ios').candidates).toEqual([]);
    expect(liveStreamFor(plain, m3u, null, 'web').unsupported).toMatch(/browser/);
  });

  it('adds the TS bridge after the HLS form on iOS when the binary has it', () => {
    const ch: Channel = { id: '1', name: 'A', group: '', url: 'http://panel.example.com/live/jane/secret/1001.ts' };
    expect(liveStreamFor(ch, m3u, null, 'ios', true).candidates).toEqual([
      { url: 'http://panel.example.com/live/jane/secret/1001.m3u8', isHls: true },
      { url: ch.url, isHls: true, bridge: true },
    ]);
    const plain: Channel = { id: '2', name: 'B', group: '', url: 'http://example.com/channels/news.ts' };
    expect(liveStreamFor(plain, m3u, null, 'ios', true).candidates).toEqual([{ url: plain.url, isHls: true, bridge: true }]);
    // Never on the web or Apple TV, and never for a stream that is HLS already.
    expect(liveStreamFor(plain, m3u, null, 'web', true).candidates).toEqual([]);
    expect(liveStreamFor(plain, m3u, null, 'tvos', true).candidates).toEqual([]);
    const hls: Channel = { id: '3', name: 'C', group: '', url: 'http://example.com/live/news.m3u8' };
    expect(liveStreamFor(hls, m3u, null, 'ios', true).candidates).toEqual([{ url: hls.url, isHls: true }]);
  });

  it('keeps the original URL on Android and the Mac app', () => {
    const ch: Channel = { id: '1', name: 'A', group: '', url: 'http://panel.example.com/live/jane/secret/1001.ts' };
    expect(liveStreamFor(ch, m3u, null, 'android').candidates).toEqual([{ url: ch.url, isHls: false }]);
    expect(liveStreamFor(ch, m3u, null, 'desktop').candidates).toEqual([{ url: ch.url, isHls: false }]);
  });

  it('plays HLS entries and unknown formats as they are', () => {
    const hls: Channel = { id: '1', name: 'A', group: '', url: 'https://cdn.example.com/a.m3u8' };
    expect(liveStreamFor(hls, m3u, null, 'ios').candidates).toEqual([{ url: hls.url, isHls: true }]);
    const mp4: Channel = { id: '2', name: 'B', group: '', url: 'https://cdn.example.com/a.mp4' };
    expect(liveStreamFor(mp4, m3u, null, 'ios')).toEqual({ candidates: [{ url: mp4.url, isHls: false }], userAgent: null, unsupported: null });
  });
});
