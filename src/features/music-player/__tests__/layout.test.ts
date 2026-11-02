import { spacing } from '@/theme/theme';

import { nowPlayingSizes, WIDE } from '../layout';

const ipad = { insetTop: 24, insetBottom: 20, longForm: false };

describe('nowPlayingSizes', () => {
  it('keeps the phone sizes: one column, the art as wide as the content', () => {
    const s = nowPlayingSizes({ width: 402, height: 874, insetTop: 62, insetBottom: 34, longForm: false });
    expect(s.wide).toBe(false);
    expect(s.columnWidth).toBe(402);
    expect(s.contentWidth).toBe(402 - spacing.xl * 2);
    expect(s.artSize).toBe(s.contentWidth);
  });

  it('gives the art a margin on both sides of the left column (iPad portrait)', () => {
    const s = nowPlayingSizes({ width: 1032, height: 1376, ...ipad });
    expect(s.wide).toBe(true);
    expect(s.columnWidth).toBe(516);
    expect(s.contentWidth).toBe(516 - spacing.xl * 2);
    expect(s.artSize).toBeLessThanOrEqual(s.contentWidth);
    expect((s.columnWidth - s.artSize) / 2).toBeGreaterThanOrEqual(spacing.xl);
  });

  it('fits the art and the rows below it in the window height (iPad landscape)', () => {
    const s = nowPlayingSizes({ width: 1376, height: 1032, ...ipad });
    expect(s.columnWidth).toBe(688);
    expect(s.contentWidth).toBe(560 - spacing.xl * 2);
    // Header, art area, title and controls (measured on iOS: 53 + art + 24 + 82 + 301).
    expect(53 + s.artSize + spacing.md * 2 + 82 + 301).toBeLessThanOrEqual(1032 - ipad.insetBottom);
  });

  it('uses two columns from the breakpoint (iPad split view)', () => {
    expect(nowPlayingSizes({ width: WIDE - 1, height: 1376, ...ipad }).wide).toBe(false);
    const s = nowPlayingSizes({ width: 950, height: 1376, ...ipad });
    expect(s.wide).toBe(true);
    expect(s.columnWidth).toBe(475);
    expect(s.artSize).toBe(475 - spacing.xl * 2);
  });

  it('never makes the art smaller than 140', () => {
    expect(nowPlayingSizes({ width: 1200, height: 500, ...ipad }).artSize).toBe(140);
  });
});
