import { gridLayout, layoutFor, tv, tvPageEndPadding, tvRowInset, tvSafeInset } from '../layout';
import { fallbackArt, textDirection } from '../theme';

describe('grid layout (design system §2.3)', () => {
  it('matches the poster grid table', () => {
    expect(gridLayout('poster', 393)).toMatchObject({ columns: 3, tileWidth: 112 });
    expect(gridLayout('poster', 440)).toMatchObject({ columns: 3, tileWidth: 128 });
    expect(gridLayout('poster', 820)).toMatchObject({ columns: 5, tileWidth: 141 });
    expect(gridLayout('poster', 1180)).toMatchObject({ columns: 7, tileWidth: 145 });
  });
  it('gives square grids 2 columns and thumb grids 1 column on a phone', () => {
    expect(gridLayout('square', 393).columns).toBe(2);
    expect(gridLayout('thumb', 393).columns).toBe(1);
  });
  it('uses the content width left by a sidebar', () => {
    const l = layoutFor(1180, { sidebar: 280 });
    expect(l.contentWidth).toBe(900);
    expect(l.bp).toBe('expanded');
    expect(l.rowTile.poster).toBe(152);
  });
  it('picks row tile sizes per breakpoint', () => {
    expect(layoutFor(393).rowTile).toEqual({ poster: 116, thumb: 264, square: 148, circle: 88 });
    expect(layoutFor(393).gutter).toBe(16);
  });
});

describe('TV safe area (overscan)', () => {
  it('keeps a full-width row inside the page margin, with its content on the page edge', () => {
    const g = layoutFor(960, { tv: true }).gutter;
    const r = tvRowInset(g);
    expect(r.marginRight).toBe(g);
    expect(r.marginLeft + r.padX).toBe(g);
    expect(r.marginLeft).toBeGreaterThanOrEqual(0);
    expect(tvRowInset(4)).toEqual({ marginLeft: 0, marginRight: 4, padX: 4 });
  });
  it('is 5 % of each edge: 48 x 27 dp on a 960 dp (1080p) Android TV', () => {
    expect(tvSafeInset(960)).toEqual({ x: 48, y: 27 });
    expect(tvSafeInset(1920)).toEqual({ x: 96, y: 54 });
  });
  it('is in the TV layout and zero elsewhere', () => {
    expect(layoutFor(960, { tv: true }).safe).toEqual({ x: 48, y: 27 });
    expect(layoutFor(393).safe).toEqual({ x: 0, y: 0 });
  });
  it('keeps the side menu items inside it, with room for the icon', () => {
    expect(tv.railWidth).toBeGreaterThanOrEqual(tv.railX + tv.railIcon + 32);
    expect(tv.gutter).toBeGreaterThanOrEqual(tv.safeX);
  });
});

describe('content text', () => {
  it('reads the direction from the first strong character', () => {
    expect(textDirection('رحلة إلى البحر')).toBe('rtl');
    expect(textDirection('2024 Sample')).toBe('ltr');
  });
  it('gives the same fallback art for the same title', () => {
    expect(fallbackArt('Sample Movie')).toEqual(fallbackArt('  sample movie '));
    expect(fallbackArt('Sample Movie').css).toContain('linear-gradient');
  });
});

describe('TV Home end padding', () => {
  it('lets the last row scroll to the top of the list and no further', () => {
    // A 600 pt list; rows 0 to 900, the last row starts at 700 (200 tall).
    const pad = tvPageEndPadding(600, 900, 700);
    expect(pad).toBe(400);
    // The furthest scroll is the content height minus the list height: the last row's top.
    expect(900 + pad - 600).toBe(700);
  });
  it('adds nothing when the last row is taller than the list', () => {
    expect(tvPageEndPadding(300, 900, 500)).toBe(0);
  });
  it('fills the list when there is one short row', () => {
    expect(tvPageEndPadding(600, 250, 0)).toBe(350);
  });
});
