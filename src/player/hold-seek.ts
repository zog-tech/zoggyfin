/**
 * Hold to seek on the TV remote: a held Left or Right (or rewind or fast
 * forward) moves the seek target like a DVD player's fast forward. The speed
 * rises the longer the key is held: 10×, then 30×, 60×, 120×, 240× and 480×,
 * one step every HOLD_STEP_MS, up to the top speed the user chose (Settings,
 * Playback). 10× moves the target 10 s of video each second, 240× 4 minutes.
 * The first second is slow, so a short hold lands near where it began; a
 * long one crosses a film in seconds (a top of 10× was far too slow).
 *
 * The player shows the target on the seek bar with the speed, and seeks once,
 * when the key is let go: one seek, so the buffer loads once, not on every
 * step. The video plays on where it was until then.
 *
 * Pure, so it is unit-tested.
 */

/** The speeds of a hold, in order. */
export const HOLD_SPEEDS = [10, 30, 60, 120, 240, 480] as const;

/** The top speeds offered in Settings. Each is one of HOLD_SPEEDS. */
export const HOLD_TOP_CHOICES: readonly number[] = [30, 60, 120, 240, 480];

/** The top speed until the user picks one. */
export const DEFAULT_HOLD_TOP = 240;

/** How long each speed lasts before the next one (ms). */
export const HOLD_STEP_MS = 1000;

/** A hold this long ends by itself (a lost key-up must not seek to the end). */
export const HOLD_MAX_MS = 2 * 60 * 1000;

/** The speeds up to `top`. A top below the first speed keeps the first speed. */
function ladder(top: number): number[] {
  const steps = HOLD_SPEEDS.filter((s) => s <= top);
  return steps.length ? steps : [HOLD_SPEEDS[0]];
}

/** The speed after the key was held `heldMs`. */
export function holdSpeed(heldMs: number, top: number): number {
  const steps = ladder(top);
  const i = Math.floor(Math.max(0, heldMs) / HOLD_STEP_MS);
  return steps[Math.min(steps.length - 1, i)];
}

/** The seconds of video the target has moved after the key was held `heldMs`: each step at its speed. */
export function holdDistance(heldMs: number, top: number): number {
  const steps = ladder(top);
  let left = Math.max(0, heldMs);
  let ms = 0;
  for (let i = 0; i < steps.length && left > 0; i++) {
    const span = i === steps.length - 1 ? left : Math.min(left, HOLD_STEP_MS);
    ms += span * steps[i];
    left -= span;
  }
  return ms / 1000;
}

/** A hold in progress. */
export interface HoldSeek {
  /** -1: back (Left, rewind); 1: forward. */
  dir: -1 | 1;
  /** Where the target was when the hold began (s). */
  from: number;
  /** When the hold began (ms). */
  start: number;
}

/** The target at `now` (s), inside the video. `duration` 0 or less: not known, only the start bounds it. */
export function holdTarget(hold: HoldSeek, now: number, top: number, duration: number): number {
  const to = hold.from + hold.dir * holdDistance(now - hold.start, top);
  return Math.min(Math.max(0, to), duration > 0 ? duration : Math.max(0, to));
}

/** "4 min a second": how far the target moves each second at `speed`. */
export function holdPaceLabel(speed: number): string {
  return speed < 60 ? `${speed} s a second` : `${speed / 60} min a second`;
}

/** The direction of a key that seeks when held, or null. */
export function holdDirection(key: string): -1 | 1 | null {
  if (key === 'left' || key === 'rewind') return -1;
  if (key === 'right' || key === 'fastForward') return 1;
  return null;
}

/** A top speed from saved settings: one of the choices, or the default. */
export function validHoldTop(value: unknown): number {
  return typeof value === 'number' && HOLD_TOP_CHOICES.includes(value) ? value : DEFAULT_HOLD_TOP;
}
