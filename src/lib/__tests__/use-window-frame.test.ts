import { layoutSize, pickFrame } from '../use-window-frame';

describe('layoutSize', () => {
  const portrait = { width: 402, height: 874 };
  const landscape = { width: 874, height: 402 };

  it('uses the window when the frame agrees with it', () => {
    expect(layoutSize(portrait, portrait)).toEqual(portrait);
    expect(layoutSize(landscape, landscape)).toEqual(landscape);
  });

  it('keeps the old size while the window has turned and the frame (with the insets) has not', () => {
    // The window event of a rotation comes first: no render with the new size and the old insets.
    expect(layoutSize(portrait, landscape)).toEqual(portrait);
  });

  it('takes the new size with the insets when the frame turns first', () => {
    expect(layoutSize(landscape, portrait)).toEqual(landscape);
  });

  it('keeps the window for any other frame (a sheet, a split view) and when there is no frame', () => {
    expect(layoutSize({ width: 540, height: 620 }, { width: 1180, height: 820 })).toEqual({ width: 1180, height: 820 });
    expect(layoutSize({ width: 0, height: 0 }, landscape)).toEqual(landscape);
    expect(layoutSize(null, landscape)).toEqual(landscape);
  });
});

describe('pickFrame', () => {
  it('uses the safe-area frame when it is measured (native)', () => {
    expect(pickFrame({ width: 874, height: 402 }, { width: 402, height: 874 })).toEqual({ width: 874, height: 402 });
  });

  it('uses the window when the frame is zero (web)', () => {
    expect(pickFrame({ width: 0, height: 0 }, { width: 844, height: 390 })).toEqual({ width: 844, height: 390 });
  });
});
