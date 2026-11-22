/**
 * Hides the player controls while the screen turns (see turn-fade.ts).
 *
 * It listens to `Dimensions` directly, not through a render: the shared value
 * goes to 0 in the first frame JS hears of the turn, before the screen renders
 * the new layout. TV windows never turn, so TV gets a constant 1.
 */
import { useEffect } from 'react';
import { Dimensions, type ScaledSize } from 'react-native';
import { type SharedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { isTV } from '@/platform/tv';
import { ease } from './tokens';
import { TURN_FADE_IN_MS, TURN_SETTLE_MS, turned } from './turn-fade';

/** 1 normally, 0 while the screen turns. Multiply the controls' opacity by it. */
export function useTurnFade(): SharedValue<number> {
  const shown = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (isTV) return;
    let last = Dimensions.get('window');
    let settle: ReturnType<typeof setTimeout> | null = null;
    const sub = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
      const turning = turned(last, window);
      last = window;
      // A later size change during the turn (the insets, the status bar) restarts the wait.
      if (!turning && !settle) return;
      if (turning) shown.set(0);
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        shown.set(reduced ? 1 : withTiming(1, { duration: TURN_FADE_IN_MS, easing: ease.enter }));
      }, TURN_SETTLE_MS);
    });
    return () => {
      sub.remove();
      if (settle) clearTimeout(settle);
      shown.set(1);
    };
  }, [shown, reduced]);
  return shown;
}
