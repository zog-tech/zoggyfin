import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import type { Size } from './turn-crossfade-types';

/** The web and the Mac app: a window resize is not a turn, so this is a plain View. */
export const hasNativeTurnCrossfade = false;

export function TurnCrossfade({ style, children }: { layoutSize: Size; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View style={style}>{children}</View>;
}
