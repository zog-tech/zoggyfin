/**
 * Async gates: small, explicit forms of the two implicit state machines that
 * recur in this app.
 *
 * 1. Latest wins (`createGate`, `createKeyedGate`). A screen or a service starts
 *    async work, and newer work (a new item, Cancel, an account switch) makes
 *    the old result stale. Without a token the late result overwrites the new
 *    state: a closed sheet closes the next one, an old guide replaces a new one.
 *    Take a token with `begin()` before the first await. After each await, stop
 *    when `current(token)` is false. `cancel()` makes every open token stale.
 *
 * 2. One run at a time, with one more after it (`createSerialRunner`). A
 *    request during a run must not join that run, because the run read its
 *    inputs before the request (a provider added, an address edited). The
 *    runner runs once more after the current run, and the promise of the
 *    request settles only after that run.
 *
 * Pure, so it is unit-tested. No React, no timers, no native imports.
 */

export interface Gate {
  /** Starts new work. Every older token becomes stale. */
  begin(): number;
  /** True while `token` is the newest one and no `cancel()` came after it. */
  current(token: number): boolean;
  /** Makes every open token stale (Cancel, close, unmount, account switch). */
  cancel(): void;
}

export function createGate(): Gate {
  let latest = 0;
  return {
    begin: () => ++latest,
    current: (token) => token === latest,
    cancel: () => {
      latest += 1;
    },
  };
}

/** A gate per key: work for one key never makes work for another key stale. */
export interface KeyedGate<K> {
  begin(key: K): number;
  current(key: K, token: number): boolean;
  cancel(key: K): void;
  cancelAll(): void;
}

export function createKeyedGate<K>(): KeyedGate<K> {
  // One counter for all keys, so a token never repeats after cancelAll().
  let counter = 0;
  const latest = new Map<K, number>();
  return {
    begin(key) {
      counter += 1;
      latest.set(key, counter);
      return counter;
    },
    current: (key, token) => latest.get(key) === token,
    cancel(key) {
      latest.delete(key);
    },
    cancelAll() {
      latest.clear();
    },
  };
}

export interface SerialRunner {
  /**
   * Starts a run, or asks for one more run after the current one. The promise
   * settles when no run is left that started before this request.
   */
  request(): Promise<void>;
  /** True while a run is in progress. */
  running(): boolean;
  /** Drops a queued rerun (account switch). The current run still ends. */
  reset(): void;
}

/**
 * `run` errors reject the promise of every request that waits on that run.
 * A rerun that was asked for still happens after a failed run, so a request
 * made during a failing run is not lost.
 */
export function createSerialRunner(run: () => Promise<void>): SerialRunner {
  let active: Promise<void> | null = null;
  let again = false;

  const loop = async (): Promise<void> => {
    let failure: unknown = null;
    let failed = false;
    try {
      do {
        again = false;
        try {
          await run();
          failed = false;
        } catch (e) {
          failure = e;
          failed = true;
        }
      } while (again);
    } finally {
      active = null;
    }
    if (failed) throw failure;
  };

  return {
    request() {
      if (active) {
        again = true;
        return active;
      }
      active = loop();
      return active;
    },
    running: () => active !== null,
    reset() {
      again = false;
    },
  };
}
