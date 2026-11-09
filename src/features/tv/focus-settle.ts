/**
 * TV: work that waits until the focus rests. Pure, so it is unit-tested.
 *
 * A D-pad press that is held moves the focus across many tiles in a second.
 * Each tile that takes the focus pushes its work here; only the work of the
 * last tile runs, once the focus has stayed on it for `delayMs`. A tile that
 * the focus only passes does nothing: no store write, no re-render, no fetch.
 * One timer serves every row on the screen, so a move to another row also
 * drops the work of the row that the focus left.
 */

/** How long the focus must stay on a tile before its work runs (ms). */
export const FOCUS_REST_MS = 500;

export interface SettleTimers {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: SettleTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Settle<T> {
  /** A new value: it replaces the waiting one and the wait starts again. */
  push: (value: T) => void;
  /** Drops the waiting value. */
  cancel: () => void;
}

export function createSettle<T>(delayMs: number, onSettle: (value: T) => void, timers: SettleTimers = realTimers): Settle<T> {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    push: (value) => {
      cancel();
      handle = timers.set(() => {
        handle = null;
        onSettle(value);
      }, delayMs);
    },
    cancel,
  };
}

/** The one settle for the TV focus: a tile pushes a task, and the task of the tile where the focus rests runs. */
export const tvFocusRest: Settle<() => void> = createSettle<() => void>(FOCUS_REST_MS, (run) => run());
