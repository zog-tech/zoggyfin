/** A fake extension with downloads, and fake request dependencies, for the extension download tests. */
import type { BuiltRequest, JellyfinAccount } from '@/extensions/http';
import { ExtensionError } from '@/extensions/http';
import { parseManifest } from '@/extensions/schema';
import type { InstalledExtension } from '@/extensions/types';
import { rawV2 } from '@/extensions/test-utils/fixtures';

import type { ExtensionDownloadDeps } from '../extension-media';

export const BASE = 'https://media.example.org';
export const EXT_ID = 'org.example.media';

export const accountA: JellyfinAccount = { serverUrl: 'https://jf.example.org', serverId: 'server-1', userId: 'user-1', userName: 'Jane Doe', token: 'jf-secret' };

export function mediaExtension(over: { permissions?: string[]; jellyfinToken?: boolean; downloads?: boolean; enabled?: boolean } = {}): InstalledExtension {
  const parsed = parseManifest({ ...rawV2, permissions: over.permissions ?? ['network', 'playback', 'downloads', 'jellyfinToken'], headers: { 'X-Api-Key': '{{settings.key}}' } });
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    manifestUrl: `${BASE}/zoggyfin-extension.json`,
    manifest: parsed.manifest,
    enabled: over.enabled ?? true,
    grants: { itemPath: false, jellyfinToken: over.jellyfinToken ?? false, playback: true, downloads: over.downloads ?? true },
    installedAt: 1,
  };
}

/** A reply per URL: a value, a function of the call number, or an error status. */
export type Route = unknown | ((n: number) => unknown);

export function fakeDeps(ext: () => InstalledExtension | undefined, routes: Record<string, Route>, account: () => JellyfinAccount | null = () => accountA) {
  const requests: BuiltRequest[] = [];
  const posts: { url: string; init: RequestInit }[] = [];
  const calls = new Map<string, number>();
  let postStatus: number | 'offline' = 200;
  const deps: ExtensionDownloadDeps = {
    extension: () => ext(),
    account,
    context: () => ({ settings: { key: 'abc' }, jellyfin: {} }),
    sendJson: async (req) => {
      requests.push(req);
      const n = (calls.get(req.url) ?? 0) + 1;
      calls.set(req.url, n);
      const route = routes[req.url];
      if (route === undefined) throw new ExtensionError('The extension answered with error 404.', 404);
      return typeof route === 'function' ? (route as (n: number) => unknown)(n) : route;
    },
    fetch: async (url, init) => {
      posts.push({ url, init });
      if (postStatus === 'offline') throw new ExtensionError('Cannot reach the extension.');
      return new Response('', { status: postStatus });
    },
  };
  return {
    deps,
    requests,
    posts,
    setPostStatus: (s: number | 'offline') => {
      postStatus = s;
    },
  };
}
