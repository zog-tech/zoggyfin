/**
 * Restart the app, for a setting that applies only at start (the TV look,
 * `platform/tv-look-now.ts`). The web reloads the page without the
 * `?tvlook=` preview parameter, so the saved choice decides. Native apps
 * reload the JavaScript with expo-updates (in every shipped binary); a
 * development build cannot do that, so it asks the person to reopen the app.
 */
import * as Updates from 'expo-updates';
import { Alert, Platform } from 'react-native';

import { toast } from './toast';

export const RESTART_FAILED = 'Close the app and open it again to see the new look.';

/** The current URL without the `tvlook` parameter. Pure, so it is unit-tested. */
export function urlWithoutLook(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('tvlook');
    return u.toString();
  } catch {
    return href;
  }
}

export async function restartApp(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.replace(urlWithoutLook(window.location.href));
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    toast(RESTART_FAILED);
  }
}

/**
 * Asks to restart now. True for "Restart", false for "Later" (and Back,
 * which cancels on Android and TV). Not destructive, so the action is not red.
 */
export function confirmRestart(title: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // RN Web has no Alert with buttons.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(title));
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      undefined,
      [
        { text: 'Later', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Restart', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
