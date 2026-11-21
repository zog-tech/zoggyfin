/**
 * Who uses the loaded channel lists. Lite mode (`platform/lite.ts`) drops the
 * lists from memory when no Live TV page uses them: on a 1 GB TV stick the
 * lists of two providers (about 20,000 channels) held about 16 MB of the JS
 * heap after the user had left Live TV.
 *
 * A page takes a hold while it is mounted. When the last hold ends, the
 * release waits `delayMs`, so a quick page change (Live TV to a channel's
 * page and back) does not read the file again. A background job that loaded
 * the lists (the guide download) calls `idle()` when it ends.
 *
 * Pure (the release, the Lite check and the timer come in), so it is unit-tested.
 */
export interface ChannelHolds {
  /** Takes a hold; the function it returns ends it. */
  hold(): () => void;
  /** A job that loaded lists is done: release them if nothing holds them. */
  idle(): void;
}

export interface HoldDeps {
  release: () => void;
  /** True when the device is in Lite mode now. */
  enabled: () => boolean;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** The wait after the last hold: long enough for a quick page change. */
export const RELEASE_DELAY_MS = 10_000;

export function createChannelHolds({
  release,
  enabled,
  delayMs = RELEASE_DELAY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}: HoldDeps): ChannelHolds {
  let count = 0;
  let timer: unknown = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    cancel();
    if (count > 0 || !enabled()) return;
    timer = setTimer(() => {
      timer = null;
      if (count === 0 && enabled()) release();
    }, delayMs);
  };
  return {
    hold() {
      count += 1;
      cancel();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        count -= 1;
        schedule();
      };
    },
    idle: schedule,
  };
}
