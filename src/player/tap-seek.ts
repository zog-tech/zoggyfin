/**
 * Tap seek (YouTube style) for touch and for the TV remote. A tap has a zone:
 * on a touch screen the left third seeks back, the right third seeks forward
 * and the middle third shows or hides the controls. On TV, Left and Right
 * (with the controls hidden) are the two sides.
 *
 * - A first tap waits `windowMs` for a second tap. With none, it was a single
 *   tap: the effect is `toggle` (touch: show or hide the controls; TV: show them).
 * - A second tap in the window in the same zone (on TV, the same key) is a
 *   double tap: on a side it seeks one step and starts seek mode; in the
 *   middle it toggles. In another zone it replaces the first tap.
 * - In seek mode every tap on a side seeks one more step at once (no wait) and
 *   never toggles. A tap on the other side turns the direction. A middle tap,
 *   or an `end` event (TV: any other key), ends seek mode and does nothing
 *   else. Seek mode ends `seekModeMs` after the last tap.
 * - A `seek` event (TV: the rewind and fast-forward keys) seeks at once and
 *   starts or extends seek mode.
 * - A live item cannot seek: every tap counts as a middle tap.
 *
 * The seconds of a run add up per side, for the feedback bubble.
 *
 * Pure, so it is unit-tested: the caller owns the one timer (`tapSeekDeadline`)
 * and runs the effect that an event returns. An event that does not apply
 * returns the same state object.
 */

import { DOUBLE_PRESS_MS } from './tv-keys';

export interface TapTiming {
  /** How long a first tap waits for a second one (ms). */
  windowMs: number;
  /** Seek mode ends this long after the last tap (ms). */
  seekModeMs: number;
}

/** A finger is quick. */
export const TOUCH_TIMING: TapTiming = { windowMs: 300, seekModeMs: 800 };

/** A remote is slower than a finger: presses of a run come further apart. */
export const REMOTE_TIMING: TapTiming = { windowMs: DOUBLE_PRESS_MS, seekModeMs: 1000 };

export type TapZone = 'left' | 'middle' | 'right';
export type TapSide = 'left' | 'right';

/** The seconds of one step on each side (both positive). */
export interface SeekSteps {
  left: number;
  right: number;
}

export type TapSeekState =
  /** No tap in progress. */
  | { phase: 'idle' }
  /** One tap; a second tap may still come until `until`. */
  | { phase: 'pending'; zone: TapZone; until: number }
  /** Seek mode: `seconds` sought on `side` since the run turned to it. It ends at `until`. */
  | { phase: 'seeking'; side: TapSide; seconds: number; until: number };

export const TAP_IDLE: TapSeekState = { phase: 'idle' };

export type TapSeekEvent =
  /** A tap ended in `zone` at `now`. `live`: the item cannot seek. */
  | { type: 'tap'; zone: TapZone; live: boolean; now: number; step: SeekSteps; timing: TapTiming }
  /** Seek one step at once (a media key). */
  | { type: 'seek'; side: TapSide; now: number; step: SeekSteps; timing: TapTiming }
  /** Another input came: drop a waiting tap and end seek mode, with no effect. */
  | { type: 'end' }
  /** The timer from `tapSeekDeadline` fired. */
  | { type: 'tick'; now: number };

export type TapSeekEffect =
  | { type: 'toggle' }
  /** Seek `seconds` (negative: back). */
  | { type: 'seek'; seconds: number }
  | null;

export interface TapSeekResult {
  state: TapSeekState;
  effect: TapSeekEffect;
}

/** The zone of a tap at `x` in a view `width` wide. */
export function tapZone(x: number, width: number): TapZone {
  const third = width / 3;
  if (x <= third) return 'left';
  if (x >= third * 2) return 'right';
  return 'middle';
}

/** When the caller must send a `tick` (ms since the epoch), or null for no timer. */
export function tapSeekDeadline(state: TapSeekState): number | null {
  return state.phase === 'idle' ? null : state.until;
}

const TOGGLE: TapSeekEffect = { type: 'toggle' };

/** One more step on `side`; the seconds add up while the run stays on that side. */
function seek(prev: TapSeekState, side: TapSide, now: number, step: SeekSteps, timing: TapTiming): TapSeekResult {
  const seconds = step[side];
  const total = prev.phase === 'seeking' && prev.side === side ? prev.seconds + seconds : seconds;
  return {
    state: { phase: 'seeking', side, seconds: total, until: now + timing.seekModeMs },
    effect: { type: 'seek', seconds: side === 'left' ? -seconds : seconds },
  };
}

export function tapSeekTransition(state: TapSeekState, e: TapSeekEvent): TapSeekResult {
  if (e.type === 'end') return { state: state.phase === 'idle' ? state : TAP_IDLE, effect: null };

  const expired = state.phase !== 'idle' && e.now >= state.until;
  if (e.type === 'tick') {
    if (!expired) return { state, effect: null };
    // A first tap with no second one was a single tap.
    return { state: TAP_IDLE, effect: state.phase === 'pending' ? TOGGLE : null };
  }

  if (e.type === 'seek') return seek(expired ? TAP_IDLE : state, e.side, e.now, e.step, e.timing);

  const zone: TapZone = e.live ? 'middle' : e.zone;
  const first: TapSeekState = { phase: 'pending', zone, until: e.now + e.timing.windowMs };
  switch (state.phase) {
    case 'idle':
      return { state: first, effect: null };
    case 'pending':
      // The timer was late: the first tap was a single tap, and this one starts again.
      if (expired) return { state: first, effect: TOGGLE };
      // A pair needs the same zone (on TV, the same key): else this tap starts again.
      if (zone !== state.zone) return { state: first, effect: null };
      if (zone === 'middle') return { state: TAP_IDLE, effect: TOGGLE };
      return seek(state, zone, e.now, e.step, e.timing);
    case 'seeking':
      if (expired) return { state: first, effect: null };
      if (zone === 'middle') return { state: TAP_IDLE, effect: null };
      return seek(state, zone, e.now, e.step, e.timing);
  }
}
