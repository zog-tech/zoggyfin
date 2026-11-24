/**
 * The life of a sheet, and the order in which sheets show.
 *
 * A sheet is a native `Modal`. It leaves with an animation, so the modal
 * stays up for a moment after the caller closed it. A row often closes its
 * sheet and opens the next one in the same press (More, then Add to
 * playlist). On iOS a second modal that is presented while the first one
 * goes is refused, and its hidden view then takes every touch. So a sheet
 * that wants to open waits until no sheet is on its way out.
 *
 * Phases: hidden → waiting (another sheet is leaving) → shown → leaving →
 * hidden. The modal is up in `shown` and `leaving`.
 *
 * Pure, so it is unit-tested.
 */

export type SheetPhase = 'hidden' | 'waiting' | 'shown' | 'leaving';

export type SheetEvent =
  /** The caller set `visible`. */
  | 'open'
  /** The caller cleared `visible`. */
  | 'close'
  /** No sheet is leaving: the modal can come up. */
  | 'clear'
  /** The exit animation ended. */
  | 'left';

/** The next phase. The same phase when the event does not apply. */
export function nextPhase(phase: SheetPhase, event: SheetEvent): SheetPhase {
  switch (event) {
    case 'open':
      // A sheet opened again while it leaves comes back; its modal is still up.
      return phase === 'hidden' ? 'waiting' : phase === 'leaving' ? 'shown' : phase;
    case 'close':
      return phase === 'waiting' ? 'hidden' : phase === 'shown' ? 'leaving' : phase;
    case 'clear':
      return phase === 'waiting' ? 'shown' : phase;
    case 'left':
      return phase === 'leaving' ? 'hidden' : phase;
  }
}

/** True while the native modal is up. */
export function modalUp(phase: SheetPhase): boolean {
  return phase === 'shown' || phase === 'leaving';
}

export interface SheetTurns {
  /** Sheet `id` started to leave. */
  leaving(id: number): void;
  /** The modal of sheet `id` is gone (or the sheet came back, or unmounted). */
  gone(id: number): void;
  /** Runs `fn` when no sheet is leaving: now, or later. Returns a cancel function. */
  whenClear(fn: () => void): () => void;
}

export function createSheetTurns(): SheetTurns {
  const out = new Set<number>();
  let waiting: (() => void)[] = [];
  return {
    leaving(id) {
      out.add(id);
    },
    gone(id) {
      if (!out.delete(id) || out.size > 0) return;
      const run = waiting;
      waiting = [];
      run.forEach((fn) => fn());
    },
    whenClear(fn) {
      if (out.size === 0) {
        fn();
        return () => undefined;
      }
      waiting.push(fn);
      return () => {
        waiting = waiting.filter((x) => x !== fn);
      };
    },
  };
}

/** One order for every sheet in the app. */
export const sheetTurns = createSheetTurns();

/**
 * Runs `fn` after the sheet that was just closed has gone. A row closes its
 * sheet and then acts, and the act often shows system UI (the share sheet, a
 * confirm dialog, the next sheet). iOS refuses that, or closes it with the
 * sheet, while the sheet's modal is still up.
 *
 * The close reaches the sheet in the render after the press, so the check
 * waits one turn of the event loop for it.
 */
export function afterSheets(fn: () => void, turns: SheetTurns = sheetTurns): void {
  setTimeout(() => turns.whenClear(fn), 0);
}

let ids = 0;
export function nextSheetId(): number {
  ids += 1;
  return ids;
}
