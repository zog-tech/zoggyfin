import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { router, useGlobalSearchParams } from 'expo-router';

import { asksDownloadQuality, downloads, downloadsSupported } from '@/downloads';
import { loadItemFacts, needsItemFacts } from '@/extensions/runtime';
import { useExtensions } from '@/extensions/store';
import { downloadsState, statusOf, useDownloadsStore } from '@/downloads/store';
import { setFavouriteOverride, useIsFavourite } from '@/features/actions/favourite-overrides';
import { openAddToPlaylist, openRenamePlaylist } from '@/features/playlists/add-to-playlist';
import * as playlistOps from '@/features/playlists/ops';
import { openPlayOn } from '@/features/remote/play-on-sheet';
import { remoteSupported } from '@/features/remote/use-remote';
import { confirmDestructive } from '@/lib/confirm';
import { formatBytes } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/player';
import { actionsFor, actionTitle, type AppActionApi, type ItemAction, itemActions } from '@/registry/item-actions';
import { openTabRoot } from '@/features/extensions/tab-nav';

import { registerBuiltinItemActions } from './builtin';
import { openDownloadQuality } from './download-quality-store';
import { likeDoneText } from './like-words';

registerBuiltinItemActions();

/** The actions for an item, plus a runner that supplies the app API. */
export function useItemActions(given: BaseItemDto | undefined) {
  const { api, userId, scope } = useApi();
  // A tile or the queue may hold a copy from before a like changed in this session:
  // the sheet offers Like or Unlike from the state the player heart shows.
  const fav = useIsFavourite(userId, given);
  const item = useMemo(
    () => (given?.UserData && !!given.UserData.IsFavorite !== fav ? { ...given, UserData: { ...given.UserData, IsFavorite: fav } } : given),
    [given, fav],
  );
  const qc = useQueryClient();
  const openItem = useOpenItem();
  const player = usePlayer();
  // The item page on screen, so a delete from that page goes back.
  const { id: routeId } = useGlobalSearchParams<{ id?: string }>();
  const version = useSyncExternalStore(itemActions.subscribe, itemActions.list, itemActions.list);
  // The download actions change with the item's download state.
  const dlKey = useDownloadsStore((s) => {
    if (!item?.Id || !downloadsSupported) return 'none';
    const st = statusOf(item.Id, s);
    return st.state === 'none' || st.state === 'completed' ? st.state : `${st.state}:${st.progress}`;
  });

  const app = useMemo<AppActionApi>(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.all(scope) });
    const guard = async (fn: () => Promise<void>, done: string) => {
      try {
        await fn();
        toast(done, { icon: 'checkmark' });
        await refresh();
      } catch (e) {
        toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
      }
    };
    return {
      play: (it) => player.play({ item: it }),
      playNext: (it) => player.playNext(it),
      addToQueue: (it) => player.addToQueue(it),
      instantMix: (it) => player.instantMix(it),
      openItem,
      setFavorite: (it, fav) =>
        guard(async () => {
          await jf.setFavorite(api, userId, it.Id ?? '', fav);
          // The music player heart reads this, so it matches a change made here.
          if (it.Id) setFavouriteOverride(userId, it.Id, fav);
        }, likeDoneText(it, fav)),
      setPlayed: (it, played) =>
        guard(() => jf.setPlayed(api, userId, it.Id ?? '', played), played ? 'Marked as played' : 'Marked as unplayed'),
      addToPlaylist: (it) => openAddToPlaylist(it),
      ...(remoteSupported ? { playOn: (it: BaseItemDto) => openPlayOn(it) } : null),
      renamePlaylist: (it) => openRenamePlaylist(it),
      deletePlaylist: async (it) => {
        const ok = await confirmDestructive(`Delete ${it.Name ?? 'this playlist'}?`, 'The playlist is removed from the server for this account. The songs and videos in it stay in the library.', 'Delete');
        if (ok && (await playlistOps.remove(it)) && router.canGoBack()) router.back();
      },
      deleteItem: async (it) => {
        const id = it.Id ?? '';
        const scopeNote = it.Type === 'Series' ? ' All its seasons and episodes go too.' : it.Type === 'Season' ? ' All its episodes go too.' : it.Type === 'MusicAlbum' ? ' All its songs go too.' : '';
        const ok = await confirmDestructive(
          `Delete ${it.Name ?? 'this item'} from the server?`,
          `The files are deleted from the server's disk for every user.${scopeNote} You cannot undo this.`,
          'Delete',
        );
        if (!ok || !id) return;
        try {
          await jf.deleteItem(api, id);
        } catch (e) {
          toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
          return;
        }
        toast(`Deleted ${it.Name ?? 'the item'}`, { icon: 'checkmark' });
        if (routeId === id && router.canGoBack()) router.back();
        qc.removeQueries({ queryKey: queryKeys.item(scope, id) });
        await refresh();
      },
      ...(downloadsSupported
        ? {
            downloadStatus: (it: BaseItemDto) => statusOf(it.Id ?? '', downloadsState()),
            // A new download of one video asks for its quality; a container, audio or a download that is there already does not.
            download: (it: BaseItemDto) => {
              if (asksDownloadQuality(it) && statusOf(it.Id ?? '', downloadsState()).state === 'none') openDownloadQuality(it);
              else void downloads.download(it);
            },
            removeDownload: async (it: BaseItemDto) => {
              const s = downloadsState();
              const id = it.Id ?? '';
              const ids = s.collections[id]?.itemIds ?? [id];
              const bytes = ids.reduce((n, x) => n + (s.records[x]?.bytesDone ?? 0), 0);
              const ok = await confirmDestructive(`Remove the download of ${it.Name ?? 'this item'}?`, `This frees ${formatBytes(bytes)} on this device. Nothing changes on the server.`, 'Remove');
              if (!ok) return;
              await (s.collections[id] ? downloads.removeGroup(id) : downloads.remove(id));
              toast('Download removed', { icon: 'checkmark' });
            },
            openDownloads: () => openTabRoot('downloads'),
          }
        : null),
    };
  }, [api, userId, scope, qc, openItem, player, routeId]);

  // Extension actions can filter on the item's library or file path: load them only then.
  const extList = useExtensions((st) => st.list);
  const wantFacts = useMemo(() => extList.length > 0 && needsItemFacts(), [extList]);
  const factsQ = useQuery({
    queryKey: [...queryKeys.all(scope), 'ext-facts', item?.Id ?? ''],
    queryFn: () => loadItemFacts(item?.Id ?? ''),
    enabled: wantFacts && !!item?.Id,
    staleTime: 5 * 60_000,
  });
  const facts = factsQ.data;

  const actions = useMemo(
    () => (item ? actionsFor({ item, app, platform: Platform.OS, facts, here: routeId }) : []),
    // `version` changes when the registry changes; `dlKey` when the download state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, app, version, dlKey, facts, routeId],
  );
  const titleOf = (action: ItemAction) => (item ? actionTitle(action, { item, app, platform: Platform.OS, facts, here: routeId }) : action.title);

  // Returns the action's promise, so a caller can wait for its end (an optimistic toggle).
  const run = (action: ItemAction): Promise<void> | undefined => {
    if (!item) return undefined;
    return Promise.resolve(action.run({ item, app, platform: Platform.OS, facts, here: routeId })).catch((e: unknown) =>
      toast(describeError(e).title),
    );
  };
  return { actions, run, app, titleOf };
}
