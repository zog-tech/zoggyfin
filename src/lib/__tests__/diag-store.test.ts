import type { KeyValueStore } from '@/storage/kv-types';

import { parseLog } from '../diag-log';
import { DIAG_KEY, diag, diagEntries, flushDiag, resetDiagForTests, startDiagLog } from '../diag-store';

function memoryStore(initial?: Record<string, string>): KeyValueStore & { sets: number; map: Map<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  const s = {
    sets: 0,
    map,
    getString: (k: string) => map.get(k),
    set: (k: string, v: string) => {
      s.sets += 1;
      map.set(k, v);
    },
    remove: (k: string) => {
      map.delete(k);
    },
    clearAll: () => map.clear(),
  };
  return s;
}

describe('diag store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetDiagForTests();
  });
  afterEach(() => {
    resetDiagForTests();
    jest.useRealTimers();
  });

  it('keeps entries in memory before the start and joins them to the saved log', () => {
    const saved = JSON.stringify({ v: 1, entries: [{ t: 1, area: 'audio', event: 'old' }] });
    const kv = memoryStore({ [DIAG_KEY]: saved });
    diag('audio', 'early', { n: 1 });
    const stop = startDiagLog(kv);
    expect(diagEntries().map((e) => e.event)).toEqual(['old', 'early', 'start']);
    stop();
  });

  it('writes at most once per 2 s, not on every entry', () => {
    const kv = memoryStore();
    const stop = startDiagLog(kv);
    for (let i = 0; i < 50; i++) diag('audio', 'status', { i });
    expect(kv.sets).toBe(0);
    jest.advanceTimersByTime(2000);
    expect(kv.sets).toBe(1);
    expect(parseLog(kv.map.get(DIAG_KEY))).toHaveLength(51);
    jest.advanceTimersByTime(10_000);
    expect(kv.sets).toBe(1);
    diag('audio', 'pause');
    flushDiag();
    expect(kv.sets).toBe(2);
    stop();
  });

  it('never throws, also when the store fails', () => {
    const kv = memoryStore();
    kv.set = () => {
      throw new Error('full');
    };
    const stop = startDiagLog(kv);
    expect(() => diag('audio', 'x', { a: { deep: 1 } })).not.toThrow();
    expect(() => flushDiag()).not.toThrow();
    stop();
  });
});
