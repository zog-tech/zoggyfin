import { hasMpv } from '@/platform/desktop';

import { type MediaCapabilities, mpvCapabilities, webCapabilities } from './device-profile';

let cached: MediaCapabilities | null = null;
let browserCached: MediaCapabilities | null = null;

/** Browser capabilities, probed once. In the desktop app: libmpv. */
export function mediaCapabilities(): MediaCapabilities {
  if (cached) return cached;
  cached = hasMpv ? mpvCapabilities() : browserCapabilities();
  return cached;
}

/**
 * What the music player plays. Music plays in an HTML audio element
 * (expo-audio on the web), also in the desktop app, where only video goes
 * to libmpv. So the audio profile comes from the browser probe: the web
 * view of the desktop app cannot play every file that libmpv plays.
 */
export function audioCapabilities(): MediaCapabilities {
  return browserCapabilities();
}

function browserCapabilities(): MediaCapabilities {
  if (browserCached) return browserCached;
  const video = typeof document !== 'undefined' ? document.createElement('video') : null;
  const canPlay = (mime: string) => !!video && video.canPlayType(mime) !== '';
  const ms = (globalThis as { MediaSource?: { isTypeSupported(m: string): boolean } }).MediaSource;
  const canMse = (mime: string) => {
    try {
      return !!ms && ms.isTypeSupported(mime);
    } catch {
      return false;
    }
  };
  browserCached = webCapabilities({ canPlay, canMse, nativeHls: canPlay('application/vnd.apple.mpegurl') });
  return browserCached;
}
