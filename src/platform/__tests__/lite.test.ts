import { isSmallDevice, liteActive, liteLabel } from '../lite';

const GB = 1024 * 1024 * 1024;

describe('Lite mode', () => {
  it('is on by itself for an Android device under 2 GB (a 1 GB Fire TV Stick)', () => {
    expect(liteActive('auto', 'android', 0.9 * GB)).toBe(true);
    expect(liteActive('auto', 'android', 3 * GB)).toBe(false);
    expect(liteActive('auto', 'ios', 0.9 * GB)).toBe(false);
    expect(liteActive('auto', 'android', null)).toBe(false);
  });
  it('follows On and Off on every device', () => {
    expect(liteActive('on', 'ios', 8 * GB)).toBe(true);
    expect(liteActive('off', 'android', 0.9 * GB)).toBe(false);
  });
  it('says what Auto chose', () => {
    expect(liteLabel('auto', true)).toBe('Auto (on)');
    expect(liteLabel('auto', false)).toBe('Auto (off)');
    expect(liteLabel('on', true)).toBe('On');
    expect(isSmallDevice('android', 1.5 * GB)).toBe(true);
  });
});
