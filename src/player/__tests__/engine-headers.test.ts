/**
 * Stream headers (an extension's headers, maybe its Jellyfin token) go only
 * to the stream's own origin, never to a segment server another origin names.
 */
import { headersForRequest } from '../engine-types';

const H = { 'X-Emby-Token': 'secret', 'X-Api-Key': 'k' };
const STREAM = 'https://media.example.org:8443/ext/play/master.m3u8';

describe('headersForRequest', () => {
  it('sends the headers to the same origin, also for relative URLs', () => {
    expect(headersForRequest(H, STREAM, 'https://media.example.org:8443/ext/play/720/seg-1.ts')).toEqual(H);
    expect(headersForRequest(H, STREAM, '720/index.m3u8')).toEqual(H);
  });

  it('sends nothing to another host, port or scheme', () => {
    expect(headersForRequest(H, STREAM, 'https://cdn.example.net/seg-1.ts')).toEqual({});
    expect(headersForRequest(H, STREAM, 'https://media.example.org/seg-1.ts')).toEqual({});
    expect(headersForRequest(H, STREAM, 'http://media.example.org:8443/seg-1.ts')).toEqual({});
  });

  it('sends nothing when a URL does not parse', () => {
    expect(headersForRequest(H, 'not a url', 'seg-1.ts')).toEqual({});
  });
});
