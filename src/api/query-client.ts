import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';

import { type AccountRef, cacheStorageKey } from '@/auth/accounts';
import { cacheStorage } from '@/storage/kv';

import { describeError } from './errors';

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data shows at once; a refetch runs in the background when it is older than this.
      staleTime: 60 * 1000,
      gcTime: 7 * DAY,
      retry: (count, error) => {
        const kind = describeError(error).kind;
        if (kind === 'auth' || kind === 'forbidden' || kind === 'notFound') return false;
        return count < 2;
      },
      networkMode: 'offlineFirst',
    },
  },
});

const persisters = new Map<string, ReturnType<typeof createSyncStoragePersister>>();

/**
 * The persister of one account. Each account keeps its cache under its own
 * key (`cacheStorageKey`), so a switch restores that account's pages and
 * data of one server never shows on another.
 */
export function persisterFor(ref: AccountRef | null) {
  const key = ref ? cacheStorageKey(ref) : 'rq.none';
  let p = persisters.get(key);
  if (!p) {
    p = createSyncStoragePersister({
      key,
      storage: {
        getItem: (k) => cacheStorage.getString(k) ?? null,
        setItem: (k, value) => cacheStorage.set(k, value),
        removeItem: (k) => {
          cacheStorage.remove(k);
        },
      },
      throttleTime: 2000,
    });
    persisters.set(key, p);
  }
  return p;
}

/** True when a query key belongs to the account (keys start with ['jf', serverId, userId]). */
export function inScope(queryKey: readonly unknown[], ref: AccountRef | null): boolean {
  return !!ref && queryKey[0] === 'jf' && queryKey[1] === ref.serverId && queryKey[2] === ref.userId;
}

/** Bump to drop every persisted cache after a breaking change in cached shapes. */
export const CACHE_BUSTER = 'v1';
export const CACHE_MAX_AGE = 7 * DAY;

/** Search results and live sessions (Remote) are not worth keeping across launches. */
export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[3] !== 'search' && queryKey[3] !== 'remoteSessions';
}

/** Drops every cached page of every account, in memory and on disk. */
export function clearQueryCache(): void {
  queryClient.clear();
  cacheStorage.clearAll();
}

/** Drops the in-memory queries of other accounts after a switch (their saved copies stay on disk). */
export function dropOtherScopes(ref: AccountRef | null): void {
  queryClient.removeQueries({ predicate: (q) => !inScope(q.queryKey, ref) });
}
