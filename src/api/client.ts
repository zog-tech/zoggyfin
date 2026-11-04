import type { Api } from '@jellyfin/sdk';
// The class file, not the package index: the index pulls in every API module of the SDK.
import { Jellyfin } from '@jellyfin/sdk/lib/jellyfin';
import { type AxiosInstance, create as createAxios, isAxiosError } from 'axios';

import { clientIdentity } from '@/auth/identity';
import { devOffline, offlineError } from '@/lib/dev-offline';

import { buildAuthHeader } from './auth-header';

const REQUEST_TIMEOUT_MS = 20_000;

let sdk: Jellyfin | null = null;

function getSdk(): Jellyfin {
  if (!sdk) {
    const id = clientIdentity();
    sdk = new Jellyfin({
      clientInfo: { name: id.client, version: id.version },
      deviceInfo: { id: id.deviceId, name: id.device },
    });
  }
  return sdk;
}

/** Called when the server rejects the token of a signed-in session. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/** Called when a request fails with no answer (lost connection, timeout): the app checks the addresses again. */
let onNetworkError: (() => void) | null = null;

export function setNetworkErrorHandler(handler: (() => void) | null): void {
  onNetworkError = handler;
}

function isNoAnswer(error: unknown): boolean {
  if (!isAxiosError(error) || error.response) return false;
  return error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
}

/** True when a URL is on the given server, so its credentials may go with it. */
function isForServer(url: string | undefined, baseUrl: string): boolean {
  if (!url) return false;
  return url === baseUrl || url.startsWith(`${baseUrl}/`) || url.startsWith(`${baseUrl}?`);
}

/** The base URL of one Api. It changes when the app switches to another address of the same server. */
interface Target {
  baseUrl: string;
}

function makeAxios(target: Target, token: string | null): AxiosInstance {
  // An instance of our own, so these interceptors never see unrelated requests.
  const instance = createAxios({ timeout: REQUEST_TIMEOUT_MS });
  instance.interceptors.request.use((config) => {
    if (devOffline()) throw offlineError();
    const url = config.baseURL ? `${config.baseURL}${config.url ?? ''}` : config.url;
    if (isForServer(url, target.baseUrl)) {
      config.headers.set('Authorization', buildAuthHeader(clientIdentity(), token));
    } else {
      config.headers.delete('Authorization');
    }
    return config;
  });
  instance.interceptors.response.use(undefined, (error: unknown) => {
    if (token && isAxiosError(error) && error.response?.status === 401) {
      onUnauthorized?.();
    }
    if (token && isNoAnswer(error)) onNetworkError?.();
    return Promise.reject(error);
  });
  return instance;
}

const cache = new Map<string, { api: Api; target: Target }>();

/**
 * Returns an SDK `Api` for a server and token. A signed-in account has one
 * instance (keyed by its token): when the app picks another address of the
 * same server, the instance moves to it, so code that holds the instance
 * (a progress reporter, a download) sends its next request to the new
 * address. The caller passes only addresses whose server Id was checked.
 */
export function getApi(baseUrl: string, token: string | null): Api {
  const key = token ? `t|${token}` : `u|${baseUrl}`;
  const hit = cache.get(key);
  if (hit) {
    if (hit.target.baseUrl !== baseUrl) {
      hit.target.baseUrl = baseUrl;
      hit.api.update({ basePath: baseUrl });
    }
    return hit.api;
  }
  const target: Target = { baseUrl };
  const api = getSdk().createApi(baseUrl, token ?? undefined, makeAxios(target, token));
  cache.set(key, { api, target });
  return api;
}

export function dropApi(baseUrl: string, token: string | null): void {
  cache.delete(token ? `t|${token}` : `u|${baseUrl}`);
}
