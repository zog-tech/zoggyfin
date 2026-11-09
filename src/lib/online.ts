/**
 * Server reachability. The app is "offline" when no address of the
 * signed-in server answers, whatever the cause (no network, a plane, the
 * server is down). Each check also picks the address to use
 * (`servers/connection.ts`). Checks run at start, when the network changes
 * (web: the online event), when the app comes to the front, after a request
 * with no answer, and every 30 s while offline (2 minutes while online).
 */
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { setNetworkErrorHandler } from '@/api/client';
import { useSessionStore } from '@/auth/session-store';
import { checkConnection } from '@/servers/connection';

interface OnlineState {
  /** null until the first check. */
  reachable: boolean | null;
  checkedAt: number;
  /** Counts the changes to offline (the banner comes back on each one). */
  offlineCount: number;
}

export const useOnlineStore = create<OnlineState>(() => ({ reachable: null, checkedAt: 0, offlineCount: 0 }));

/** True only when a check failed: unknown counts as online, so a cold start does not flash the banner. */
export function useOffline(): boolean {
  return useOnlineStore((s) => s.reachable === false);
}

export function isOffline(): boolean {
  return useOnlineStore.getState().reachable === false;
}

/** Checks the server's addresses now. A call during a check waits for one more check (see `checkConnection`). */
export function checkServer(): Promise<boolean> {
  const s = useSessionStore.getState().session;
  if (!s) return Promise.resolve(true);
  return checkConnection(s.serverId).then((ok) => {
    // The account changed while the check ran: its result is not about this one.
    if (useSessionStore.getState().session?.serverId !== s.serverId) return ok;
    const prev = useOnlineStore.getState();
    useOnlineStore.setState({
      reachable: ok,
      checkedAt: Date.now(),
      offlineCount: !ok && prev.reachable !== false ? prev.offlineCount + 1 : prev.offlineCount,
    });
    return ok;
  });
}

/** A request failed with a network error: check again soon, the server may be gone. */
export function reportNetworkError(): void {
  if (Date.now() - useOnlineStore.getState().checkedAt > 5000) void checkServer();
}

let started = false;

export function startReachability(): void {
  if (started) return;
  started = true;
  void checkServer();
  setNetworkErrorHandler(reportNetworkError);
  try {
    Network.addNetworkStateListener(() => void checkServer());
  } catch {
    // Web without the Network Information API: the timer and AppState still run.
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('online', () => void checkServer());
    window.addEventListener('offline', () => void checkServer());
  }
  // A switch to another account: forget the old result and check the new server.
  useSessionStore.subscribe((st, prev) => {
    if (st.session?.serverId === prev.session?.serverId && st.session?.userId === prev.session?.userId) return;
    useOnlineStore.setState({ reachable: null, checkedAt: 0 });
    void checkServer();
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void checkServer();
  });
  setInterval(() => {
    const { reachable, checkedAt } = useOnlineStore.getState();
    const every = reachable === false ? 30_000 : 120_000;
    if (Date.now() - checkedAt >= every) void checkServer();
  }, 10_000);
}
