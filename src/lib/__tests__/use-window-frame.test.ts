import { pickFrame } from '../use-window-frame';

describe('pickFrame', () => {
  it('uses the safe-area frame when it is measured (native)', () => {
    expect(pickFrame({ width: 874, height: 402 }, { width: 402, height: 874 })).toEqual({ width: 874, height: 402 });
  });

  it('uses the window when the frame is zero (web)', () => {
    expect(pickFrame({ width: 0, height: 0 }, { width: 844, height: 390 })).toEqual({ width: 844, height: 390 });
  });
});
