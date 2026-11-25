import { isFireTv, readTvLook, readTvLookChoice, TV_LOOK_CHOICES, tvLookFor, tvLookLabel, type TvLookDevice } from '../tv-look';

const androidTv: TvLookDevice = { os: 'android', manufacturer: 'Google', brand: 'google', model: 'Chromecast', lite: false };
const fireStick: TvLookDevice = { os: 'android', manufacturer: 'Amazon', brand: 'Amazon', model: 'AFTKA', lite: false };
const appleTv: TvLookDevice = { os: 'ios', manufacturer: 'Apple', brand: 'Apple', model: 'Apple TV', lite: false };

describe('Fire TV detection', () => {
  it('finds Amazon by manufacturer, by brand or by an AFT model name', () => {
    expect(isFireTv(fireStick)).toBe(true);
    expect(isFireTv({ ...androidTv, manufacturer: ' amazon ' })).toBe(true);
    expect(isFireTv({ ...androidTv, brand: 'Amazon' })).toBe(true);
    expect(isFireTv({ ...androidTv, model: 'AFTKA' })).toBe(true);
    expect(isFireTv({ ...androidTv, model: 'aftmm' })).toBe(true);
  });
  it('does not take other devices for a Fire TV', () => {
    expect(isFireTv(androidTv)).toBe(false);
    expect(isFireTv({ ...androidTv, manufacturer: null, brand: null, model: null })).toBe(false);
    expect(isFireTv({ ...androidTv, model: 'SHIELD Android TV' })).toBe(false);
    // Only Android: an Apple device with a model like "AFT" is not one.
    expect(isFireTv({ ...appleTv, model: 'AFT1' })).toBe(false);
  });
});

describe('the TV look for a run', () => {
  it('gives Modern on Auto, except on Fire TV and in Lite mode', () => {
    expect(tvLookFor('auto', androidTv)).toBe('modern');
    expect(tvLookFor('auto', appleTv)).toBe('modern');
    expect(tvLookFor('auto', fireStick)).toBe('classic');
    expect(tvLookFor('auto', { ...androidTv, lite: true })).toBe('classic');
    expect(tvLookFor('auto', { ...fireStick, lite: false })).toBe('classic');
  });
  it('lets the user choice win over the device', () => {
    expect(tvLookFor('modern', fireStick)).toBe('modern');
    expect(tvLookFor('modern', { ...androidTv, lite: true })).toBe('modern');
    expect(tvLookFor('classic', androidTv)).toBe('classic');
  });
  it('lets the preview parameter win over everything', () => {
    expect(tvLookFor('modern', androidTv, 'classic')).toBe('classic');
    expect(tvLookFor('auto', fireStick, 'modern')).toBe('modern');
    expect(tvLookFor('classic', androidTv, null)).toBe('classic');
  });
  it('offers Auto first', () => {
    expect(TV_LOOK_CHOICES).toEqual(['auto', 'modern', 'classic']);
  });
});

describe('saved values and labels', () => {
  it('reads a saved choice of any shape and never throws', () => {
    expect(readTvLookChoice('modern')).toBe('modern');
    expect(readTvLookChoice('classic')).toBe('classic');
    expect(readTvLookChoice('auto')).toBe('auto');
    for (const bad of [undefined, null, 1, 'Modern', '', {}, ['modern'], true]) expect(readTvLookChoice(bad)).toBe('auto');
  });
  it('reads a preview parameter', () => {
    expect(readTvLook('modern')).toBe('modern');
    expect(readTvLook('classic')).toBe('classic');
    expect(readTvLook('auto')).toBeNull();
    expect(readTvLook(null)).toBeNull();
  });
  it('says what Auto chose', () => {
    expect(tvLookLabel('auto', 'modern')).toBe('Auto (Modern)');
    expect(tvLookLabel('auto', 'classic')).toBe('Auto (Classic)');
    expect(tvLookLabel('modern', 'classic')).toBe('Modern');
    expect(tvLookLabel('classic', 'modern')).toBe('Classic');
  });
});
