/**
 * TV detection and the features each platform gets.
 *
 * `isTV` is true on Apple TV and Android TV builds (react-native-tvos sets
 * `Platform.isTV`). On web, `?tv=1` (kept for the browser tab) or the build
 * flag `EXPO_PUBLIC_TV_PREVIEW=1` turns on a TV preview: the TV layout,
 * navigated with the arrow keys. `?tv=0` turns the preview off again.
 */
import { Platform } from 'react-native';

const PREVIEW_KEY = 'zoggyfin:tvPreview';

function webPreview(): boolean {
  if (Platform.OS !== 'web') return false;
  if (process.env.EXPO_PUBLIC_TV_PREVIEW === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('tv');
    if (q === '1') window.sessionStorage.setItem(PREVIEW_KEY, '1');
    if (q === '0') window.sessionStorage.removeItem(PREVIEW_KEY);
    return window.sessionStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** A real TV build. */
export const isNativeTV: boolean = Platform.isTV === true;

/** The TV layout is on: a real TV, or the web TV preview. */
export const isTV: boolean = isNativeTV || webPreview();

/** The web TV preview (arrow keys move the focus, Escape goes back). */
export const isTVPreview: boolean = isTV && !isNativeTV;

/** The desktop app (Tauri) runs the web build and has downloads. */
const isDesktopApp = Platform.OS === 'web' && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * What each platform shows. TV has no downloads, no watch together and no
 * extension web panels (design spec, Platforms). Web has no downloads, but
 * the desktop app has.
 */
export const features = {
  downloads: !isTV && (Platform.OS !== 'web' || isDesktopApp),
  watchTogether: !isTV,
  extensionPanels: !isTV,
  touchGestures: !isTV,
  /**
   * The app's own volume slider (`player/volume.ts`): the web and the Mac app
   * only. Phones and TVs use the hardware volume (iOS also has the system
   * slider in Now Playing).
   */
  inAppVolume: Platform.OS === 'web' && !isTV,
  /**
   * Live TV from IPTV providers: every platform. The plain web build reads
   * only providers that allow web pages (CORS) and cannot send a user agent;
   * the apps (and the Mac app, through Rust) have neither limit.
   */
  iptv: true,
  /** IPTV lists reach the plain web only when the provider allows it (see `src/iptv/transport.ts`). */
  iptvNeedsCors: Platform.OS === 'web' && !isDesktopApp,
} as const;
