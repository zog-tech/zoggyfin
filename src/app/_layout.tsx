import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { setUnauthorizedHandler } from '@/api/client';
import {
  applyLiteQueryCache,
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
import { DownloadQualityHost } from '@/features/actions/download-quality-sheet';
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
import { setChannelLiteCheck, startIptvSync } from '@/iptv';
import { startRemoteTarget } from '@/remote-target';
import { startMemProbe } from '@/platform/mem-probe';
import { startDiagLog } from '@/lib/diag-store';
import { storage } from '@/storage/kv';
import { installAppContextMenu } from '@/components/context-menu';
import { isDesktop } from '@/platform/desktop';
import { setLiteCheck } from '@/platform/lite-flag';
import { liteNow } from '@/platform/lite-now';
import { useLite } from '@/platform/use-lite';
import { isTV } from '@/platform/tv';
import { TV_PAGE_BG } from '@/lib/stack-options';
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
  // EXPO_PUBLIC_MEM_PROBE=1 builds only: the JS heap in the device log every 5 s.
  useEffect(() => startMemProbe(), []);
  // The player log for "Report a problem": on in every build, saved so it survives an app kill.
  useEffect(() => startDiagLog(storage), []);
  // Lite mode drops the Live TV channel lists when no page uses them (iptv/holds.ts).
  useEffect(() => {
    setChannelLiteCheck(liteNow);
    setLiteCheck(liteNow);
  }, []);
  // Lite mode keeps the data of a closed page for 5 minutes, not 7 days.
  const lite = useLite();
  useEffect(() => applyLiteQueryCache(lite), [lite]);
  // A nearby session from before a restart: the session sheet offers to rejoin it.
  useEffect(() => nearby().loadSaved(), []);
  // Mac app: no browser menu (save image, reload) on a right click that no control took.
  useEffect(() => (isDesktop ? installAppContextMenu(document) : undefined), []);
  // Bring back the last audio queue (paused) after a restart.
  useEffect(() => {
    if (!session) return;
    startOfflineServices();
    audioSession().restore();
    // Live TV in the Jellyfin account: pull the setup now and follow account switches.
    startIptvSync();
    // TV, the Mac app and desktop browsers: accept remote control from the user's other clients.
    startRemoteTarget();
  }, [session]);
  return (
          <View style={[styles.flex, { backgroundColor: isTV ? TV_PAGE_BG : c.bg }]}>
            {/* TV: no background on this view. The window paints the page colour (SystemUI in theme/provider), and a second full-screen fill cost GPU time on every frame. */}
            {/* TV changes screens at once (no push animation), like the streaming apps. */}
            {/*
              TV: the window is the one page background (see TV_PAGE_BG in lib/stack-options). Every
              opaque layer over it is drawn again for the whole screen, and on a TV stick that cost frames.
            */}
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: isTV ? TV_PAGE_BG : c.bg }, ...(isTV ? { animation: 'none' as const } : null) }}>
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
                    animation: isTV ? 'none' : 'fade',
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
                    animation: isTV ? 'none' : 'slide_from_bottom',
                    animationDuration: 300,
                    contentStyle: { backgroundColor: mediaColors.black },
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen name="offline" />
              </Stack.Protected>
            </Stack>
            {session ? <AddToPlaylistHost /> : null}
            {session && downloadsSupported ? <DownloadQualityHost /> : null}
            {session ? <ExtensionsHost /> : null}
            {session && remoteSupported ? <PlayOnHost /> : null}
            <UpdateCardHost />
            <RefreshSpinnerHost />
            <ToastHost />
          </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
