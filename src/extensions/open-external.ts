/**
 * Opens an `https` URL in the system browser for a panel's `openExternal`
 * (iPhone, iPad, Android): `Linking.openURL`, the app's way to open
 * external links (feed card links, the Settings links). The URL is checked
 * first (`readExternalUrl` in `bridge.ts`). Web: `open-external.web.ts`.
 */
import { Linking } from 'react-native';

export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
