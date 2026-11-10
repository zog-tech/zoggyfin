/**
 * An extension panel: the extension's own web page, over the app. The page
 * can only use the bridge methods (see extensions/bridge.ts). Media,
 * entry pages and extension pages open through the same functions as a
 * tile (`openMedia`, `entryHref`, `pageHref`), with the same checks.
 *
 * What a panel changes (a sign-in, a setting on its server) shows at once:
 * `openPage` and the close of the panel load the extension's feeds again
 * (`refreshExtension`), so the page under the panel, its Home rows and a
 * page opened from here never show the old answers. Without this, a feed
 * younger than the 60 s `staleTime` kept its old data.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { getItem } from '@/api/jellyfin';
import { useApi } from '@/api/use-api';
import { EmptyState } from '@/components/states';
import type { BridgeRequest } from '@/extensions/bridge';
import { handleBridgeRequest } from '@/extensions/bridge';
import { resolveOnOrigin } from '@/extensions/match';
import { playRefusal } from '@/extensions/media/source';
import { pagesOf } from '@/extensions/schema';
import { currentAccount, refreshExtension, refreshLibrary, templateContext } from '@/extensions/runtime';
import { getExtension, useExtensions } from '@/extensions/store';
import { render } from '@/extensions/template';
import { ModalHeader } from '@/extensions/ui/modal-header';
import { PanelView } from '@/extensions/ui/panel-view';
import { entryHref, pageHref } from '@/features/extensions/nav';
import { openMedia } from '@/features/extensions/open-entry';
import { itemHref } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/player';
import { useTheme } from '@/theme';

export default function ExtensionPanelScreen() {
  const { ext: extId, panel: panelId } = useLocalSearchParams<{ ext: string; panel: string }>();
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === extId));
  const panel = ext?.manifest.contributes.panels?.find((p) => p.id === panelId);
  const { api, userId } = useApi();
  const player = usePlayer();
  const { c, scheme } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/(home)')), []);

  // Back to the page under the panel (by close, Back or a swipe): its feeds load again.
  useEffect(
    () => () => {
      if (extId) refreshExtension(extId);
    },
    [extId],
  );

  const url = useMemo(() => {
    if (!ext || !panel) return null;
    try {
      return resolveOnOrigin(ext.manifest.baseUrl, render(panel.url, templateContext(ext), encodeURIComponent)).toString();
    } catch {
      return null;
    }
  }, [ext, panel]);

  const handle = useCallback(
    (req: BridgeRequest) =>
      handleBridgeRequest(req, {
        context: () => {
          if (!ext) return null;
          const ctx = templateContext(ext);
          const account = currentAccount();
          const token = ext.grants.jellyfinToken && ext.manifest.permissions.includes('jellyfinToken') ? account?.token : undefined;
          return {
            extension: { id: ext.manifest.id, name: ext.manifest.name, version: ext.manifest.version },
            settings: ctx.settings,
            jellyfin: { ...ctx.jellyfin, ...(token ? { token } : null) },
            theme: scheme,
            platform: Platform.OS,
          };
        },
        play: async (itemId) => player.play({ item: await getItem(api, userId, itemId) }),
        openItem: async (itemId) => {
          const item = await getItem(api, userId, itemId);
          const href = itemHref('(home)', item);
          close();
          if (href) setTimeout(() => router.push(href), 50);
        },
        refreshLibrary,
        toast: (text) => toast(text),
        close,
        baseUrl: ext?.manifest.baseUrl ?? '',
        playRefusal: () => playRefusal(ext ? (getExtension(ext.manifest.id) ?? ext) : undefined),
        playMedia: async (m) => {
          if (!ext) return;
          const media = { id: m.mediaId, kind: 'video' as const, playback: m.playback };
          await openMedia(getExtension(ext.manifest.id) ?? ext, { title: m.title, imageUrl: m.image, media });
        },
        openEntry: ({ detail, title }) => {
          if (!ext) return;
          const href = entryHref('(home)', ext.manifest.id, { key: 'panel', detail, title });
          close();
          setTimeout(() => router.push(href), 50);
        },
        hasPage: (pageId) => !!ext && pagesOf(ext.manifest).some((p) => p.id === pageId),
        openPage: (pageId) => {
          if (!ext) return;
          const href = pageHref('(home)', ext.manifest.id, pageId);
          refreshExtension(ext.manifest.id);
          close();
          setTimeout(() => router.push(href), 50);
        },
        refreshPage: () => {
          if (ext) refreshExtension(ext.manifest.id);
        },
      }),
    [ext, scheme, player, api, userId, close],
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bgGrouped }}>
      <ModalHeader title={panel?.title ?? ext?.manifest.name ?? 'Extension'} onClose={close} />
      {!ext || !panel || !url ? (
        <EmptyState icon="square.grid.2x2" title="Panel not found" message="The extension is off or removed, or it has no such panel." />
      ) : !ext.enabled ? (
        <EmptyState icon="square.grid.2x2" title={`${ext.manifest.name} is off`} message="Turn it on in Settings, Extensions." />
      ) : error ? (
        <EmptyState icon="exclamationmark.triangle" title="The page stopped" message={error} />
      ) : (
        <PanelView url={url} baseUrl={ext.manifest.baseUrl} handle={handle} onError={setError} />
      )}
    </View>
  );
}
