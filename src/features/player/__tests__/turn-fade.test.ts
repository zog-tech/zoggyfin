import { turned } from '../turn-fade';

describe('turned', () => {
  it('is true from portrait to landscape and back', () => {
    expect(turned({ width: 402, height: 874 }, { width: 874, height: 402 })).toBe(true);
    expect(turned({ width: 874, height: 402 }, { width: 402, height: 874 })).toBe(true);
  });

  it('is false for a size change in the same orientation', () => {
    expect(turned({ width: 1024, height: 1366 }, { width: 694, height: 1366 })).toBe(false);
    expect(turned({ width: 1200, height: 800 }, { width: 1400, height: 900 })).toBe(false);
  });

  it('is false for a zero size', () => {
    expect(turned({ width: 0, height: 0 }, { width: 874, height: 402 })).toBe(false);
    expect(turned({ width: 402, height: 874 }, { width: 0, height: 0 })).toBe(false);
  });
});
