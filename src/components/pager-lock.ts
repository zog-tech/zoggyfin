/**
 * Lets a row inside a swipeable pager (`tab-pager.tsx`) stop the pager from
 * paging while a finger is on the row. A horizontal swipe on the row then
 * runs the row's action and never turns the page.
 *
 * The native pager starts its own pan after a few points, and a gesture on
 * the row cannot make it wait. So the row holds the lock from the touch down
 * (`hold`) to the touch end (`release`). Holds are counted: two rows can hold
 * at once (two fingers).
 */
import { createContext, useContext } from 'react';

export interface PagerLock {
  hold(): void;
  release(): void;
  /** Connects the pager (`apply(false)` stops paging). Returns the disconnect. */
  attach(apply: (scrollEnabled: boolean) => void): () => void;
}

export const PagerLockContext = createContext<PagerLock | null>(null);

/** The lock of the pager around this view, or null outside a pager. */
export function usePagerLock(): PagerLock | null {
  return useContext(PagerLockContext);
}

/** A counted lock: `apply(false)` on the first hold, `apply(true)` when the last one is released. */
export function createPagerLock(): PagerLock {
  let holds = 0;
  let apply: ((scrollEnabled: boolean) => void) | null = null;
  return {
    hold() {
      holds += 1;
      if (holds === 1) apply?.(false);
    },
    release() {
      if (holds === 0) return;
      holds -= 1;
      if (holds === 0) apply?.(true);
    },
    attach(fn) {
      apply = fn;
      return () => {
        if (apply === fn) apply = null;
      };
    },
  };
}
