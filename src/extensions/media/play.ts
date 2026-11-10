/**
 * The extension media source with the app's own dependencies: the installed
 * extensions, the signed-in account and the template context. The player
 * (`usePlayer().playMedia`) uses it; tests use `source.ts` with fakes.
 */
import type { ExternalPlayRequest, MediaPlayRequest } from '@/player/types';

import { currentAccount, templateContext } from '../runtime';
import { getExtension } from '../store';
import { type ExtensionMediaDeps, mediaPlayRequest } from './source';

export const appMediaDeps: ExtensionMediaDeps = {
  extension: getExtension,
  account: currentAccount,
  context: (ext) => templateContext(ext),
};

/** The play request for an extension's media reference, or why it cannot play. */
export function extensionPlayRequest(req: MediaPlayRequest): { request: ExternalPlayRequest } | { error: string } {
  return mediaPlayRequest(req, appMediaDeps);
}
