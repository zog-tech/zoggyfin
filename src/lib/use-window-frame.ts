/**
 * The window size for a layout that also reads the safe-area insets.
 *
 * `useWindowDimensions` and `useSafeAreaInsets` come from two native events.
 * On a rotation the screen rendered the new size with the old insets (the
 * portrait notch on top), then again when the insets came: the layout
 * jumped twice. The safe-area frame comes in the same event as the insets,
 * so a layout that uses both renders the new orientation once.
 *
 * The web has no frame (expo-router gives a zero frame there, and a browser
 * window has no insets to wait for), so it uses the window size.
 */
import { useWindowDimensions } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

export interface Size {
  width: number;
  height: number;
}

/** The measured frame, or the window when the frame is not measured (zero). */
export function pickFrame(frame: Size, window: Size): Size {
  return frame.width > 0 && frame.height > 0 ? { width: frame.width, height: frame.height } : { width: window.width, height: window.height };
}

export function useWindowFrame(): Size {
  const frame = useSafeAreaFrame();
  const window = useWindowDimensions();
  return pickFrame(frame, window);
}
