/**
 * The extension media source with the app's own dependencies: the installed
 * extensions, the signed-in account and the template context. The player
 * (`usePlayer().playMedia`) uses it; tests use `source.ts` with fakes.
 *
 * A media entry that is downloaded for the signed-in account plays from the
 * device (`@/downloads` `extensionLocalPlay`), with no network. Its `stop`
 * and `finished` reports wait in `reportOutbox` until the extension answers.
 */
import type { ExternalPlayRequest, MediaPlayRequest } from '@/player/types';
import { readJson, writeJson } from '@/storage/json';

import { currentAccount, templateContext } from '../runtime';
import { getExtension } from '../store';
import { accountKey } from '../types';
import { createReportOutbox, OUTBOX_KEY, reportSender } from './outbox';
import { type ExtensionMediaDeps, mediaPlayRequest } from './source';

export const appMediaDeps: ExtensionMediaDeps = {
  extension: getExtension,
  account: currentAccount,
  context: (ext) => templateContext(ext),
};

/** The offline report outbox of the app (`outbox.ts`), saved in MMKV under `extensions.reports`. */
export const reportOutbox = createReportOutbox(
  { read: () => readJson<unknown>(OUTBOX_KEY, null), write: (v) => writeJson(OUTBOX_KEY, v) },
  {
    account: () => {
      const a = currentAccount();
      return a ? accountKey(a) : null;
    },
    send: reportSender(appMediaDeps),
  },
);

/** Sends the waiting reports of the signed-in account (when a server answers again, at start). */
export function flushExtensionReports(): Promise<void> {
  return reportOutbox.flush();
}

/** The play request for an extension's media reference, or why it cannot play. A download plays from the device. */
export function extensionPlayRequest(req: MediaPlayRequest): { request: ExternalPlayRequest } | { error: string } {
  // Loaded on first use: the downloads module loads its store and engine.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extensionLocalPlay } = require('@/downloads') as typeof import('@/downloads');
  const local = extensionLocalPlay(req);
  if (local) return { request: local };
  return mediaPlayRequest(req, appMediaDeps);
}
