/**
 * Who can open the Admin panel of a server. The panel uses a saved account
 * of that server whose policy has `IsAdministrator`: the active account when
 * it is an admin, else the first other saved admin account.
 */
import type { Api } from '@jellyfin/sdk';
import { Jellyfin } from '@jellyfin/sdk/lib/jellyfin';
import { useQueries, useQuery } from '@tanstack/react-query';
import { create as createAxios } from 'axios';
import { useMemo } from 'react';

import { buildAuthHeader } from '@/api/auth-header';
import { getApi } from '@/api/client';
import { getCurrentUser } from '@/api/jellyfin';
import { findServer, type SavedServer, startUrl } from '@/auth/accounts';
import { clientIdentity } from '@/auth/identity';
import { type Session, tokenFor, useAccounts, useSession } from '@/auth/session-store';
import { devOffline, offlineError } from '@/lib/dev-offline';
import { useConnection, useConnectionStore } from '@/servers/connection';

import { type AdminApi, sdkAdminApi } from './api';
import { FIXTURE_ADMIN_ID, FIXTURE_SERVER_NAME, fixtureAdminApi } from './fixtures';
import { useAdminFixtures } from './fixture-mode';

export interface AdminTarget {
  serverId: string;
  serverName: string;
  /** The address in use, for "Open web dashboard". */
  serverUrl: string;
  /** The admin account that the panel acts as. */
  userId: string;
  userName: string;
  api: AdminApi;
  /** The device Id of this app: the Devices screen does not remove it. */
  ownDeviceId: string;
  fixture: boolean;
  /** The first part of every admin query key. */
  key: readonly ['admin', string, string];
}

export type AdminAccess =
  | { status: 'loading' }
  | { status: 'none'; reason: 'no-server' | 'no-account' | 'not-admin' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'ready'; target: AdminTarget };

interface Candidate {
  userId: string;
  userName: string;
  token: string;
  active: boolean;
}

const isolated = new Map<string, Api>();

/**
 * An Api for a saved account that is not active. It has its own axios
 * instance with no global handlers: a 401 for this token must not sign the
 * active account out.
 */
function isolatedApi(baseUrl: string, token: string): Api {
  const key = `${baseUrl}|${token}`;
  const hit = isolated.get(key);
  if (hit) return hit;
  const id = clientIdentity();
  const instance = createAxios({ timeout: 20_000 });
  instance.interceptors.request.use((config) => {
    if (devOffline()) throw offlineError();
    const url = config.baseURL ? `${config.baseURL}${config.url ?? ''}` : (config.url ?? '');
    if (url.startsWith(baseUrl)) config.headers.set('Authorization', buildAuthHeader(id, token));
    else config.headers.delete('Authorization');
    return config;
  });
  const api = new Jellyfin({ clientInfo: { name: id.client, version: id.version }, deviceInfo: { id: id.deviceId, name: id.device } }).createApi(baseUrl, token, instance);
  isolated.set(key, api);
  return api;
}

const fixtureApis = new Map<string, AdminApi>();

function fixtureApi(serverId: string): AdminApi {
  let a = fixtureApis.get(serverId);
  if (!a) {
    a = fixtureAdminApi();
    fixtureApis.set(serverId, a);
  }
  return a;
}

/** Saved accounts of a server that have a token here; the active account first (it needs no second sign-in). */
function candidatesFor(server: SavedServer | null, session: Session | null): Candidate[] {
  if (!server) return [];
  const list: Candidate[] = [];
  for (const u of server.users) {
    const token = tokenFor({ serverId: server.id, userId: u.userId });
    if (!token) continue;
    const active = session?.serverId === server.id && session.userId === u.userId;
    list.push({ userId: u.userId, userName: u.userName, token, active });
  }
  return list.sort((a, b) => Number(b.active) - Number(a.active));
}

function urlFor(server: SavedServer, session: Session | null, connected: string | null): string | null {
  return session?.serverId === server.id ? session.serverUrl : (connected ?? startUrl(server));
}

/** The query that finds the first saved admin account of a server (null: none). Cached for 5 minutes. */
function accessQuery(serverId: string, url: string | null, candidates: Candidate[], enabled: boolean) {
  return {
    queryKey: ['admin', serverId, 'access', candidates.map((c) => c.userId).join(',')],
    enabled: enabled && !!url && candidates.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Candidate | null> => {
      let lastError: unknown = null;
      for (const c of candidates) {
        try {
          const me = await getCurrentUser(apiFor(url ?? '', c));
          if (me.Policy?.IsAdministrator) return c;
        } catch (e) {
          lastError = e;
        }
      }
      if (lastError && candidates.length === 1) throw lastError;
      return null;
    },
  };
}

/** Finds the admin account of a server and the API to act as it. */
export function useAdminAccess(serverId: string | undefined): AdminAccess {
  const accounts = useAccounts();
  const session = useSession();
  const fixtures = useAdminFixtures();
  const conn = useConnection(serverId);
  const server = serverId ? findServer(accounts, serverId) : null;
  const url = server ? urlFor(server, session, conn.url) : null;
  const candidates = candidatesFor(server, session);
  const count = candidates.length;
  const { data: admin, isPending, isError, error, refetch } = useQuery(accessQuery(serverId ?? '', url, candidates, !fixtures && !!server));
  const serverName = server?.name ?? null;

  return useMemo<AdminAccess>(() => {
    if (!serverId || serverName === null) return { status: 'none', reason: 'no-server' };
    if (fixtures) {
      return {
        status: 'ready',
        target: {
          serverId,
          serverName: serverName || FIXTURE_SERVER_NAME,
          serverUrl: url ?? 'http://media.example.lan:8096',
          userId: FIXTURE_ADMIN_ID,
          userName: 'Jane Doe',
          api: fixtureApi(serverId),
          ownDeviceId: 'd-phone',
          fixture: true,
          key: ['admin', serverId, 'fixture'],
        },
      };
    }
    if (count === 0 || !url) return { status: 'none', reason: 'no-account' };
    if (isPending) return { status: 'loading' };
    if (isError) return { status: 'error', error, retry: () => void refetch() };
    if (!admin) return { status: 'none', reason: 'not-admin' };
    return {
      status: 'ready',
      target: {
        serverId,
        serverName,
        serverUrl: url,
        userId: admin.userId,
        userName: admin.userName,
        api: sdkAdminApi(apiFor(url, admin)),
        ownDeviceId: clientIdentity().deviceId,
        fixture: false,
        key: ['admin', serverId, admin.userId],
      },
    };
  }, [serverId, serverName, fixtures, url, count, isPending, isError, error, refetch, admin]);
}

/** The saved servers where a saved account is an admin (all servers in fixture mode). For the Settings entry. */
export function useAdminServers(): { serverId: string; serverName: string; userName: string }[] {
  const accounts = useAccounts();
  const session = useSession();
  const fixtures = useAdminFixtures();
  const byServer = useConnectionStore((st) => st.byServer);
  const inputs = useMemo(
    () =>
      accounts.servers.map((sv) => ({
        server: sv,
        url: urlFor(sv, session, byServer[sv.id]?.url ?? null),
        candidates: candidatesFor(sv, session),
      })),
    [accounts.servers, session, byServer],
  );
  const results = useQueries({ queries: inputs.map((i) => accessQuery(i.server.id, i.url, i.candidates, !fixtures)) });
  return inputs.flatMap((i, n) => {
    if (fixtures) return [{ serverId: i.server.id, serverName: i.server.name, userName: 'Jane Doe' }];
    const admin = results[n]?.data;
    return admin ? [{ serverId: i.server.id, serverName: i.server.name, userName: admin.userName }] : [];
  });
}

function apiFor(url: string, c: Candidate): Api {
  return c.active ? getApi(url, c.token) : isolatedApi(url, c.token);
}

