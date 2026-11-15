/**
 * App updates: the controller between the update card and the platform.
 * The state rules are in `./machine.ts`. Two platforms update themselves:
 *
 * - The desktop app (macOS): Rust, `desktop/src-tauri/src/update.rs`.
 *   "Install and restart" downloads the signed update with progress, checks
 *   the signature, puts it in place of the installed app, quits, and starts
 *   the same app again.
 * - The sideloaded Android TV app (`./tv.ts`): the feed
 *   `android-tv/latest.json`, the APK checked by SHA-256, and the system
 *   package installer. Only builds with REQUEST_INSTALL_PACKAGES (the EAS
 *   profile `tv`) have it; the Play build and phones do not.
 *
 * Both check 10 s after start and every 4 hours. "Check for Updates…" (the
 * app menu and Settings) checks at once. In a browser, on iPhone and iPad and
 * on Android phones nothing here runs (`updatesSupported`).
 */
import { Platform } from 'react-native';
import { create } from 'zustand';

import { storage } from '@/storage/kv';

import { appVersion, autoUpdate, desktopPlatform, invoke, isDesktop, onMenuCommand, onUpdateEvent } from '../desktop';

import { initialUpdateState, retryAction, type UpdateEvent, updateReducer, type UpdateState } from './machine';
import { parseReleaseNotes } from './notes';
import { tvUpdates } from './tv';

export { compareVersions, isNewer } from './version';
export type { UpdateOffer, UpdatePhase, UpdateState } from './machine';

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// The Windows app has no update feed yet (desktop/src-tauri/src/update.rs is macOS only).
const desktopSupported = isDesktop && appVersion !== null && desktopPlatform === 'macos';

/** True in the desktop app on macOS and in the sideloaded Android TV app, where updates work. */
export const updatesSupported: boolean = desktopSupported || tvUpdates !== null;

/** True in the Android TV app: the card is a TV panel and the words fit a TV. */
export const updatesOnTV: boolean = !desktopSupported && tvUpdates !== null;

const LATER_KEY = 'zf:update-later';

// Web (the desktop app): localStorage, as before. Native (TV): MMKV.
const local = () => (Platform.OS === 'web' ? globalThis.localStorage : null);

function readLater(): string | null {
  try {
    const web = local();
    return (web ? web.getItem(LATER_KEY) : storage.getString(LATER_KEY)) ?? null;
  } catch {
    return null;
  }
}

function writeLater(version: string | null): void {
  try {
    if (!version) return;
    const web = local();
    if (web) web.setItem(LATER_KEY, version);
    else storage.set(LATER_KEY, version);
  } catch {
    // Blocked storage: "Later" lasts for this run only.
  }
}

interface Store {
  state: UpdateState;
  send: (event: UpdateEvent) => void;
}

function initialState(): UpdateState {
  if (tvUpdates) return initialUpdateState(tvUpdates.versionName, readLater(), tvUpdates.versionCode);
  return initialUpdateState(appVersion ?? '0.0.0', readLater());
}

export const useUpdateStore = create<Store>((set, get) => ({
  state: initialState(),
  send: (event) => {
    const before = get().state;
    const after = updateReducer(before, event);
    if (after === before) return;
    if (after.later !== before.later) writeLater(after.later);
    set({ state: after });
  },
}));

const send = (event: UpdateEvent) => useUpdateStore.getState().send(event);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface CheckResult {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
}

let checking: Promise<void> | null = null;

/** Looks for a newer version. `manual`: the user asked (the card shows the answer). */
export function checkForUpdates(manual = false): Promise<void> {
  if (!updatesSupported) return Promise.resolve();
  send({ type: 'check', manual });
  checking ??= (async () => {
    try {
      if (tvUpdates) {
        const offer = await tvUpdates.check();
        send(offer ? { type: 'found', offer, at: Date.now() } : { type: 'none', at: Date.now() });
        return;
      }
      const found = await invoke<CheckResult | null>('update_check');
      const at = Date.now();
      if (found && typeof found.version === 'string') {
        send({
          type: 'found',
          offer: { version: found.version, notes: parseReleaseNotes(found.notes), date: found.date ?? null },
          at,
        });
      } else {
        send({ type: 'none', at });
      }
    } catch (err) {
      send({ type: 'failed', message: message(err) });
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** "Install and restart" (desktop) or "Install" (TV): download with progress, then install. */
export async function installUpdate(): Promise<void> {
  const before = useUpdateStore.getState().state;
  send({ type: 'install' });
  if (useUpdateStore.getState().state === before) return;
  try {
    if (tvUpdates) {
      const result = await tvUpdates.install((done, total) => send({ type: 'progress', done, total }), () => send({ type: 'downloaded' }));
      if (result === 'permission') send({ type: 'needs-permission' });
      return;
    }
    await invoke('update_download');
    send({ type: 'downloaded' });
    // On success the app quits in this call.
    await invoke('update_install_and_relaunch');
  } catch (err) {
    send({ type: 'failed', message: message(err) });
  }
}

/** "Try again" on an error: the step that failed. */
export function retryUpdate(): void {
  const action = retryAction(useUpdateStore.getState().state);
  if (action === 'check') void checkForUpdates(true);
  else if (action === 'install') void installUpdate();
}

export const laterUpdate = () => send({ type: 'later' });
export const closeUpdateCard = () => send({ type: 'close' });
export const reopenUpdateCard = () => send({ type: 'reopen' });

/** TV: open the "install unknown apps" page again (the card's button while it waits). */
export function openInstallSettings(): void {
  tvUpdates?.openSettings();
}

let started = false;

/** Starts the checks (once). The root layout calls it; it does nothing where updates are not supported. */
export function startUpdateChecks(): void {
  if (!updatesSupported || started) return;
  started = true;
  if (tvUpdates) {
    tvUpdates.watch({
      // Back from the settings page with the switch on: install at once.
      onResume: () => {
        const { phase } = useUpdateStore.getState().state;
        if (phase.kind === 'permission' && tvUpdates?.canInstall()) void installUpdate();
      },
      // The system installer closed and this app still runs: nothing was installed.
      onInstallerClosed: () => send({ type: 'installer-closed' }),
      installing: () => useUpdateStore.getState().state.phase.kind === 'installing',
    });
  } else {
    onUpdateEvent((e) => {
      if (e.type === 'progress') send({ type: 'progress', done: e.done, total: e.total });
    });
    onMenuCommand((command) => {
      if (command === 'check-updates') void checkForUpdates(true);
    });
    if (!autoUpdate) return;
  }
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}
