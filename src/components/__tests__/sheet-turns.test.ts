import { afterSheets, createSheetTurns, modalUp, nextPhase, type SheetPhase } from '../sheet-turns';

describe('nextPhase', () => {
  it('opens through waiting, and leaves through leaving', () => {
    let p: SheetPhase = 'hidden';
    p = nextPhase(p, 'open');
    expect(p).toBe('waiting');
    p = nextPhase(p, 'clear');
    expect(p).toBe('shown');
    p = nextPhase(p, 'close');
    expect(p).toBe('leaving');
    p = nextPhase(p, 'left');
    expect(p).toBe('hidden');
  });

  it('never shows a sheet that was closed while it waited', () => {
    const p = nextPhase(nextPhase('hidden', 'open'), 'close');
    expect(p).toBe('hidden');
    expect(nextPhase(p, 'clear')).toBe('hidden');
  });

  it('brings a sheet back that is opened while it leaves', () => {
    expect(nextPhase('leaving', 'open')).toBe('shown');
    // The end of the old exit animation does not hide it.
    expect(nextPhase('shown', 'left')).toBe('shown');
  });

  it('returns the same phase when the event does not apply', () => {
    expect(nextPhase('hidden', 'close')).toBe('hidden');
    expect(nextPhase('hidden', 'left')).toBe('hidden');
    expect(nextPhase('shown', 'open')).toBe('shown');
    expect(nextPhase('shown', 'clear')).toBe('shown');
    expect(nextPhase('leaving', 'close')).toBe('leaving');
  });

  it('has the modal up only while shown or leaving', () => {
    expect(modalUp('hidden')).toBe(false);
    expect(modalUp('waiting')).toBe(false);
    expect(modalUp('shown')).toBe(true);
    expect(modalUp('leaving')).toBe(true);
  });
});

describe('createSheetTurns', () => {
  it('runs at once when no sheet is leaving', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    t.whenClear(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('holds a new sheet until the leaving one is gone', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    t.leaving(1);
    t.whenClear(fn);
    expect(fn).not.toHaveBeenCalled();
    t.gone(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // Only once.
    t.leaving(1);
    t.gone(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for every leaving sheet', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    t.leaving(1);
    t.leaving(2);
    t.whenClear(fn);
    t.gone(1);
    expect(fn).not.toHaveBeenCalled();
    t.gone(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not run a cancelled wait', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    t.leaving(1);
    const cancel = t.whenClear(fn);
    cancel();
    t.gone(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores gone for a sheet that was not leaving', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    t.leaving(1);
    t.whenClear(fn);
    t.gone(7);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('afterSheets', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for a sheet that starts to leave right after the press', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    afterSheets(fn, t);
    // The close reaches the sheet in the next render.
    t.leaving(1);
    jest.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
    t.gone(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs on the next turn when no sheet leaves', () => {
    const t = createSheetTurns();
    const fn = jest.fn();
    afterSheets(fn, t);
    expect(fn).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
