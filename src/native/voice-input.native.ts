/**
 * Voice input for search on Android (ZoggyfinVoiceModule.kt). Null on iOS
 * and on a build older than the module (an over-the-air update to an older
 * binary). `available()` is false on a device with no speech screen.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { VoiceInput } from './voice-input-types';

interface Native {
  available(): boolean;
  listen(prompt: string | null): Promise<string | null>;
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ZoggyfinVoice') : null;

function create(m: Native): VoiceInput {
  return {
    available: () => {
      try {
        return m.available();
      } catch {
        return false;
      }
    },
    listen: (prompt) => m.listen(prompt ?? null),
  };
}

export const voiceInput: VoiceInput | null = mod ? create(mod) : null;
