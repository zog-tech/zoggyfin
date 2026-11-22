import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import type { Size } from './turn-crossfade-types';

/** The web and the Mac app: a window resize is not a turn, so this is a plain View. */
export const hasNativeTurnCrossfade = false;
export const nativeTurnHidesContent = false;

export function TurnCrossfade({ style, pointerEvents, children }: { layoutSize: Size; hidesContent?: boolean; style?: StyleProp<ViewStyle>; pointerEvents?: ViewProps['pointerEvents']; children?: ReactNode }) {
  return <View style={style} pointerEvents={pointerEvents}>
      {children}
    </View>;
}
