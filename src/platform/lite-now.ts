/** Lite mode now, outside React (`lite.ts` has the rule; `use-lite.ts` is the hook). */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { usePlaybackSettings } from '@/settings/playback';

import { liteActive } from './lite';

export function liteNow(): boolean {
  return liteActive(usePlaybackSettings.getState().liteMode, Platform.OS, Device.totalMemory);
}
