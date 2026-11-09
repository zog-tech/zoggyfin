/**
 * Query hooks of the Admin panel. Keys start with ['admin', serverId, userId],
 * so they never mix with the media cache and are not saved to disk.
 */
import { useFocusEffect } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { describeError } from '@/api/errors';
import { toast } from '@/lib/toast';
import type { IconName } from '@/components/icon-names';

import type { AdminTarget } from './access';
import { endAction, nextActivityStart, refreshDelay, SESSION_REFRESH_MS, startAction, TASK_REFRESH_MS } from './logic';

/** True while the screen is in front and the app is active. Live lists refresh only then. */
export function useLive(): boolean {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return focused && active;
}

export const adminKeys = {
  info: (t: AdminTarget) => [...t.key, 'info'] as const,
  storage: (t: AdminTarget) => [...t.key, 'storage'] as const,
  sessions: (t: AdminTarget) => [...t.key, 'sessions'] as const,
  users: (t: AdminTarget) => [...t.key, 'users'] as const,
  ratings: (t: AdminTarget) => [...t.key, 'ratings'] as const,
  libraries: (t: AdminTarget) => [...t.key, 'libraries'] as const,
  tasks: (t: AdminTarget) => [...t.key, 'tasks'] as const,
  activity: (t: AdminTarget) => [...t.key, 'activity'] as const,
  devices: (t: AdminTarget) => [...t.key, 'devices'] as const,
  logs: (t: AdminTarget) => [...t.key, 'logs'] as const,
};

export function useSystemInfo(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.info(t), queryFn: () => t.api.systemInfo(), staleTime: 30_000 });
}

export function useStorage(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.storage(t), queryFn: () => t.api.storage(), staleTime: 5 * 60_000 });
}

/** Sessions, refreshed every 5 s while `live`; slower after errors. */
export function useSessions(t: AdminTarget, live: boolean) {
  const failures = useRef(0);
  return useQuery({
    queryKey: adminKeys.sessions(t),
    queryFn: async () => {
      try {
        const list = await t.api.sessions();
        failures.current = 0;
        return list;
      } catch (e) {
        failures.current += 1;
        throw e;
      }
    },
    staleTime: 0,
    refetchInterval: () => refreshDelay({ focused: live, appActive: true, failures: failures.current, base: SESSION_REFRESH_MS }),
    refetchIntervalInBackground: false,
  });
}

/** Scheduled tasks. While one runs (and the screen is open) they refresh every 2 s; else every 30 s. */
export function useTasks(t: AdminTarget, live: boolean) {
  return useQuery({
    queryKey: adminKeys.tasks(t),
    queryFn: () => t.api.tasks(),
    staleTime: 0,
    refetchInterval: (q) => {
      const running = (q.state.data ?? []).some((x) => x.State === 'Running' || x.State === 'Cancelling');
      return refreshDelay({ focused: live, appActive: true, failures: q.state.fetchFailureCount, base: running ? TASK_REFRESH_MS : 30_000 });
    },
  });
}

export function useUsers(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.users(t), queryFn: () => t.api.users(), staleTime: 30_000 });
}

export function useParentalRatings(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.ratings(t), queryFn: () => t.api.parentalRatings(), staleTime: 60 * 60_000 });
}

export function useLibraries(t: AdminTarget, live = false) {
  return useQuery({
    queryKey: adminKeys.libraries(t),
    queryFn: () => t.api.libraries(),
    staleTime: 30_000,
    // While a library refreshes, its progress moves: check it again.
    refetchInterval: (q) => (live && (q.state.data ?? []).some((l) => l.RefreshStatus === 'Active') ? TASK_REFRESH_MS : false),
  });
}

export function useActivity(t: AdminTarget) {
  return useInfiniteQuery({
    queryKey: adminKeys.activity(t),
    queryFn: ({ pageParam }) => t.api.activity(pageParam),
    initialPageParam: 0,
    getNextPageParam: (_last, pages) => nextActivityStart(pages),
    staleTime: 30_000,
  });
}

export function useDevices(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.devices(t), queryFn: () => t.api.devices(), staleTime: 30_000 });
}

export function useLogFiles(t: AdminTarget) {
  return useQuery({ queryKey: adminKeys.logs(t), queryFn: () => t.api.logFiles(), staleTime: 30_000 });
}

/**
 * Runs an admin action: a spinner per action id, a toast with the result or
 * the error, then a refresh of the lists it changed. Resolves to true on
 * success. Actions with different ids run side by side; a second run of an id
 * that still runs is refused (false, no toast). `busy(id)` is true while that
 * action runs.
 */
export function useAdminAction() {
  const qc = useQueryClient();
  // The ref is the truth for the refusal (no stale render closure); the state
  // makes the screen render the spinners.
  const inFlight = useRef<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const run = useCallback(
    async <T>(
      id: string,
      action: () => Promise<T>,
      opts: { success: string | ((r: T) => string); icon?: IconName; invalidate?: readonly (readonly unknown[])[] },
    ): Promise<boolean> => {
      const started = startAction(inFlight.current, id);
      if (!started) return false;
      inFlight.current = started;
      setRunning(started);
      try {
        const r = await action();
        toast(typeof opts.success === 'function' ? opts.success(r) : opts.success, { icon: opts.icon ?? 'checkmark' });
        await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
        return true;
      } catch (e) {
        const d = describeError(e);
        toast(d.kind === 'forbidden' ? 'The server did not allow this. The account must be an administrator.' : `${d.title}. ${d.message}`, { icon: 'exclamationmark.triangle' });
        return false;
      } finally {
        inFlight.current = endAction(inFlight.current, id);
        setRunning(inFlight.current);
      }
    },
    [qc],
  );
  const busy = useCallback((id: string) => running.has(id), [running]);
  return { busy, run };
}
