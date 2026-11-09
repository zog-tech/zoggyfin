import { createGate, createKeyedGate, createSerialRunner } from '@/lib/async-gate';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createGate', () => {
  it('keeps only the newest token current', () => {
    const gate = createGate();
    const a = gate.begin();
    expect(gate.current(a)).toBe(true);
    const b = gate.begin();
    expect(gate.current(a)).toBe(false);
    expect(gate.current(b)).toBe(true);
  });

  it('cancel makes the open token stale', () => {
    const gate = createGate();
    const a = gate.begin();
    gate.cancel();
    expect(gate.current(a)).toBe(false);
    expect(gate.current(gate.begin())).toBe(true);
  });
});

describe('createKeyedGate', () => {
  it('keeps keys apart', () => {
    const gate = createKeyedGate<string>();
    const a = gate.begin('a');
    const b = gate.begin('b');
    expect(gate.current('a', a)).toBe(true);
    expect(gate.current('b', b)).toBe(true);
    const a2 = gate.begin('a');
    expect(gate.current('a', a)).toBe(false);
    expect(gate.current('a', a2)).toBe(true);
    expect(gate.current('b', b)).toBe(true);
  });

  it('cancel and cancelAll make tokens stale, and tokens never repeat', () => {
    const gate = createKeyedGate<string>();
    const a = gate.begin('a');
    gate.cancel('a');
    expect(gate.current('a', a)).toBe(false);
    const b = gate.begin('b');
    gate.cancelAll();
    expect(gate.current('b', b)).toBe(false);
    const b2 = gate.begin('b');
    expect(b2).not.toBe(b);
    expect(gate.current('b', b)).toBe(false);
  });
});

describe('createSerialRunner', () => {
  it('runs once for a single request', async () => {
    const run = jest.fn(async () => {});
    const runner = createSerialRunner(run);
    await runner.request();
    expect(run).toHaveBeenCalledTimes(1);
    expect(runner.running()).toBe(false);
  });

  it('runs once more after the current run when asked during it', async () => {
    const first = deferred();
    const calls: number[] = [];
    let n = 0;
    const runner = createSerialRunner(async () => {
      n += 1;
      calls.push(n);
      if (n === 1) await first.promise;
    });
    const p1 = runner.request();
    const p2 = runner.request();
    const p3 = runner.request();
    expect(runner.running()).toBe(true);
    first.resolve();
    await Promise.all([p1, p2, p3]);
    // Three requests, but the two made during run 1 share one rerun.
    expect(calls).toEqual([1, 2]);
    expect(runner.running()).toBe(false);
  });

  it('reset drops the queued rerun', async () => {
    const first = deferred();
    const run = jest.fn(() => first.promise);
    const runner = createSerialRunner(run);
    const p = runner.request();
    void runner.request();
    runner.reset();
    first.resolve();
    await p;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still reruns after a failed run, and rejects only when the last run fails', async () => {
    const first = deferred();
    let n = 0;
    const runner = createSerialRunner(async () => {
      n += 1;
      if (n === 1) {
        await first.promise;
      }
    });
    const p = runner.request();
    void runner.request();
    first.reject(new Error('boom'));
    await expect(p).resolves.toBeUndefined();
    expect(n).toBe(2);
  });

  it('rejects when the only run fails, and accepts new requests after', async () => {
    let fail = true;
    const runner = createSerialRunner(async () => {
      if (fail) throw new Error('boom');
    });
    await expect(runner.request()).rejects.toThrow('boom');
    expect(runner.running()).toBe(false);
    fail = false;
    await expect(runner.request()).resolves.toBeUndefined();
  });
});
