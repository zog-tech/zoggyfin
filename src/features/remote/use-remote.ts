/**
 * The app side of remote control: the controllable sessions (this device left
 * out) and the commands, each with an error toast and a quick refresh, so the
 * screen shows the new state without waiting for the next poll.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { useRemoteSessions } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import type { SessionInfoDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { clientIdentity } from '@/auth/identity';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';

import { controllableSessions } from './logic';

/** Remote control is on phones, tablets, the web and the Mac app. TV is the target, not the remote. */
export const remoteSupported: boolean = features.touchGestures;

/** How often the Remote screen asks the server for the session state (ms). */
export const REMOTE_POLL_MS = 2000;

export function useControllableSessions(opts: { enabled?: boolean; poll?: boolean } = {}) {
  const q = useRemoteSessions({ enabled: opts.enabled, pollMs: opts.poll ? REMOTE_POLL_MS : false });
  const sessions = useMemo<SessionInfoDto[]>(() => controllableSessions(q.data ?? [], clientIdentity().deviceId), [q.data]);
  return { ...q, sessions };
}

/** Opens the Remote screen, with a session chosen when one is given. */
export function openRemote(sessionId?: string): void {
  router.push(sessionId ? { pathname: '/remote', params: { session: sessionId } } : '/remote');
}

export function useRemoteActions() {
  const { api, scope } = useApi();
  const qc = useQueryClient();
  return useMemo(() => {
    const refresh = () => {
      // The target reports its new state shortly after a command.
      setTimeout(() => void qc.invalidateQueries({ queryKey: queryKeys.remoteSessions(scope) }), 400);
    };
    const send = async (fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        refresh();
        return true;
      } catch (e) {
        toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
        return false;
      }
    };
    return {
      play: (sessionId: string, itemIds: string[], startTicks?: number) => send(() => jf.remotePlay(api, sessionId, itemIds, startTicks)),
      playstate: (sessionId: string, command: jf.RemotePlaystate, seekTicks?: number) =>
        send(() => jf.remotePlaystate(api, sessionId, command, seekTicks)),
      setVolume: (sessionId: string, volume: number) => send(() => jf.remoteSetVolume(api, sessionId, volume)),
      toggleMute: (sessionId: string) => send(() => jf.remoteToggleMute(api, sessionId)),
    };
  }, [api, scope, qc]);
}
