import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ReactNode } from 'react';
import { Platform, type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import type { Size } from './turn-crossfade-types';

interface NativeProps {
  layoutSize: [number, number];
  hidesContent?: boolean;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: ViewProps['pointerEvents'];
  children?: ReactNode;
}

const turnModule = Platform.OS === 'ios' ? requireOptionalNativeModule<{ hidesContent?: boolean }>('ZoggyfinTurn') : null;
const NativeTurnView = turnModule ? requireNativeView<NativeProps>('ZoggyfinTurn') : null;

/** True when this build crossfades a turn natively (iOS builds with the view). */
export const hasNativeTurnCrossfade = NativeTurnView !== null;
/** True when the native view also hides its own children during the turn (`hidesContent`; iOS build 24 and later). */
export const nativeTurnHidesContent = turnModule?.hidesContent === true;

/**
 * Crossfades the old layout into the new one when the screen turns
 * (modules/zoggyfin-native/ios/TurnCrossfadeView.swift). `layoutSize` is the
 * size the children were laid out with: the old picture fades out when it has
 * the new orientation. Without the native view it is a plain View.
 * `hidesContent`: the children are not opaque (overlays over a video), so the
 * view hides them under the picture and crossfades the two.
 */
export function TurnCrossfade({ layoutSize, hidesContent, style, pointerEvents, children }: { layoutSize: Size; hidesContent?: boolean; style?: StyleProp<ViewStyle>; pointerEvents?: ViewProps['pointerEvents']; children?: ReactNode }) {
  if (!NativeTurnView) return <View style={style} pointerEvents={pointerEvents}>
      {children}
    </View>;
  return (
    <NativeTurnView layoutSize={[layoutSize.width, layoutSize.height]} hidesContent={hidesContent} style={style} pointerEvents={pointerEvents}>
      {children}
    </NativeTurnView>
  );
}
