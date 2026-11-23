/**
 * The state of app updates (pure; no Tauri, no React). The controller
 * (`./index.ts`) sends events, and the update card reads the state. The Mac
 * app and the sideloaded Android TV app use the same rules.
 *
 * Phases:
 *   idle ──check──▶ checking ──found──▶ available ──install──▶ downloading ──downloaded──▶ installing
 *                     │  └──none──▶ current (a manual check shows "newest version")
 *                     └──failed──▶ error (step 'check')
 *   downloading ──failed──▶ error (step 'download');  installing ──failed──▶ error (step 'install')
 *   Android TV only:
 *   installing ──needs-permission──▶ permission ──install──▶ downloading (the file is kept)
 *   installing ──installer-closed──▶ available (the system installer closed with no install)
 *
 * Rules:
 * - An automatic check never opens the card for nothing: "up to date" and a
 *   failed check show only after a manual check (the menu or Settings).
 * - A found version opens the card, unless the user chose "Later" for that
 *   version (kept per device). A manual check opens it anyway.
 * - A version that is not newer than the running version is not an update.
 *   When the offer and the app both have a build number (Android
 *   `versionCode`), only the build number decides: Android TV releases keep
 *   the same version name (the OTA runtime version), so the name never does.
 * - Labels show the build number next to the version where there is one
 *   ("0.1.0 (25)"), so two releases with the same name look different.
 * - A required offer (the running build is older than the oldest build that
 *   the feed supports) opens the card even after "Later".
 * - During a download or the install, checks and "Later" do nothing.
 * - "Try again" after an error goes back to the step that failed.
 *
 * Over-the-air updates (source 'ota', `./ota.ts`) use the same states with
 * these differences:
 *   checking ──found──▶ available ──install──▶ downloading ──downloaded──▶ ready ──restart──▶ installing
 * - The download starts by itself and out of sight: only `ready` opens the
 *   card (unless "Later" for that update), or a manual check.
 * - The offer is new when expo-updates says so: it has an update `id`, and
 *   "Later" keeps the id (for this run only; the controller does not save it).
 * - A failed automatic download is silent too: the next check tries again.
 * - While `ready`, a check does not ask the server again: the next cold
 *   start loads the newest update anyway. A manual check opens the card.
 * - "Hide" closes the card during the download; `ready` opens it again.
 * - A failed restart (`installing`) shows an error; "Later" or "Close" goes
 *   back to `ready`, because the update is still on the device.
 */
import { isNewer } from './version';

export interface UpdateOffer {
  version: string;
  notes: string[];
  /** The publish date (ISO 8601), if latest.json has it. */
  date: string | null;
  /** The build number (Android `versionCode`). Desktop offers have none. */
  build?: number | null;
  /** True when the running build is too old for the feed: "Later" does not hide it. */
  required?: boolean;
  /** Over-the-air updates: the update ID from expo-updates. */
  id?: string;
}

/** Where updates come from: a new app (desktop, TV APK) or an over-the-air JavaScript update. */
export type UpdateSource = 'app' | 'ota';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'installing' }
  /** Android TV: the system does not let Zoggyfin install apps yet; its settings page is open. */
  | { kind: 'permission' }
  /** Over-the-air: the update is on the device and starts after a restart. */
  | { kind: 'ready' }
  | { kind: 'error'; step: 'check' | 'download' | 'install'; message: string };

export interface UpdateState {
  source: UpdateSource;
  /** The version that runs now. */
  current: string;
  /** The build number that runs now (Android `versionCode`), else null. */
  currentBuild: number | null;
  phase: UpdatePhase;
  /** The newer version, once a check found one. */
  offer: UpdateOffer | null;
  /** True when the card shows. */
  open: boolean;
  /** True when the user asked for this check (the card can take the focus). */
  manual: boolean;
  /** The offer the user put off with "Later" (`laterKey`). */
  later: string | null;
  /** The time of the last check that got an answer (ms since 1970). */
  checkedAt: number | null;
}

export type UpdateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'found'; offer: UpdateOffer; at: number }
  | { type: 'none'; at: number }
  | { type: 'failed'; message: string }
  | { type: 'install' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'downloaded' }
  | { type: 'needs-permission' }
  | { type: 'restart' }
  | { type: 'installer-closed' }
  | { type: 'later' }
  | { type: 'close' }
  | { type: 'reopen' }
  /** The snooze of a ready over-the-air update ended: its card opens again (not as a manual open). */
  | { type: 'remind' };

export function initialUpdateState(
  current: string,
  later: string | null = null,
  currentBuild: number | null = null,
  source: UpdateSource = 'app',
): UpdateState {
  return { source, current, currentBuild, phase: { kind: 'idle' }, offer: null, open: false, manual: false, later, checkedAt: null };
}

/** What "Later" keeps: the version, plus the build number when the offer has one. */
export function laterKey(offer: UpdateOffer): string {
  if (offer.id) return offer.id;
  return typeof offer.build === 'number' ? `${offer.version}+${offer.build}` : offer.version;
}

/** True when the offer is newer than the app that runs: by build number when both have one, else by version. */
export function isNewerOffer(offer: UpdateOffer, state: Pick<UpdateState, 'current' | 'currentBuild'>): boolean {
  // Over the air: expo-updates already compared the update with the one that runs.
  if (offer.id) return true;
  if (typeof offer.build === 'number' && state.currentBuild !== null) return offer.build > state.currentBuild;
  return isNewer(offer.version, state.current);
}

/** The version as the card shows it: "0.1.0 (25)" when there is a build number, else "0.1.0". */
export function versionLabel(version: string, build?: number | null): string {
  return typeof build === 'number' ? `${version} (${build})` : version;
}

/** The label of the offer. */
export const offerLabel = (offer: UpdateOffer): string => versionLabel(offer.version, offer.build);

/** The label of the app that runs now. */
export const currentLabel = (state: Pick<UpdateState, 'current' | 'currentBuild'>): string => versionLabel(state.current, state.currentBuild);

/** True while bytes move or the app installs: nothing may stop it. */
export function isBusy(state: UpdateState): boolean {
  return state.phase.kind === 'downloading' || state.phase.kind === 'installing';
}

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  const busy = isBusy(state);
  switch (event.type) {
    case 'check': {
      // Waiting for the "install unknown apps" switch: only a manual check takes over.
      if (state.phase.kind === 'permission' && !event.manual) return state;
      // An update waits for a restart: only a manual check opens the card again.
      if (state.phase.kind === 'ready') return event.manual ? { ...state, open: true, manual: true } : state;
      if (busy) return event.manual ? { ...state, open: true, manual: true } : state;
      if (state.phase.kind === 'checking') return event.manual ? { ...state, manual: true, open: true } : state;
      // A manual check shows "Checking…" at once; an automatic one stays out of sight.
      return {
        ...state,
        phase: { kind: 'checking' },
        manual: event.manual,
        open: event.manual ? true : state.open && state.offer !== null,
      };
    }
    case 'found': {
      if (busy) return state;
      if (!isNewerOffer(event.offer, state)) return updateReducer(state, { type: 'none', at: event.at });
      const key = laterKey(event.offer);
      if (state.source === 'ota') {
        // The download starts at once and out of sight; a manual check shows it.
        return { ...state, phase: { kind: 'available' }, offer: event.offer, open: state.manual, checkedAt: event.at };
      }
      const sameVersion = state.offer !== null && laterKey(state.offer) === key;
      const open = state.manual || event.offer.required === true || state.later !== key || (sameVersion && state.open);
      return { ...state, phase: { kind: 'available' }, offer: event.offer, open, checkedAt: event.at };
    }
    case 'none': {
      if (busy) return state;
      return {
        ...state,
        phase: state.manual ? { kind: 'current' } : { kind: 'idle' },
        offer: null,
        open: state.manual,
        checkedAt: event.at,
      };
    }
    case 'failed': {
      const message = event.message.trim() || 'Unknown error.';
      switch (state.phase.kind) {
        case 'downloading':
          if (state.source === 'ota' && !state.manual) {
            // A failed automatic download is silent; the next check tries again.
            return { ...state, phase: { kind: 'idle' }, offer: null };
          }
          return { ...state, phase: { kind: 'error', step: 'download', message }, open: true };
        case 'checking':
          if (!state.manual) {
            // A failed automatic check is silent; an offer found before stays.
            return { ...state, phase: state.offer ? { kind: 'available' } : { kind: 'idle' } };
          }
          return { ...state, phase: { kind: 'error', step: 'check', message }, open: true };
        case 'installing':
          return { ...state, phase: { kind: 'error', step: 'install', message }, open: true };
        default:
          return state;
      }
    }
    case 'install': {
      if (!state.offer || busy) return state;
      if (state.source === 'ota') {
        if (state.phase.kind !== 'available') return state;
        return { ...state, phase: { kind: 'downloading', done: 0, total: 0 } };
      }
      return { ...state, phase: { kind: 'downloading', done: 0, total: 0 }, open: true };
    }
    case 'progress': {
      if (state.phase.kind !== 'downloading') return state;
      return { ...state, phase: { kind: 'downloading', done: event.done, total: event.total } };
    }
    case 'downloaded': {
      if (state.phase.kind !== 'downloading') return state;
      if (state.source === 'ota' && state.offer) {
        const offer = state.offer;
        const open = state.manual || offer.required === true || state.later !== laterKey(offer);
        return { ...state, phase: { kind: 'ready' }, open };
      }
      return { ...state, phase: { kind: 'installing' } };
    }
    case 'needs-permission': {
      if (state.phase.kind !== 'installing') return state;
      return { ...state, phase: { kind: 'permission' }, open: true };
    }
    case 'restart': {
      if (state.phase.kind !== 'ready') return state;
      return { ...state, phase: { kind: 'installing' }, open: true };
    }
    case 'installer-closed': {
      if (state.phase.kind !== 'installing' || !state.offer) return state;
      return { ...state, phase: { kind: 'available' } };
    }
    case 'later': {
      if (busy) return state;
      const later = state.offer ? laterKey(state.offer) : state.later;
      return { ...state, open: false, later, manual: false, phase: settle(state) };
    }
    case 'close': {
      // Over the air: "Hide" during the download (it goes on out of sight).
      if (busy && !(state.source === 'ota' && state.phase.kind === 'downloading')) return state;
      return { ...state, open: false, manual: false, phase: settle(state) };
    }
    case 'reopen': {
      if (!state.offer) return state;
      return { ...state, open: true, manual: true };
    }
    case 'remind': {
      if (!state.offer || state.open || state.phase.kind !== 'ready') return state;
      return { ...state, open: true, manual: false };
    }
  }
}

/** After the card closes: an error or "newest version" goes back to a quiet phase. */
function settle(state: UpdateState): UpdatePhase {
  // Over the air: the restart failed, but the update is still on the device.
  if (state.source === 'ota' && state.phase.kind === 'error' && state.phase.step === 'install' && state.offer) return { kind: 'ready' };
  if (state.phase.kind === 'error' || state.phase.kind === 'current' || state.phase.kind === 'permission') {
    return state.offer ? { kind: 'available' } : { kind: 'idle' };
  }
  return state.phase;
}

/** What "Try again" does after an error: check again, or download and install again. */
export function retryAction(state: UpdateState): 'check' | 'install' | 'restart' | null {
  if (state.phase.kind !== 'error') return null;
  if (state.source === 'ota') return state.phase.step === 'install' && state.offer ? 'restart' : 'check';
  if (state.phase.step === 'check' || !state.offer) return 'check';
  return 'install';
}
