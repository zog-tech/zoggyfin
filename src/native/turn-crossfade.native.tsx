import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ReactNode } from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';

import type { Size } from './turn-crossfade-types';

interface NativeProps {
  layoutSize: [number, number];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const NativeTurnView =
  Platform.OS === 'ios' && requireOptionalNativeModule('ZoggyfinTurn') !== null ? requireNativeView<NativeProps>('ZoggyfinTurn') : null;

/** True when this build crossfades a turn natively (iOS builds with the view). */
export const hasNativeTurnCrossfade = NativeTurnView !== null;

/**
 * Crossfades the old layout into the new one when the screen turns
 * (modules/zoggyfin-native/ios/TurnCrossfadeView.swift). `layoutSize` is the
 * size the children were laid out with: the old picture fades out when it has
 * the new orientation. Without the native view it is a plain View.
 */
export function TurnCrossfade({ layoutSize, style, children }: { layoutSize: Size; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  if (!NativeTurnView) return <View style={style}>{children}</View>;
  return (
    <NativeTurnView layoutSize={[layoutSize.width, layoutSize.height]} style={style}>
      {children}
    </NativeTurnView>
  );
}
