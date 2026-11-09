import { createSettle, FOCUS_REST_MS } from '../focus-settle';

describe('createSettle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once for the last value after fast moves', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      settle.push(id);
      jest.advanceTimersByTime(80);
    }
    expect(seen).toEqual([]);
    jest.advanceTimersByTime(FOCUS_REST_MS);
    expect(seen).toEqual(['e']);
  });

  it('runs when the focus rests, and not before', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    settle.push('a');
    jest.advanceTimersByTime(FOCUS_REST_MS - 1);
    expect(seen).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(seen).toEqual(['a']);
    settle.push('b');
    jest.advanceTimersByTime(FOCUS_REST_MS);
    expect(seen).toEqual(['a', 'b']);
  });

  it('runs nothing after cancel', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    settle.push('a');
    settle.cancel();
    jest.advanceTimersByTime(FOCUS_REST_MS * 2);
    expect(seen).toEqual([]);
  });

  it('runs nothing when the focus leaves a tile for a control that is not a tile', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    settle.push('a', 'tile-a');
    jest.advanceTimersByTime(200);
    settle.drop('tile-a'); // blur of A; the next control pushes nothing
    jest.advanceTimersByTime(FOCUS_REST_MS);
    expect(seen).toEqual([]);
  });

  it('keeps the new tile when blur and focus come in either order', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    // Blur of A, then focus of B.
    settle.push('a', 'tile-a');
    settle.drop('tile-a');
    settle.push('b', 'tile-b');
    // Focus of C, then blur of B: the blur must not drop C.
    settle.push('c', 'tile-c');
    settle.drop('tile-b');
    jest.advanceTimersByTime(FOCUS_REST_MS);
    expect(seen).toEqual(['c']);
  });

  it('never drops work that has no key', () => {
    const seen: string[] = [];
    const settle = createSettle<string>(FOCUS_REST_MS, (v) => seen.push(v));
    settle.push('a');
    settle.drop(undefined);
    jest.advanceTimersByTime(FOCUS_REST_MS);
    expect(seen).toEqual(['a']);
  });

  it('uses the timers it is given', () => {
    const pending = new Map<number, () => void>();
    const cleared: unknown[] = [];
    const ran: number[] = [];
    let nextId = 100;
    const settle = createSettle<number>(100, (v) => ran.push(v), {
      set: (run) => {
        const id = nextId++;
        pending.set(id, run);
        return id;
      },
      clear: (h) => cleared.push(h),
    });
    settle.push(1);
    settle.push(2);
    // The second push cleared the first timer (id 100).
    expect(cleared).toEqual([100]);
    pending.get(101)?.();
    expect(ran).toEqual([2]);
  });
});
