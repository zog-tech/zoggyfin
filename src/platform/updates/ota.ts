/**
 * Over-the-air updates (expo-updates) in the update card: the controller
 * between `./machine.ts` (source 'ota') and expo-updates. The rules around
 * it (when to check, which card shows, playback) are in `./ota-rules.ts`.
 *
 * expo-updates still downloads a new update at start and loads it on the next
 * cold start by itself. This controller only tells the user: it checks after
 * start, on return to the foreground and on request, downloads the update,
 * and then the card offers "Restart now". It never restarts by itself.
 *
 * Only JavaScript APIs that every shipped binary has (expo-updates is in
 * every build): `checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync`.
 * Off on the web and in the Mac app (no OTA; the Mac app has its own
 * updater), in development builds and where `Updates.isEnabled` is false.
 */
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { otaLabel, runningOta } from '@/lib/ota';

import { initialUpdateState, retryAction, type UpdateEvent, type UpdateOffer, updateReducer, type UpdateState } from './machine';
import { OTA_FIRST_CHECK_MS, type OtaCheckReason, otaManifestInfo, otaMessage, shouldCheckOta } from './ota-rules';

/** The parts of expo-updates that the controller uses (a fake in tests and on the web preview). */
export interface OtaSource {
  /** Asks the server. The offer when a new update is there, else null. */
  check(): Promise<UpdateOffer | null>;
  /** Downloads the newest update. False when there was nothing new to download. */
  fetch(): Promise<boolean>;
  /** Restarts the app with the downloaded update. */
  reload(): Promise<void>;
}

function offerFrom(manifest: unknown): UpdateOffer | null {
  const { id, date } = otaManifestInfo(manifest);
  if (!id) return null;
  const message = otaMessage(manifest);
  return { version: Updates.runtimeVersion ?? '', notes: message ? [message] : [], date, id };
}

const expoSource: OtaSource = {
  async check() {
    const result = await Updates.checkForUpdateAsync();
    // A roll back to the build's own code has no message and no card: it applies on the next start.
    if (!result.isAvailable) return null;
    return offerFrom(result.manifest);
  },
  async fetch() {
    const result = await Updates.fetchUpdateAsync();
    return result.isNew;
  },
  reload: () => Updates.reloadAsync(),
};

/** True on iPhone, iPad, Android and TV release builds with updates on. */
export const otaSupported: boolean = Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;

let source: OtaSource = expoSource;

/** True where the OTA row and card work: `otaSupported`, or a fake source (tests). */
export const otaActive = (): boolean => otaSupported || source !== expoSource;

interface Store {
  state: UpdateState;
  send: (event: UpdateEvent) => void;
}

// "Later" lasts for this run only: the update starts on the next cold start anyway.
export const useOtaStore = create<Store>((set, get) => ({
  state: initialUpdateState(otaLabel(runningOta()) ?? 'Built-in version', null, null, 'ota'),
  send: (event) => {
    const before = get().state;
    const after = updateReducer(before, event);
    if (after !== before) set({ state: after });
  },
}));

const send = (event: UpdateEvent) => useOtaStore.getState().send(event);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

let running: Promise<void> | null = null;
let lastCheckAt: number | null = null;

/** Checks, then downloads a found update. `manual`: the user asked (the card shows the answer and errors). */
export function checkForOta(manual = false, reason: OtaCheckReason = manual ? 'manual' : 'start'): Promise<void> {
  if (!otaActive()) return Promise.resolve();
  if (!manual && !shouldCheckOta(reason, lastCheckAt, Date.now())) return Promise.resolve();
  const before = useOtaStore.getState().state;
  // An update waits for a restart: a manual check opens its card, nothing asks the server.
  if (before.phase.kind === 'ready') {
    send({ type: 'check', manual });
    return Promise.resolve();
  }
  send({ type: 'check', manual });
  if (running) return running;
  lastCheckAt = Date.now();
  running = (async () => {
    try {
      const offer = await source.check();
      send(offer ? { type: 'found', offer, at: Date.now() } : { type: 'none', at: Date.now() });
      if (!offer) return;
      send({ type: 'install' });
      const isNew = await source.fetch();
      if (isNew) send({ type: 'downloaded' });
      else send({ type: 'failed', message: 'The update is no longer available.' });
    } catch (err) {
      send({ type: 'failed', message: message(err) });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** "Restart now": loads the downloaded update. The card asks first while something plays. */
export async function restartOta(): Promise<void> {
  const before = useOtaStore.getState().state;
  send({ type: 'restart' });
  if (useOtaStore.getState().state === before) return;
  try {
    await source.reload();
  } catch (err) {
    send({ type: 'failed', message: message(err) });
  }
}

/** "Try again" on an error: restart again, or check again. */
export function retryOta(): void {
  // The rule is the machine's (`retryAction`); this only runs the step.
  const action = retryAction(useOtaStore.getState().state);
  if (action === 'restart') {
    // Back to `ready` first, then the restart.
    send({ type: 'close' });
    void restartOta();
  } else if (action === 'check') {
    void checkForOta(true);
  }
}

export const laterOta = () => send({ type: 'later' });
export const closeOtaCard = () => send({ type: 'close' });
export const reopenOtaCard = () => send({ type: 'reopen' });

let started = false;

/** Starts the checks (once). The root layout calls it; it does nothing where OTA updates do not work. */
export function startOtaChecks(): void {
  if (!otaSupported || started) return;
  started = true;
  setTimeout(() => void checkForOta(false, 'start'), OTA_FIRST_CHECK_MS);
  let away = false;
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') {
      away = true;
      return;
    }
    if (!away) return;
    away = false;
    void checkForOta(false, 'foreground');
  });
}

/** Tests and the web preview: use a fake source. */
export function setOtaSourceForTesting(fake: OtaSource | null): void {
  source = fake ?? expoSource;
  lastCheckAt = null;
  running = null;
  useOtaStore.setState({ state: initialUpdateState('Built-in version', null, null, 'ota') });
}
