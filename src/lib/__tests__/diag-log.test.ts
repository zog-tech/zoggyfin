import {
  appendEntry,
  buildReport,
  DIAG_MAX_ENTRIES,
  DIAG_MAX_STRING,
  type DiagEntry,
  errorText,
  formatEntry,
  formatTime,
  makeEntry,
  parseLog,
  sanitizeData,
  sanitizeString,
  serializeLog,
  shortId,
  uriKind,
} from '../diag-log';

const at = (h: number, m: number, s: number, ms: number) => new Date(2026, 10, 24, h, m, s, ms).getTime();

describe('diag log sanitizer', () => {
  it('removes URLs, query strings and keys', () => {
    expect(sanitizeString('GET https://media.example.org:8096/Audio/abc/universal?ApiKey=secret failed')).toBe('GET <url> failed');
    expect(sanitizeString('stream?api_key=abc&UserId=x')).toBe('stream<query>');
    expect(sanitizeString('ApiKey=0123456789abcdef')).toBe('<secret>');
    expect(sanitizeString('X-Emby-Token: abc123')).toBe('<secret>');
    expect(sanitizeString('token=abc')).toBe('<secret>');
  });

  it('removes paths, file URIs, hosts, addresses and e-mail addresses', () => {
    expect(sanitizeString('open /var/mobile/Containers/Data/x.m4a')).toBe('open <path>');
    expect(sanitizeString('file:///var/mobile/song.flac')).toBe('<url>');
    expect(sanitizeString('C:\\Users\\Jane\\song.mp3 missing')).toBe('<path> missing');
    expect(sanitizeString('server 203.0.113.20:8096 away')).toBe('server <addr> away');
    expect(sanitizeString('host fe80::1 away')).toBe('host <addr> away');
    expect(sanitizeString('jellyfin.example.com did not answer')).toBe('<host> did not answer');
    expect(sanitizeString('mail jane@example.com')).toBe('mail <email>');
  });

  it('keeps plain words, numbers and times', () => {
    expect(sanitizeString('AVFoundationErrorDomain error -11800 at 12:34:56')).toBe('AVFoundationErrorDomain error -11800 at 12:34:56');
    expect(sanitizeString('Network Error')).toBe('Network Error');
  });

  it('cuts long strings', () => {
    const s = sanitizeString('x'.repeat(500));
    expect(s.length).toBe(DIAG_MAX_STRING);
    expect(s.endsWith('…')).toBe(true);
  });

  it('cleans data: flat values only, rounded numbers, at most 16 keys', () => {
    const d = sanitizeData({ a: 1.23456, b: 'https://x.org/y', c: { nested: true }, d: undefined, e: null, f: Infinity, 'bad key!': true });
    expect(d).toEqual({ a: 1.235, b: '<url>', c: '<object>', e: null, f: 'Infinity', badkey: true });
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeData(many) ?? {})).toHaveLength(16);
    expect(sanitizeData({})).toBeUndefined();
  });

  it('gives a URI kind, a short id and a clean error text', () => {
    expect(uriKind('https://a/b')).toBe('http');
    expect(uriKind('file:///a')).toBe('file');
    expect(uriKind('/var/a')).toBe('file');
    expect(uriKind('content://x')).toBe('other');
    expect(uriKind('')).toBe('none');
    expect(shortId('0123456789abcdef0123456789abcdef')).toBe('01234567');
    expect(shortId('a-b-c')).toBe('abc');
    expect(shortId(null)).toBeNull();
    expect(errorText(new Error('Request to http://198.51.100.2/Items?ApiKey=x failed'))).toBe('Error: Request to <url> failed');
  });
});

describe('diag log ring buffer', () => {
  it('keeps the last entries', () => {
    let list: DiagEntry[] = [];
    for (let i = 0; i < DIAG_MAX_ENTRIES + 50; i++) list = appendEntry(list, makeEntry(i, 'a', 'e', { i }));
    expect(list).toHaveLength(DIAG_MAX_ENTRIES);
    expect(list[0]?.data?.i).toBe(50);
    expect(list[list.length - 1]?.data?.i).toBe(DIAG_MAX_ENTRIES + 49);
    expect(appendEntry([], makeEntry(1, 'a', 'e'), 3)).toHaveLength(1);
  });

  it('saves and reads back the same entries', () => {
    const list = [makeEntry(1, 'audio', 'load', { token: 2, autoplay: true }), makeEntry(2, 'audio', 'pause')];
    expect(parseLog(serializeLog(list))).toEqual(list);
  });

  it('keeps the saved form under the size cap by dropping the oldest entries', () => {
    const list = Array.from({ length: 500 }, (_, i) => makeEntry(i, 'audio', 'status', { i, a: 'x'.repeat(60), b: 'y'.repeat(60) }));
    const text = serializeLog(list, 20_000);
    expect(text.length).toBeLessThanOrEqual(20_000);
    const back = parseLog(text);
    expect(back.length).toBeGreaterThan(0);
    expect(back[back.length - 1]?.data?.i).toBe(499);
  });

  it('reads any bad saved form as an empty log, and skips bad entries', () => {
    expect(parseLog(undefined)).toEqual([]);
    expect(parseLog('not json')).toEqual([]);
    expect(parseLog('null')).toEqual([]);
    expect(parseLog(JSON.stringify({ v: 99, entries: [] }))).toEqual([]);
    expect(parseLog(JSON.stringify({ v: 1, entries: 'x' }))).toEqual([]);
    const mixed = JSON.stringify({ v: 1, entries: [null, { t: 'x' }, { t: 5, area: 'a', event: 'e', data: { url: 'https://h.org/x', n: 1 } }] });
    expect(parseLog(mixed)).toEqual([{ t: 5, area: 'a', event: 'e', data: { url: '<url>', n: 1 } }]);
  });
});

describe('diag report', () => {
  it('formats a line with the time and the pairs', () => {
    expect(formatTime(at(9, 5, 7, 42))).toBe('09:05:07.042');
    expect(formatEntry(makeEntry(at(9, 5, 7, 42), 'audio', 'load', { token: 3, autoplay: true, next: null }))).toBe('09:05:07.042 audio load token=3 autoplay=true next=null');
  });

  it('builds the report: header, the user text, then the log', () => {
    const t = at(21, 30, 0, 0);
    const text = buildReport(
      { appVersion: '0.1.1 (22)', updateId: 'c66a06bb', runtimeVersion: '0.1.1', platform: 'ios', osVersion: '26.1', lite: false, now: t },
      '  The song stays paused.  ',
      [makeEntry(t - 1500, 'music', 'play', { list: 1 }), makeEntry(t - 1000, 'audio', 'load', { token: 1 })],
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Zoggyfin problem report');
    expect(lines).toContain('App version: 0.1.1 (22)');
    expect(lines).toContain('Update: c66a06bb');
    expect(lines).toContain('Runtime version: 0.1.1');
    expect(lines).toContain('Platform: ios 26.1');
    expect(lines).toContain('Lite mode: off');
    expect(lines.find((l) => l.startsWith('Time: '))).toMatch(/^Time: 2026-11-24 21:30:00\.000 [+-]\d\d:\d\d$/);
    expect(lines).toContain('The song stays paused.');
    expect(lines).toContain('Player log (2 entries, oldest first):');
    expect(lines).toContain('21:29:58.500 music play list=1');
    expect(lines).toContain('21:29:59.000 audio load token=1');
  });

  it('says when there is no user text or no update', () => {
    const text = buildReport({ appVersion: '1', updateId: null, runtimeVersion: null, platform: 'web', osVersion: '', lite: true, now: 0 }, ' ', []);
    expect(text).toContain('(no text)');
    expect(text).toContain('Update: none (build code)');
    expect(text).toContain('Lite mode: on');
  });
});
