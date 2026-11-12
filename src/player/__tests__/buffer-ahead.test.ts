import {
  androidBufferBytes,
  bufferInputOf,
  hlsBufferConfig,
  loadsWholeVideo,
  mpvBufferOptions,
  nativeBufferOptions,
  UNKNOWN_LENGTH_SECONDS,
  WEB_BUFFER_BYTES,
} from '../buffer-ahead';

const MB = 1024 * 1024;
const GB = 1024 * MB;

const off = { wholeVideo: false, durationSeconds: 3600, live: false };
const on = { wholeVideo: true, durationSeconds: 3600, live: false };

describe('loadsWholeVideo', () => {
  it('applies only when on, not live and not a nearby host stream', () => {
    expect(loadsWholeVideo(on)).toBe(true);
    expect(loadsWholeVideo(off)).toBe(false);
    expect(loadsWholeVideo({ ...on, live: true })).toBe(false);
    expect(loadsWholeVideo({ ...on, readAhead: 30 })).toBe(false);
  });

  it('reads the engine source', () => {
    expect(bufferInputOf({})).toEqual({ wholeVideo: false, durationSeconds: null, live: false, readAhead: undefined });
    expect(bufferInputOf({ loadAhead: { durationSeconds: 90 } })).toEqual({ wholeVideo: true, durationSeconds: 90, live: false, readAhead: undefined });
    expect(bufferInputOf({ loadAhead: null, readAhead: 20 }).readAhead).toBe(20);
  });
});

describe('nativeBufferOptions', () => {
  it('keeps the defaults when off', () => {
    expect(nativeBufferOptions(off, 'ios', 8 * GB)).toEqual({ preferredForwardBufferDuration: 0, minBufferForPlayback: 2, waitsToMinimizeStalling: true });
    expect(nativeBufferOptions(off, 'android', 8 * GB)).toEqual({ preferredForwardBufferDuration: 20, minBufferForPlayback: 2, waitsToMinimizeStalling: true });
  });

  it('keeps the defaults for a live stream', () => {
    expect(nativeBufferOptions({ ...on, live: true }, 'android', 8 * GB)).toEqual(nativeBufferOptions(off, 'android', 8 * GB));
  });

  it('gives watch together its read-ahead, also when on', () => {
    expect(nativeBufferOptions({ ...on, readAhead: 30 }, 'ios', null)).toEqual({ preferredForwardBufferDuration: 30, minBufferForPlayback: 2, waitsToMinimizeStalling: true });
  });

  it('reads to the end on iOS', () => {
    expect(nativeBufferOptions(on, 'ios', null)).toEqual({ preferredForwardBufferDuration: 3660, minBufferForPlayback: 2, waitsToMinimizeStalling: true });
  });

  it('reads 4 hours when the length is not known', () => {
    expect(nativeBufferOptions({ ...on, durationSeconds: 0 }, 'ios', null).preferredForwardBufferDuration).toBe(UNKNOWN_LENGTH_SECONDS);
    expect(nativeBufferOptions({ ...on, durationSeconds: null }, 'android', null).preferredForwardBufferDuration).toBe(UNKNOWN_LENGTH_SECONDS);
  });

  it('caps the bytes on Android and lets the cap win', () => {
    const o = nativeBufferOptions(on, 'android', 8 * GB);
    expect(o.preferredForwardBufferDuration).toBe(3660);
    expect(o.maxBufferBytes).toBe(200 * MB);
    expect(o.prioritizeTimeOverSizeThreshold).toBe(false);
  });
});

describe('androidBufferBytes', () => {
  it('follows the device memory and stays under 2 GB', () => {
    expect(androidBufferBytes(null)).toBe(0);
    expect(androidBufferBytes(undefined)).toBe(0);
    expect(androidBufferBytes(2 * GB)).toBe(0);
    expect(androidBufferBytes(4 * GB)).toBe(160 * MB);
    expect(androidBufferBytes(12 * GB)).toBe(200 * MB);
    expect(androidBufferBytes(64 * GB)).toBeLessThan(2 ** 31);
  });
});

describe('hlsBufferConfig', () => {
  it('keeps the hls.js defaults when off or live', () => {
    expect(hlsBufferConfig(off)).toBeNull();
    expect(hlsBufferConfig({ ...on, live: true })).toBeNull();
    expect(hlsBufferConfig({ ...on, readAhead: 30 })).toBeNull();
  });

  it('reads up to the end, capped in bytes', () => {
    expect(hlsBufferConfig(on)).toEqual({ maxBufferLength: 30, maxMaxBufferLength: 3660, maxBufferSize: WEB_BUFFER_BYTES, backBufferLength: 30 });
    expect(WEB_BUFFER_BYTES).toBeLessThan(150 * MB);
  });
});

describe('mpvBufferOptions', () => {
  it('adds nothing when off or live', () => {
    expect(mpvBufferOptions(off)).toBe('');
    expect(mpvBufferOptions({ ...on, live: true })).toBe('');
  });

  it('keeps the watch together read-ahead', () => {
    expect(mpvBufferOptions({ ...on, readAhead: 30 })).toBe(',cache-secs=30,demuxer-readahead-secs=30');
  });

  it('raises the cache for this file when on', () => {
    expect(mpvBufferOptions(on)).toBe(',demuxer-max-bytes=1024MiB');
  });
});
