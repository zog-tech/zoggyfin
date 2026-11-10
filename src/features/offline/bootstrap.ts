/**
 * Starts the offline services once a session exists: the reachability
 * checks, the download manager (re-attach to system tasks) and the outbox,
 * which sends offline play progress whenever a server answers again (each
 * account's progress to its own server). The extension report outbox
 * (`stop` and `finished` of extension downloads played offline) is tried at
 * the same moments, for the signed-in account.
 */
import { downloads, downloadsSupported } from '@/downloads';
import { flushOutbox, hasOtherAccountEntries } from '@/downloads/outbox-store';
import { startReachability, useOnlineStore } from '@/lib/online';

let started = false;

/** Sends the waiting extension reports. The extension wiring loads on first use. */
function flushExtensionReports(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const play = require('@/extensions/media/play') as typeof import('@/extensions/media/play');
    void play.flushExtensionReports();
  } catch (e) {
    console.warn('[extensions] reports were not sent', e instanceof Error ? e.name : 'error');
  }
}

export function startOfflineServices(): void {
  if (started) return;
  started = true;
  startReachability();
  if (downloadsSupported) void downloads.init();
  useOnlineStore.subscribe((s, prev) => {
    if (s.reachable && prev.reachable !== true) {
      void flushOutbox();
      flushExtensionReports();
    }
  });
  // Progress of downloads from other servers: probe those servers in the background
  // and send it when they answer. The active account does not change.
  void flushOutbox();
  flushExtensionReports();
  setInterval(() => {
    if (hasOtherAccountEntries()) void flushOutbox();
    // An extension's origin is not probed on its own: try its reports now and then.
    flushExtensionReports();
  }, 2 * 60_000);
}
