/**
 * Hides player content while the screen turns (see turn-fade.ts).
 *
 * It listens to `Dimensions` directly, not through a render: the shared value
 * goes to 0 in the first frame JS hears of the turn, before the screen renders
 * the new layout. A screen that passes `laidOut` (the size its layout used)
 * gets the content back only after that layout has the new orientation.
 * TV windows never turn, so TV gets a constant 1. An iOS build with the
 * native crossfade (`TurnCrossfade`) also gets 1: the native view covers the
 * turn with a picture of the old layout, so nothing goes blank.
 */
import { useEffect, useRef } from 'react';
import { Dimensions, type ScaledSize } from 'react-native';
import { type SharedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { hasNativeTurnCrossfade } from '@/native/turn-crossfade';
import { isTV } from '@/platform/tv';
import { ease } from './tokens';
import { caughtUp, type Size, TURN_FADE_IN_MS, turned, turnWait } from './turn-fade';

interface TurnState {
  hiddenAt: number | null;
  changedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  window: Size;
  laidOut: Size | null;
  /** Starts the wait for the content to come back; set by the effect. */
  check: () => void;
}

/** 1 normally, 0 while the screen turns. Multiply the content's opacity by it. */
export function useTurnFade(laidOut?: Size): SharedValue<number> {
  const shown = useSharedValue(1);
  const reduced = useReducedMotion();
  const state = useRef<TurnState>({ hiddenAt: null, changedAt: 0, timer: null, window: { width: 0, height: 0 }, laidOut: null, check: () => {} });

  useEffect(() => {
    if (isTV || hasNativeTurnCrossfade) return;
    const st = state.current;
    st.window = Dimensions.get('window');
    const check = () => {
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      if (st.hiddenAt === null) return;
      const wait = turnWait({
        now: Date.now(),
        hiddenAt: st.hiddenAt,
        changedAt: st.changedAt,
        layoutReady: st.laidOut ? caughtUp(st.laidOut, st.window) : true,
        tracksLayout: st.laidOut !== null,
      });
      if (wait > 0) {
        st.timer = setTimeout(check, wait);
        return;
      }
      st.hiddenAt = null;
      shown.set(reduced ? 1 : withTiming(1, { duration: TURN_FADE_IN_MS, easing: ease.enter }));
    };
    st.check = check;
    const sub = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
      const turning = turned(st.window, window);
      st.window = window;
      // A later size change during the turn (the insets, the status bar) restarts the wait.
      if (!turning && st.hiddenAt === null) return;
      st.changedAt = Date.now();
      if (turning && st.hiddenAt === null) {
        st.hiddenAt = st.changedAt;
        shown.set(0);
      }
      check();
    });
    return () => {
      sub.remove();
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      st.hiddenAt = null;
      st.check = () => {};
      shown.set(1);
    };
  }, [shown, reduced]);

  // The screen rendered with a new size: the wait counts from now.
  const w = laidOut?.width ?? 0;
  const h = laidOut?.height ?? 0;
  const tracks = laidOut !== undefined;
  useEffect(() => {
    const st = state.current;
    st.laidOut = tracks ? { width: w, height: h } : null;
    if (st.hiddenAt === null) return;
    st.changedAt = Date.now();
    st.check();
  }, [w, h, tracks]);

  return shown;
}
