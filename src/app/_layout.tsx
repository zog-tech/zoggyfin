import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setUnauthorizedHandler } from '@/api/client';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE,
  dropOtherScopes,
  inScope,
  persisterFor,
  queryClient,
  shouldPersistQuery,
} from '@/api/query-client';
import { useSession, useSessionStore } from '@/auth/session-store';
import { RefreshSpinnerHost } from '@/components/refresh-spinner';
import { ToastHost } from '@/components/toast-host';
import { downloads, downloadsSupported } from '@/downloads';
import { ExtensionsHost } from '@/extensions/ui/host';
import { setNoAccountOpen, useNoAccountStore } from '@/features/offline/use-offline-entries';
import { AddToPlaylistHost } from '@/features/playlists/add-to-playlist';
import { PlayOnHost } from '@/features/remote/play-on-sheet';
import { remoteSupported } from '@/features/remote/use-remote';
import { UpdateCardHost } from '@/features/updates/update-card';
import { startOfflineServices } from '@/features/offline/bootstrap';
import { toast } from '@/lib/toast';
import { startUpdateChecks } from '@/platform/updates';
import { startOtaChecks } from '@/platform/updates/ota';
import { audioSession } from '@/player/audio/session';
import '@/invite/wiring';
import { useInviteLinks } from '@/invite/use-invite-links';
import { isTV } from '@/platform/tv';
import { mediaColors, useTheme } from '@/theme';
import { nearby } from '@/together/nearby';
import { AppThemeProvider } from '@/theme/provider';
import { TvSafeArea } from '@/theme/tv-safe-area';

/**
 * The players open over the page they came from. TV: a full-screen page
 * instead, so the page under it is taken off screen and its tiles cannot
 * keep the remote's focus while the video plays.
 */
const PLAYER_PRESENTATION = isTV ? ('fullScreenModal' as const) : ('transparentModal' as const);

export default function RootLayout() {
  const session = useSession();
  // Each account has its own persisted cache. A switch mounts the provider again,
  // so it restores the new account's cache and saves only that account's queries.
  const serverId = session?.serverId;
  const userId = session?.userId;
  const scope = useMemo(() => (serverId && userId ? { serverId, userId } : null), [serverId, userId]);
  const scopeId = scope ? `${scope.serverId}.${scope.userId}` : 'none';

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const s = useSessionStore.getState().session;
      if (!s) return;
      useSessionStore.getState().signOut();
      toast(`Your session on ${s.serverName} ended. Sign in again.`);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <PersistQueryClientProvider
        key={scopeId}
        client={queryClient}
        onSuccess={() => dropOtherScopes(scope)}
        persistOptions={{
          persister: persisterFor(scope),
          maxAge: CACHE_MAX_AGE,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            // Keep data even when its last refetch failed (offline), or the cache
            // would lose exactly what an offline cold start needs.
            shouldDehydrateQuery: (q) => q.state.data !== undefined && inScope(q.queryKey, scope) && shouldPersistQuery(q.queryKey),
          },
        }}>
        <AppThemeProvider>
          <TvSafeArea>
            <Root session={!!session} />
          </TvSafeArea>
        </AppThemeProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function Root({ session }: { session: boolean }) {
  const { c } = useTheme();
  const noAccount = useNoAccountStore((st) => st.open) && !session;
  // Invite links in the desktop app, and the extension offer after a join.
  useInviteLinks();
  useEffect(() => {
    if (session) setNoAccountOpen(false);
  }, [session]);
  // Downloads play with no account (see features/offline/entries.ts): the files are found at start, signed in or not.
  useEffect(() => {
    if (downloadsSupported) void downloads.init();
  }, []);
  // The desktop app and the sideloaded Android TV app: look for a new version soon after start and every few hours.
  useEffect(() => startUpdateChecks(), []);
  // Over-the-air updates (phones, tablets, TV): check after start and on return to the foreground; the card offers a restart.
  useEffect(() => startOtaChecks(), []);
  // A nearby session from before a restart: the session sheet offers to rejoin it.
  useEffect(() => nearby().loadSaved(), []);
  // Bring back the last audio queue (paused) after a restart.
  useEffect(() => {
    if (!session) return;
    startOfflineServices();
    audioSession().restore();
  }, [session]);
  return (
          <View style={[styles.flex, { backgroundColor: c.bg }]}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
              <Stack.Protected guard={session}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="add-account" options={{ presentation: 'modal' }} />
                <Stack.Screen name="extension-install" options={{ presentation: 'modal' }} />
                <Stack.Screen name="extension-panel" options={{ presentation: 'modal' }} />
                <Stack.Screen name="remote" options={{ presentation: 'modal' }} />
                <Stack.Screen name="share" />
              </Stack.Protected>
              <Stack.Protected guard={!session}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
              {/* The players and the offline Downloads also open with no account: downloads and nearby sessions need no sign-in. */}
              <Stack.Protected guard={session || noAccount}>
                <Stack.Screen
                  name="player"
                  options={{
                    presentation: PLAYER_PRESENTATION,
                    animation: 'fade',
                    animationDuration: 240,
                    contentStyle: { backgroundColor: mediaColors.black },
                    autoHideHomeIndicator: true,
                    // Android: the video uses the whole screen; a swipe from the edge shows the system bar.
                    navigationBarHidden: true,
                    orientation: 'default',
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen
                  name="now-playing"
                  options={{
                    presentation: PLAYER_PRESENTATION,
                    animation: 'slide_from_bottom',
                    animationDuration: 300,
                    contentStyle: { backgroundColor: mediaColors.black },
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen name="offline" />
              </Stack.Protected>
            </Stack>
            {session ? <AddToPlaylistHost /> : null}
            {session ? <ExtensionsHost /> : null}
            {session && remoteSupported ? <PlayOnHost /> : null}
            <UpdateCardHost />
            <RefreshSpinnerHost />
            <ToastHost />
          </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
