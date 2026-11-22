import {
  androidBufferBytes,
  previewBufferOptions,
  SMALL_DEVICE_BUFFER_BYTES,
  bufferInputOf,
  hlsBufferConfig,
  loadsWholeVideo,
  MID_DEVICE_BUFFER_BYTES,
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

  it('caps every load on Android in Lite mode (a 1 GB TV stick)', () => {
    const stick = 0.9 * GB;
    for (const input of [off, on, { ...on, live: true }, { ...on, readAhead: 30 }]) {
      const o = nativeBufferOptions(input, 'android', stick, true);
      expect(o.maxBufferBytes).toBe(SMALL_DEVICE_BUFFER_BYTES);
      expect(o.prioritizeTimeOverSizeThreshold).toBe(false);
    }
    // Lite mode Off on a small device: the cap below 3 GB, never ExoPlayer's own 141 MB; iOS has no byte cap.
    expect(nativeBufferOptions(off, 'android', stick, false).maxBufferBytes).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(nativeBufferOptions(on, 'android', 1.9 * GB, false).maxBufferBytes).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(nativeBufferOptions(off, 'ios', stick, true).maxBufferBytes).toBeUndefined();
  });

  it('caps every load on Android below 3 GB (a 2 GB TV with a 192 MB heap)', () => {
    const tv = 2.4 * GB;
    for (const input of [off, on, { ...on, live: true }, { ...on, readAhead: 30 }]) {
      const o = nativeBufferOptions(input, 'android', tv);
      expect(o.maxBufferBytes).toBe(MID_DEVICE_BUFFER_BYTES);
      expect(o.prioritizeTimeOverSizeThreshold).toBe(false);
    }
    // The cap leaves most of a 192 MB heap to the app, and the time targets stay.
    expect(MID_DEVICE_BUFFER_BYTES).toBeLessThanOrEqual(192 * MB * 0.4);
    expect(nativeBufferOptions(off, 'android', tv).preferredForwardBufferDuration).toBe(20);
    expect(nativeBufferOptions(on, 'android', tv).preferredForwardBufferDuration).toBe(3660);
    // Unknown memory counts as small; from 3 GB, off keeps ExoPlayer's own size; iOS has no byte cap.
    expect(nativeBufferOptions(off, 'android', null).maxBufferBytes).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(nativeBufferOptions(off, 'android', 3 * GB).maxBufferBytes).toBeUndefined();
    expect(nativeBufferOptions(off, 'ios', tv).maxBufferBytes).toBeUndefined();
    expect(nativeBufferOptions(on, 'ios', tv).maxBufferBytes).toBeUndefined();
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
    expect(androidBufferBytes(null)).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(androidBufferBytes(undefined)).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(androidBufferBytes(2 * GB)).toBe(MID_DEVICE_BUFFER_BYTES);
    expect(androidBufferBytes(1 * GB)).toBe(MID_DEVICE_BUFFER_BYTES);
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

describe('previewBufferOptions', () => {
  it('keeps a short buffer, capped in bytes on Android', () => {
    expect(previewBufferOptions('android')).toMatchObject({ preferredForwardBufferDuration: 10, maxBufferBytes: 8 * MB, prioritizeTimeOverSizeThreshold: false });
    expect(previewBufferOptions('ios').maxBufferBytes).toBeUndefined();
  });
});
