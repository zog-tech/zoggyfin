import { buildAuthHeader, withApiKey } from '../auth-header';
import { describeError, errorText } from '../errors';
import { normalizeLibraryQuery, queryKeys, type LibraryQuery } from '../query-keys';
import { normalizeServerUrl, serverUrlCandidates } from '../server-url';

const identity = { client: 'Zoggyfin', device: 'iPhone 17', deviceId: 'dev-1', version: '0.1.0' };

describe('buildAuthHeader', () => {
  it('builds the MediaBrowser header with a token', () => {
    expect(buildAuthHeader(identity, 'tok')).toBe(
      'MediaBrowser Client="Zoggyfin", Device="iPhone%2017", DeviceId="dev-1", Version="0.1.0", Token="tok"',
    );
  });
  it('leaves out Token before sign-in', () => {
    expect(buildAuthHeader(identity)).not.toContain('Token=');
    expect(buildAuthHeader(identity, '')).not.toContain('Token=');
  });
  it('escapes quotes and commas so they cannot break the header', () => {
    const h = buildAuthHeader({ ...identity, device: 'Jane\'s "Phone", 2' }, 't');
    expect(h).toContain('Device="Jane\'s%20%22Phone%22%2C%202"');
  });
});

describe('withApiKey', () => {
  it('uses the ApiKey casing and the right separator', () => {
    expect(withApiKey('https://a/b', 't')).toBe('https://a/b?ApiKey=t');
    expect(withApiKey('https://a/b?x=1', 't')).toBe('https://a/b?x=1&ApiKey=t');
    expect(withApiKey('https://a/b', null)).toBe('https://a/b');
  });
});

describe('server URLs', () => {
  it('normalizes', () => {
    expect(normalizeServerUrl('HTTPS://Jf.Example.com/')).toBe('https://jf.example.com');
    expect(normalizeServerUrl('https://example.com/jellyfin/web/index.html')).toBe('https://example.com/jellyfin');
    expect(normalizeServerUrl('http://10.0.0.5:8096/web/#/home')).toBe('http://10.0.0.5:8096');
    expect(normalizeServerUrl('ftp://x')).toBeNull();
    expect(normalizeServerUrl('nonsense')).toBeNull();
  });
  it('tries https then http when no scheme is given', () => {
    expect(serverUrlCandidates('jf.example.com:8096')).toEqual([
      'https://jf.example.com:8096',
      'http://jf.example.com:8096',
    ]);
    expect(serverUrlCandidates('http://jf.example.com')).toEqual(['http://jf.example.com']);
    expect(serverUrlCandidates('')).toEqual([]);
    expect(serverUrlCandidates('has space.com')).toEqual([]);
    expect(serverUrlCandidates('ftp://x.com')).toEqual([]);
  });
});

describe('query keys', () => {
  const s = { serverId: 'srv', userId: 'usr' };
  const q: LibraryQuery = {
    parentId: 'p',
    includeItemTypes: ['Series', 'Movie'],
    sortBy: 'SortName',
    sortOrder: 'Ascending',
    played: 'all',
    favorites: false,
    genres: ['Drama', 'Action'],
    years: [2020, 1999],
  };

  it('scopes every key by server and user', () => {
    expect(queryKeys.item(s, 'x')).toEqual(['jf', 'srv', 'usr', 'item', 'x']);
    expect(queryKeys.views(s).slice(0, 3)).toEqual(queryKeys.all(s));
    expect(queryKeys.item({ serverId: 'srv', userId: 'other' }, 'x')).not.toEqual(queryKeys.item(s, 'x'));
  });

  it('gives the same library key for the same filters in any order', () => {
    const reordered = { ...q, includeItemTypes: ['Movie', 'Series'], genres: ['Action', 'Drama'], years: [1999, 2020] };
    expect(queryKeys.library(s, q)).toEqual(queryKeys.library(s, reordered));
    expect(normalizeLibraryQuery(q).years).toEqual([1999, 2020]);
    // It does not change the input.
    expect(q.genres).toEqual(['Drama', 'Action']);
  });

  it('normalizes search terms', () => {
    expect(queryKeys.search(s, '  Sample ')).toEqual(queryKeys.search(s, 'sample'));
  });

  it('keeps a genre search apart from a plain one', () => {
    expect(queryKeys.search(s, 'sample', 'Drama')).not.toEqual(queryKeys.search(s, 'sample'));
    expect(queryKeys.search(s, 'sample', '')).toEqual(queryKeys.search(s, 'sample'));
  });
});

describe('describeError', () => {
  it('classifies common failures', () => {
    expect(describeError({ response: { status: 401 } }).kind).toBe('auth');
    expect(describeError({ response: { status: 404 } }).kind).toBe('notFound');
    expect(describeError({ response: { status: 503 } }).kind).toBe('server');
    expect(describeError({ code: 'ERR_NETWORK', message: 'Network Error' }).kind).toBe('offline');
    expect(describeError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }).kind).toBe('timeout');
    expect(describeError(new Error('boom')).message).toBe('boom');
    expect(describeError('weird').kind).toBe('unknown');
  });

  it('keeps the text of a thrown string (a Tauri command rejects with one)', () => {
    expect(describeError('not a relative path: /x').message).toBe('not a relative path: /x');
  });
});

describe('errorText', () => {
  it('shows the own message of an error that is not from the server', () => {
    expect(errorText(new Error('The downloaded file is missing. Download it again.'))).toBe('The downloaded file is missing. Download it again.');
    expect(errorText('mpv is not running')).toBe('mpv is not running');
  });

  it('shows the title for server and network errors', () => {
    expect(errorText({ response: { status: 404 }, message: 'Request failed with status code 404' })).toBe('Not found');
    expect(errorText({ response: { status: 400 }, message: 'Request failed with status code 400' })).toBe('Request failed');
    expect(errorText({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe('Cannot reach the server');
    expect(errorText({})).toBe('Request failed');
  });
});
