/**
 * Sends a text (an invite, a playlist) through the system share sheet. iOS and Android:
 * the native sheet (Messages, WhatsApp, Mail, Copy). Web and the desktop
 * app: `navigator.share` when the browser has it, else the clipboard.
 */
import { Platform, Share } from 'react-native';

export type ShareResult = 'shared' | 'copied' | 'dismissed' | 'failed';

interface WebNavigator {
  share?: (data: { text?: string; title?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

function webNavigator(): WebNavigator | null {
  return typeof navigator === 'undefined' ? null : (navigator as unknown as WebNavigator);
}

export async function copyText(text: string): Promise<boolean> {
  const nav = webNavigator();
  if (Platform.OS !== 'web' || !nav?.clipboard) return false;
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** True when this platform can copy without the share sheet (web and desktop). */
export const canCopy = Platform.OS === 'web';

export async function shareText(message: string, title: string): Promise<ShareResult> {
  if (Platform.OS !== 'web') {
    try {
      const r = await Share.share({ message, title }, { subject: title, dialogTitle: title });
      return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'failed';
    }
  }
  const nav = webNavigator();
  if (nav?.share) {
    try {
      await nav.share({ text: message, title });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'dismissed';
    }
  }
  return (await copyText(message)) ? 'copied' : 'failed';
}

/** The older name, for the invite screens. */
export const shareInvite = shareText;
