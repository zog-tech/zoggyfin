/**
 * The TV look of this run (`tv-look.ts` has the rule). It is read once, when
 * the module loads, and stays fixed until the app restarts: TV sizes are
 * module constants (the type scale, the side menu sizes, style factories),
 * and the tab layout and the page padding differ per look, so a live switch
 * would need a remount of the whole app. Off TV the look is always Classic,
 * so phones, iPad, the web and the Mac app never see a Modern branch.
 *
 * Web preview: `?tvlook=modern` or `?tvlook=classic` is kept for the
 * browser tab (sessionStorage, like `?tv=1`) and wins over the saved choice;
 * `?tvlook=auto` removes it.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { readTvLook, type TvLook, type TvLookChoice, tvLookFor } from './tv-look';
import { isTV } from './tv';

const OVERRIDE_KEY = 'zoggyfin:tvLook';

function webOverride(): TvLook | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('tvlook');
    if (q === 'auto') window.sessionStorage.removeItem(OVERRIDE_KEY);
    else if (readTvLook(q)) window.sessionStorage.setItem(OVERRIDE_KEY, q as TvLook);
    return readTvLook(window.sessionStorage.getItem(OVERRIDE_KEY));
  } catch {
    return null;
  }
}

/**
 * The saved choice and Lite mode are loaded only on TV, and only here: the
 * theme imports this module, and a static import would load the device store
 * into every module (and every test) that uses the theme.
 */
function loadChoice(): TvLookChoice {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadTvLookChoice } = require('@/settings/tv-look') as typeof import('@/settings/tv-look');
  return loadTvLookChoice();
}

function liteNow(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lite = require('./lite-now') as typeof import('./lite-now');
  return lite.liteNow();
}

function deviceLook(choice: TvLookChoice, override: TvLook | null): TvLook {
  return tvLookFor(choice, { os: Platform.OS, manufacturer: Device.manufacturer, brand: Device.brand, model: Device.modelName, lite: liteNow() }, override);
}

/** The web preview parameter that set the look of this run, until a choice in Settings ends it. */
let override: TvLook | null = null;

function resolve(): TvLook {
  if (!isTV) return 'classic';
  try {
    override = webOverride();
    return deviceLook(loadChoice(), override);
  } catch {
    // No storage or no device module (Jest): the look of today.
    return 'classic';
  }
}

/** The look of this run. Fixed until the app restarts. 'classic' off TV. */
export const tvLook: TvLook = resolve();

/** The Modern look runs (always false off TV). Guard every Modern difference with it. */
export const isTvModern: boolean = tvLook === 'modern';

/** The look of this run, outside React. */
export function tvLookNow(): TvLook {
  return tvLook;
}

/** The look of this run, in a component. A hook, so a later live switch changes no call site. */
export function useTvLook(): TvLook {
  return tvLook;
}

/**
 * True when the saved choice gives another look than the one that runs
 * (Settings shows "restart to apply"). False while the web preview parameter
 * decides the look; a choice in Settings ends it (`clearTvLookOverride`).
 */
export function tvLookPending(choice: TvLookChoice): boolean {
  if (!isTV || override) return false;
  try {
    return deviceLook(choice, null) !== tvLook;
  } catch {
    return false;
  }
}

/**
 * Web preview: drop the `?tvlook=` parameter, so the saved choice decides
 * the look after the next reload (a choice in Settings calls it).
 */
export function clearTvLookOverride(): void {
  override = null;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // No session storage: nothing was kept.
  }
}

/** The choice Settings shows: the saved one, or the look the web preview parameter forces for this run. */
export function shownTvLookChoice(saved: TvLookChoice): TvLookChoice {
  return override ?? saved;
}
