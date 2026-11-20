import { canResume, isWholeFile, joinStep, parseContentRange, rangeAnswer, rangeHeaders, resumeHint, validatorOf } from '../resume';
import { rec } from '../test-utils/fixtures';

describe('canResume', () => {
  const plan = { method: 'original' as const, file: 'media.mkv' };

  it('continues the same original file', () => {
    expect(canResume(rec({ mediaFile: 'media.mkv', bytesDone: 500 }), plan)).toBe(true);
  });

  it('lets the engine check a record that shows 0 bytes (iOS reported 0 while it waited for a retry)', () => {
    expect(canResume(rec({ mediaFile: 'media.mkv', bytesDone: 0 }), plan)).toBe(true);
  });

  it('starts over for a transcode or another file', () => {
    expect(canResume(rec({ mediaFile: 'media.mkv', bytesDone: 500, method: 'transcode' }), plan)).toBe(false);
    expect(canResume(rec({ mediaFile: 'media.mkv', bytesDone: 500 }), { ...plan, method: 'transcode' })).toBe(false);
    expect(canResume(rec({ mediaFile: 'media.mp4', bytesDone: 500 }), plan)).toBe(false);
    expect(canResume(rec({ mediaFile: '', bytesDone: 500 }), plan)).toBe(false);
  });

  it('gives the engine the known size and validator', () => {
    expect(resumeHint(rec({ bytesTotal: 1000, validator: '"v1"' }))).toEqual({ expectedBytes: 1000, validator: '"v1"' });
    expect(resumeHint(rec({ bytesTotal: null }))).toEqual({ expectedBytes: null, validator: null });
  });
});

describe('isWholeFile', () => {
  it('does not take a partial original file for a finished one', () => {
    expect(isWholeFile(400, rec({ bytesTotal: 1000 }))).toBe(false);
    expect(isWholeFile(1000, rec({ bytesTotal: 1000 }))).toBe(true);
    expect(isWholeFile(0, rec({ bytesTotal: 1000 }))).toBe(false);
  });

  it('takes any file when the size is not known (a transcode)', () => {
    expect(isWholeFile(400, rec({ bytesTotal: 1000, method: 'transcode' }))).toBe(true);
    expect(isWholeFile(400, rec({ bytesTotal: null }))).toBe(true);
  });
});

describe('range requests', () => {
  it('asks for the rest of the file, with If-Range when there is a validator', () => {
    expect(rangeHeaders({ Authorization: 'k' }, 400, '"v1"')).toEqual({ Authorization: 'k', Range: 'bytes=400-', 'If-Range': '"v1"' });
    expect(rangeHeaders(undefined, 400, null)).toEqual({ Range: 'bytes=400-' });
  });

  it('keeps a strong ETag, else Last-Modified', () => {
    expect(validatorOf({ ETag: '"abc"', 'Last-Modified': 'date' })).toBe('"abc"');
    expect(validatorOf({ etag: 'W/"abc"', 'last-modified': 'date' })).toBe('date');
    expect(validatorOf({})).toBeNull();
    expect(validatorOf(undefined)).toBeNull();
  });

  it('reads Content-Range', () => {
    expect(parseContentRange('bytes 400-999/1000')).toEqual({ start: 400, total: 1000 });
    expect(parseContentRange('bytes 400-999/*')).toEqual({ start: 400, total: null });
    expect(parseContentRange('nonsense')).toBeNull();
  });

  it('appends only a range that starts at the partial size and has the known total', () => {
    expect(rangeAnswer({ 'Content-Range': 'bytes 400-999/1000' }, 400, 1000)).toEqual({ kind: 'append', total: 1000 });
    expect(rangeAnswer({ 'content-range': 'bytes 400-999/1000' }, 400, null)).toEqual({ kind: 'append', total: 1000 });
    expect(rangeAnswer({ 'Content-Range': 'bytes 0-999/1000' }, 400, 1000)).toEqual({ kind: 'mismatch' });
    expect(rangeAnswer({ 'Content-Range': 'bytes 400-1999/2000' }, 400, 1000)).toEqual({ kind: 'mismatch' });
    expect(rangeAnswer({ 'Content-Range': 'bytes 400-999/*' }, 400, null)).toEqual({ kind: 'mismatch' });
  });

  it('takes a response with no Content-Range for the whole file (200)', () => {
    expect(rangeAnswer({ 'Content-Length': '1000' }, 400, 1000)).toEqual({ kind: 'whole' });
  });
});

describe('joinStep', () => {
  it('appends when the sizes add up', () => {
    expect(joinStep({ offset: 400, restBytes: 600, total: 1000, answer: 'append' })).toBe('append');
    // The first answer came before an app restart.
    expect(joinStep({ offset: 400, restBytes: 600, total: 1000, answer: null })).toBe('append');
  });

  it('keeps the second file alone when the server sent the whole file', () => {
    expect(joinStep({ offset: 400, restBytes: 1000, total: 1000, answer: 'whole' })).toBe('replace');
  });

  it('starts over when the sizes do not add up', () => {
    // The downloader continued the second file with a Range of its own.
    expect(joinStep({ offset: 400, restBytes: 1000, total: 1000, answer: 'append' })).toBe('restart');
    expect(joinStep({ offset: 400, restBytes: 1000, total: 1000, answer: null })).toBe('restart');
    expect(joinStep({ offset: 400, restBytes: 600, total: null, answer: null })).toBe('restart');
    expect(joinStep({ offset: 400, restBytes: 0, total: 1000, answer: 'append' })).toBe('restart');
  });
});
