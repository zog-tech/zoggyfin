import { spacing } from '@/theme/theme';

import { LANDSCAPE_CONTROLS, nowPlayingSizes, SHORT, WIDE } from '../layout';

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

describe('nowPlayingSizes in landscape (a phone on its side)', () => {
  // iPhone 16 Pro on its side: the Dynamic Island inset on both sides, the home indicator below.
  const pro = { width: 874, height: 402, insetTop: 0, insetBottom: 21, insetLeft: 62, insetRight: 62, longForm: false };

  it('puts the art and the controls side by side inside the safe area', () => {
    const s = nowPlayingSizes(pro);
    expect(s.mode).toBe('landscape');
    expect(s.wide).toBe(false);
    expect(s.pad.left).toBe(62);
    expect(s.pad.right).toBe(62);
    // The art takes the full usable height.
    expect(s.artSize).toBe(402 - spacing.lg - 21);
    expect(s.pad.left + s.artSize + s.gap + s.contentWidth + s.pad.right).toBeLessThanOrEqual(874);
    expect(s.contentWidth).toBeGreaterThanOrEqual(LANDSCAPE_CONTROLS.min);
  });

  it('keeps the page margin where the window has no insets (iPhone SE)', () => {
    const s = nowPlayingSizes({ width: 667, height: 375, insetTop: 0, insetBottom: 0, longForm: true });
    expect(s.mode).toBe('landscape');
    expect(s.pad).toEqual({ top: spacing.lg, bottom: spacing.lg, left: spacing.xl, right: spacing.xl });
    expect(s.contentWidth).toBe(LANDSCAPE_CONTROLS.min);
    expect(s.pad.left + s.artSize + s.gap + s.contentWidth + s.pad.right).toBeLessThanOrEqual(667);
  });

  it('takes the landscape layout on a Pro Max, which is wider than the two-column breakpoint', () => {
    const s = nowPlayingSizes({ width: 956, height: 440, insetTop: 0, insetBottom: 21, insetLeft: 62, insetRight: 62, longForm: false });
    expect(956).toBeGreaterThanOrEqual(WIDE);
    expect(s.mode).toBe('landscape');
    expect(s.artSize).toBe(440 - spacing.lg - 21);
    expect(s.contentWidth).toBeLessThanOrEqual(LANDSCAPE_CONTROLS.max);
  });

  it('keeps portrait and tall windows as they were', () => {
    expect(nowPlayingSizes({ width: 402, height: 874, insetTop: 62, insetBottom: 34, longForm: false }).mode).toBe('stack');
    expect(nowPlayingSizes({ width: 1376, height: 1032, ...ipad }).mode).toBe('wide');
    expect(nowPlayingSizes({ width: 1200, height: SHORT, ...ipad }).mode).toBe('wide');
  });
});
