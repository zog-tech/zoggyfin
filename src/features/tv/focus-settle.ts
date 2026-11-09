/**
 * TV: work that waits until the focus rests. Pure, so it is unit-tested.
 *
 * A D-pad press that is held moves the focus across many tiles in a second.
 * Each tile that takes the focus pushes its work here; only the work of the
 * last tile runs, once the focus has stayed on it for `delayMs`. A tile that
 * the focus only passes does nothing: no store write, no re-render, no fetch.
 * One timer serves every row on the screen, so a move to another row also
 * drops the work of the row that the focus left.
 * A tile that loses the focus drops its own work (`drop` with its key), so a
 * move from a tile to a control that is not a tile (a "See all" header, the
 * side menu) runs nothing. `drop` touches only work with the same key, so the
 * order of blur and focus between two tiles does not matter: the new tile's
 * work always stays.
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
  /** A new value: it replaces the waiting one and the wait starts again. `key` names its owner for `drop`. */
  push: (value: T, key?: unknown) => void;
  /** Drops the waiting value only if it has this key. */
  drop: (key: unknown) => void;
  /** Drops the waiting value. */
  cancel: () => void;
}

export function createSettle<T>(delayMs: number, onSettle: (value: T) => void, timers: SettleTimers = realTimers): Settle<T> {
  let handle: unknown = null;
  let owner: unknown = undefined;
  const cancel = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    owner = undefined;
  };
  return {
    push: (value, key) => {
      cancel();
      owner = key;
      handle = timers.set(() => {
        handle = null;
        owner = undefined;
        onSettle(value);
      }, delayMs);
    },
    drop: (key) => {
      if (handle !== null && key !== undefined && owner === key) cancel();
    },
    cancel,
  };
}

/** The one settle for the TV focus: a tile pushes a task, and the task of the tile where the focus rests runs. */
export const tvFocusRest: Settle<() => void> = createSettle<() => void>(FOCUS_REST_MS, (run) => run());
