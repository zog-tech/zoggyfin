import { requireNativeView } from 'expo';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import type { KeyPress } from './key-input-types';
import { hasNativeKeyInput } from './zoggyfin-native';

interface NativeProps {
  enabled: boolean;
  onHardwareKey: (e: { nativeEvent: KeyPress }) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const NativeKeyInputView = hasNativeKeyInput ? requireNativeView<NativeProps>('ZoggyfinNative') : null;

/**
 * Hardware keyboard input on iPad and Mac: the view becomes first responder
 * while it is on screen and forwards key presses. Touches reach the children.
 */
export function KeyInput({
  enabled = true,
  onKey,
  style,
  children,
}: {
  enabled?: boolean;
  onKey: (press: KeyPress) => void;
  /** Web only (the TV preview); native keyboards send presses. */
  onKeyUp?: (press: KeyPress) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  if (!NativeKeyInputView) return <View style={style}>{children}</View>;
  return (
    <NativeKeyInputView enabled={enabled} onHardwareKey={(e) => onKey(e.nativeEvent)} style={style}>
      {children}
    </NativeKeyInputView>
  );
}
