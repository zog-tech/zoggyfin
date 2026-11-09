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

  it('uses the timers it is given', () => {
    const pending: (() => void)[] = [];
    const cleared: unknown[] = [];
    const settle = createSettle<number>(
      100,
      (v) => cleared.push(`ran ${v}`),
      { set: (run) => pending.push(run), clear: (h) => cleared.push(h) },
    );
    settle.push(1);
    settle.push(2);
    // The first handle (1, from push) was cleared by the second push.
    expect(cleared).toEqual([1]);
    pending[1]();
    expect(cleared).toEqual([1, 'ran 2']);
  });
});
