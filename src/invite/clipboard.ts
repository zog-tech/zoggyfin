/**
 * Reads the clipboard for "Paste invite", only after the user taps the
 * button, so iOS shows its paste prompt and the app never reads the
 * clipboard silently. iOS and Android: expo-clipboard, loaded only when the
 * app binary has it. Web and desktop: `navigator.clipboard`.
 * `writeClipboard` copies text the same way ("Copy report").
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

interface NativeClipboard {
  getStringAsync(options: Record<string, unknown>): Promise<string>;
  setStringAsync?: (text: string, options: Record<string, unknown>) => Promise<boolean>;
}

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeClipboard>('ExpoClipboard');

/** True when "Paste invite" can read the clipboard here. Else the person pastes into the field. */
export const canReadClipboard: boolean =
  Platform.OS === 'web'
    ? typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
    : !!native && typeof native.getStringAsync === 'function';

/** The clipboard text, or null when it cannot be read or the user refused. */
export async function readClipboard(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return (await navigator.clipboard.readText()) || null;
    return native ? (await native.getStringAsync({})) || null : null;
  } catch {
    return null;
  }
}

/** Copies text. False when this device cannot copy (an older binary without the module, or the browser refused). */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false;
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (!native || typeof native.setStringAsync !== 'function') return false;
    await native.setStringAsync(text, {});
    return true;
  } catch {
    return false;
  }
}
