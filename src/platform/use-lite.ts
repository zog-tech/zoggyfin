/** Lite mode for this device (`lite.ts`): the user's choice and the device's memory. */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { usePlaybackSettings } from '@/settings/playback';

import { liteActive } from './lite';

/** True when Lite mode is on (a hook: it follows the setting). */
export function useLite(): boolean {
  const choice = usePlaybackSettings((st) => st.liteMode);
  return liteActive(choice, Platform.OS, Device.totalMemory);
}
