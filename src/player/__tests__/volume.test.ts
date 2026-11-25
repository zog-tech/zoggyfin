import {
  audibleLevel,
  clampVolume,
  DEFAULT_VOLUME,
  elementGain,
  mpvVolume,
  readVolume,
  savedVolume,
  stepVolume,
  toggleMute,
  UNMUTE_LEVEL,
  volumeIcon,
  volumeProduct,
  volumeText,
  withLevel,
} from '../volume';

describe('app volume', () => {
  it('clamps to 0..1 in steps of 1 %', () => {
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(1.4)).toBe(1);
    expect(clampVolume(0.333333)).toBe(0.33);
    expect(clampVolume(Number.NaN)).toBe(1);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('steps by 5 % and stops at the ends', () => {
    expect(stepVolume({ level: 0.5, muted: false }, 1).level).toBe(0.55);
    expect(stepVolume({ level: 0.5, muted: false }, -1).level).toBe(0.45);
    expect(stepVolume({ level: 0.98, muted: false }, 1).level).toBe(1);
    expect(stepVolume({ level: 0.02, muted: false }, -1).level).toBe(0);
  });

  it('returns the same object when nothing changes', () => {
    const full = { level: 1, muted: false };
    expect(stepVolume(full, 1)).toBe(full);
    expect(withLevel(full, 1)).toBe(full);
  });

  it('a move up unmutes; a move to 0 keeps the mute', () => {
    expect(withLevel({ level: 0.4, muted: true }, 0.6)).toEqual({ level: 0.6, muted: false });
    expect(stepVolume({ level: 0.4, muted: true }, 1)).toEqual({ level: 0.45, muted: false });
    expect(withLevel({ level: 0.4, muted: true }, 0)).toEqual({ level: 0, muted: true });
  });

  it('toggles mute and keeps the level', () => {
    const on = toggleMute({ level: 0.7, muted: false });
    expect(on).toEqual({ level: 0.7, muted: true });
    expect(toggleMute(on)).toEqual({ level: 0.7, muted: false });
  });

  it('unmute at level 0 brings the sound back', () => {
    expect(toggleMute({ level: 0, muted: false })).toEqual({ level: UNMUTE_LEVEL, muted: false });
    expect(toggleMute({ level: 0, muted: true })).toEqual({ level: UNMUTE_LEVEL, muted: false });
  });

  it('plays nothing while muted', () => {
    expect(audibleLevel({ level: 0.8, muted: true })).toBe(0);
    expect(audibleLevel({ level: 0.8, muted: false })).toBe(0.8);
  });

  it('gives the element a cubic gain and libmpv the percentage', () => {
    expect(elementGain(1)).toBe(1);
    expect(elementGain(0)).toBe(0);
    expect(elementGain(0.5)).toBeCloseTo(0.125);
    expect(mpvVolume(0.5)).toBe(50);
    expect(mpvVolume(1)).toBe(100);
    expect(mpvVolume(0)).toBe(0);
  });

  it('multiplies the volume shares, and a bad share counts as 1', () => {
    expect(volumeProduct()).toBe(1);
    expect(volumeProduct(0.5, 0.5, 1)).toBe(0.25);
    expect(volumeProduct(1, 0)).toBe(0);
    expect(volumeProduct(Number.NaN, 0.5)).toBe(0.5);
    expect(volumeProduct(2, 0.5)).toBe(0.5);
  });

  it('picks the speaker glyph by level', () => {
    expect(volumeIcon({ level: 0.8, muted: true })).toBe('speaker.slash.fill');
    expect(volumeIcon({ level: 0, muted: false })).toBe('speaker.slash.fill');
    expect(volumeIcon({ level: 0.2, muted: false })).toBe('speaker.wave.1.fill');
    expect(volumeIcon({ level: 0.5, muted: false })).toBe('speaker.wave.2.fill');
    expect(volumeIcon({ level: 0.9, muted: false })).toBe('speaker.wave.3.fill');
  });

  it('says the level for screen readers', () => {
    expect(volumeText({ level: 0.42, muted: false })).toBe('42 percent');
    expect(volumeText({ level: 0.42, muted: true })).toBe('Muted');
  });

  it('reads the saved value and never throws', () => {
    expect(readVolume(null)).toBe(DEFAULT_VOLUME);
    expect(readVolume('x')).toBe(DEFAULT_VOLUME);
    expect(readVolume({ level: 0.3 })).toBe(DEFAULT_VOLUME);
    expect(readVolume({ version: 1, level: 0.3, muted: true })).toEqual({ level: 0.3, muted: true });
    expect(readVolume({ version: 1, level: 7, muted: 'yes' })).toEqual({ level: 1, muted: false });
    expect(readVolume(savedVolume({ level: 0.25, muted: false }))).toEqual({ level: 0.25, muted: false });
  });
});
