import { rowsToMount, shelfWindow, type ShelfWindow } from '../shelf-window';

describe('shelfWindow', () => {
  it('mounts a screen behind, the visible screen and a screen ahead of the focus', () => {
    expect(shelfWindow(null, 0, 20, 6)).toEqual({ start: 0, end: 15 });
    expect(shelfWindow(null, 10, 40, 6)).toEqual({ start: 4, end: 25 });
  });

  it('stays inside the row', () => {
    expect(shelfWindow(null, 19, 20, 6)).toEqual({ start: 13, end: 20 });
    expect(shelfWindow(null, 25, 20, 6)).toEqual({ start: 13, end: 20 });
    expect(shelfWindow(null, 3, 4, 6)).toEqual({ start: 0, end: 4 });
    expect(shelfWindow(null, 0, 0, 6)).toEqual({ start: 0, end: 0 });
  });

  it('keeps the same object while the focus has room on both sides', () => {
    const w = shelfWindow(null, 0, 40, 6);
    for (let f = 0; f <= 6; f++) expect(shelfWindow(w, f, 40, 6)).toBe(w);
    expect(shelfWindow(w, 7, 40, 6)).not.toBe(w);
  });

  it('moves when the focus comes near the end, and always holds the focus', () => {
    // Hold Right over a 40-tile row: the focus is mounted with the screen after it at every step.
    let w: ShelfWindow = shelfWindow(null, 0, 40, 6);
    let moves = 0;
    for (let f = 0; f < 40; f++) {
      const next = shelfWindow(w, f, 40, 6);
      if (next !== w) moves++;
      w = next;
      expect(f).toBeGreaterThanOrEqual(w.start);
      // The visible screen and two more.
      expect(Math.min(40, f + 9)).toBeLessThanOrEqual(w.end);
    }
    // About once per screen of presses.
    expect(moves).toBeLessThanOrEqual(6);
  });

  it('keeps a screen of tiles behind the focus when going back', () => {
    let w: ShelfWindow = shelfWindow(null, 39, 40, 6);
    let moves = 0;
    for (let f = 39; f >= 0; f--) {
      const next = shelfWindow(w, f, 40, 6);
      if (next !== w) moves++;
      w = next;
      expect(f - w.start >= 6 || w.start === 0).toBe(true);
      expect(Math.min(40, f + 9)).toBeLessThanOrEqual(w.end);
    }
    expect(moves).toBeLessThanOrEqual(6);
  });

  it('fits again when the row gets shorter or longer', () => {
    const w = shelfWindow(null, 15, 20, 6);
    const shorter = shelfWindow(w, 15, 10, 6);
    expect(shorter.end).toBeLessThanOrEqual(10);
    expect(shorter.start).toBeLessThanOrEqual(9);
    const empty = shelfWindow(null, 0, 0, 6);
    expect(shelfWindow(empty, 0, 20, 6)).toEqual({ start: 0, end: 15 });
  });
});

describe('rowsToMount', () => {
  const base = { mounted: 2, total: 12, contentHeight: 400, rowTop: 0, listHeight: 300 };

  it('adds two rows while less than two lists of rows are below the focused row', () => {
    expect(rowsToMount(base)).toBe(4);
    expect(rowsToMount({ ...base, mounted: 11 })).toBe(12);
  });

  it('keeps what it has when there is enough below', () => {
    expect(rowsToMount({ ...base, contentHeight: 900 })).toBe(2);
    expect(rowsToMount({ ...base, contentHeight: 1200, rowTop: 500 })).toBe(2);
    expect(rowsToMount({ ...base, contentHeight: 1200, rowTop: 700 })).toBe(4);
  });

  it('waits for the list size and stops at the last row', () => {
    expect(rowsToMount({ ...base, listHeight: 0 })).toBe(2);
    expect(rowsToMount({ ...base, mounted: 12 })).toBe(12);
    expect(rowsToMount({ ...base, mounted: 14 })).toBe(12);
  });
});
