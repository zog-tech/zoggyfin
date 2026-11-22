import { continuousAlbum, fadeBetween, fadeGain, fadeLabel, inFadeWindow } from '../crossfade';

const on = { seconds: 6, longForm: false, repeatOne: false, together: false };

describe('continuousAlbum', () => {
  it('is true for the next track and for track 1 of the next disc', () => {
    expect(continuousAlbum({ AlbumId: 'x', IndexNumber: 3 }, { AlbumId: 'x', IndexNumber: 4 })).toBe(true);
    expect(continuousAlbum({ AlbumId: 'x', IndexNumber: 12, ParentIndexNumber: 1 }, { AlbumId: 'x', IndexNumber: 1, ParentIndexNumber: 2 })).toBe(true);
  });

  it('is false for another album, a jump or missing numbers', () => {
    expect(continuousAlbum({ AlbumId: 'x', IndexNumber: 3 }, { AlbumId: 'y', IndexNumber: 4 })).toBe(false);
    expect(continuousAlbum({ AlbumId: 'x', IndexNumber: 3 }, { AlbumId: 'x', IndexNumber: 7 })).toBe(false);
    expect(continuousAlbum({ AlbumId: 'x' }, { AlbumId: 'x', IndexNumber: 1 })).toBe(false);
  });
});

describe('fadeBetween', () => {
  const a = { AlbumId: 'x', IndexNumber: 1 };
  const b = { AlbumId: 'y', IndexNumber: 5 };

  it('fades between songs of different albums', () => {
    expect(fadeBetween(a, b, on)).toBe(true);
  });

  it('does not fade when off, at the queue end, inside an album run or in the excluded modes', () => {
    expect(fadeBetween(a, b, { ...on, seconds: 0 })).toBe(false);
    expect(fadeBetween(a, null, on)).toBe(false);
    expect(fadeBetween(a, { AlbumId: 'x', IndexNumber: 2 }, on)).toBe(false);
    expect(fadeBetween(a, b, { ...on, longForm: true })).toBe(false);
    expect(fadeBetween(a, b, { ...on, repeatOne: true })).toBe(false);
    expect(fadeBetween(a, b, { ...on, together: true })).toBe(false);
  });
});

describe('fadeGain', () => {
  const base = { duration: 200, seconds: 6, fadeIn: false, fadeOut: true };

  it('is full volume in the middle of a song', () => {
    expect(fadeGain({ ...base, position: 100 })).toBe(1);
  });

  it('falls to silence at the end with an equal-power curve', () => {
    expect(fadeGain({ ...base, position: 197 })).toBeCloseTo(Math.SQRT1_2, 5);
    expect(fadeGain({ ...base, position: 200 })).toBe(0);
    expect(fadeGain({ ...base, position: 205 })).toBe(0);
  });

  it('rises from silence at the start of a song that fades in', () => {
    const p = { ...base, fadeOut: false, fadeIn: true };
    expect(fadeGain({ ...p, position: 0 })).toBe(0);
    expect(fadeGain({ ...p, position: 3 })).toBeCloseTo(Math.SQRT1_2, 5);
    expect(fadeGain({ ...p, position: 6 })).toBe(1);
  });

  it('uses at most a quarter of a short song', () => {
    // 8 s long: the fade is 2 s, not 6 s.
    expect(fadeGain({ ...base, duration: 8, position: 6 })).toBe(1);
    expect(fadeGain({ ...base, duration: 8, position: 7 })).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('is full volume when off or the length is not known', () => {
    expect(fadeGain({ ...base, seconds: 0, position: 199 })).toBe(1);
    expect(fadeGain({ ...base, duration: 0, position: 199 })).toBe(1);
  });
});

describe('inFadeWindow', () => {
  it('starts a second before the fade-out and holds during a fade-in', () => {
    const p = { duration: 200, seconds: 6, fadeIn: false, fadeOut: true };
    expect(inFadeWindow({ ...p, position: 190 })).toBe(false);
    expect(inFadeWindow({ ...p, position: 193.5 })).toBe(true);
    expect(inFadeWindow({ ...p, fadeOut: false, fadeIn: true, position: 2 })).toBe(true);
  });
});

it('labels a choice', () => {
  expect(fadeLabel(0)).toBe('Off');
  expect(fadeLabel(6)).toBe('6 s');
});
