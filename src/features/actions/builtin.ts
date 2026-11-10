/**
 * Built-in item actions. They register through the same registry that any
 * later contributor uses.
 */
import { isDownloadable } from '@/downloads/plan';
import { canAddToPlaylist } from '@/features/playlists/logic';
import { canPlayRemotely } from '@/features/remote/logic';
import { itemActions } from '@/registry/item-actions';

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre', 'Playlist', 'Series', 'Season', 'BoxSet']);
const WATCHABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Series', 'Season', 'BoxSet', 'AudioBook']);
/** Items whose audio can go into the queue. */
const QUEUEABLE = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);
/** Items the server can build an Instant Mix from. */
const MIXABLE = new Set(['Audio', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);

function queueable(item: { Type?: string | null; MediaType?: string | null }): boolean {
  return QUEUEABLE.has(item.Type ?? '') || (item.Type === 'Playlist' && item.MediaType === 'Audio');
}

let registered = false;

export function registerBuiltinItemActions(): void {
  if (registered) return;
  registered = true;

  itemActions.register({
    id: 'builtin.play',
    title: 'Play',
    icon: 'play.fill',
    order: 10,
    group: 'play',
    when: ({ item }) => PLAYABLE.has(item.Type ?? ''),
    run: ({ item, app }) => app.play(item),
  });
  itemActions.register({
    id: 'builtin.playOn',
    title: 'Play on…',
    icon: 'airplay.video',
    order: 51,
    group: 'more',
    when: ({ item, app }) => !!app.playOn && canPlayRemotely(item),
    run: ({ item, app }) => app.playOn?.(item),
  });
  itemActions.register({
    id: 'builtin.playNext',
    title: 'Play next',
    icon: 'text.line.first.and.arrowtriangle.forward',
    order: 12,
    group: 'play',
    when: ({ item, app }) => !!app.playNext && queueable(item),
    run: ({ item, app }) => app.playNext?.(item),
  });
  itemActions.register({
    id: 'builtin.addToQueue',
    title: 'Add to queue',
    icon: 'text.append',
    order: 13,
    group: 'play',
    when: ({ item, app }) => !!app.addToQueue && queueable(item),
    run: ({ item, app }) => app.addToQueue?.(item),
  });
  itemActions.register({
    id: 'builtin.instantMix',
    title: 'Instant mix',
    icon: 'wand.and.stars',
    order: 50,
    group: 'more',
    when: ({ item, app }) => !!app.instantMix && (MIXABLE.has(item.Type ?? '') || (item.Type === 'Playlist' && item.MediaType === 'Audio')),
    run: ({ item, app }) => app.instantMix?.(item),
  });
  itemActions.register({
    id: 'builtin.addToPlaylist',
    title: 'Add to playlist…',
    icon: 'text.badge.plus',
    order: 21,
    group: 'library',
    when: ({ item, app }) => !!app.addToPlaylist && canAddToPlaylist(item),
    run: ({ item, app }) => app.addToPlaylist?.(item),
  });
  // Download / Downloading 45% (opens the Downloads tab) / Remove download: one of the three shows.
  itemActions.register({
    id: 'builtin.download',
    title: 'Download',
    icon: 'arrow.down.circle',
    order: 22,
    group: 'library',
    when: ({ item, app }) => !!app.downloadStatus && isDownloadable(item) && app.downloadStatus(item).state === 'none',
    run: ({ item, app }) => app.download?.(item),
  });
  itemActions.register({
    id: 'builtin.downloading',
    title: 'Downloading',
    titleFor: ({ item, app }) => {
      const st = app.downloadStatus?.(item);
      if (!st || st.state === 'none' || st.state === 'completed') return 'Downloading';
      if (st.state === 'failed' && st.missing) return 'Download again';
      const pct = `${Math.round(st.progress * 100)}%`;
      return st.state === 'failed' ? 'Download failed, see Downloads' : st.state === 'paused' ? `Download paused at ${pct}` : `Downloading ${pct}`;
    },
    icon: 'arrow.down.circle',
    order: 22,
    group: 'library',
    when: ({ item, app }) => {
      const st = app.downloadStatus?.(item).state;
      return !!st && st !== 'none' && st !== 'completed';
    },
    // A download whose file is gone downloads again; the others open the Downloads tab.
    run: ({ item, app }) => {
      const st = app.downloadStatus?.(item);
      if (st?.state === 'failed' && st.missing) app.download?.(item);
      else app.openDownloads?.();
    },
  });
  itemActions.register({
    id: 'builtin.removeDownload',
    title: 'Remove download',
    icon: 'trash',
    order: 90,
    group: 'library',
    destructive: true,
    when: ({ item, app }) => app.downloadStatus?.(item).state === 'completed',
    run: ({ item, app }) => app.removeDownload?.(item),
  });
  itemActions.register({
    id: 'builtin.renamePlaylist',
    title: 'Rename playlist',
    icon: 'pencil',
    order: 55,
    group: 'more',
    when: ({ item, app }) => item.Type === 'Playlist' && !!app.renamePlaylist,
    run: ({ item, app }) => app.renamePlaylist?.(item),
  });
  itemActions.register({
    id: 'builtin.deletePlaylist',
    title: 'Delete playlist',
    icon: 'trash',
    order: 95,
    group: 'more',
    destructive: true,
    when: ({ item, app }) => item.Type === 'Playlist' && !!app.deletePlaylist,
    run: ({ item, app }) => app.deletePlaylist?.(item),
  });
  // The server sets CanDelete only for a user with the content deletion permission.
  itemActions.register({
    id: 'builtin.deleteItem',
    title: 'Delete from server',
    icon: 'trash',
    order: 96,
    group: 'more',
    destructive: true,
    when: ({ item, app }) => !!app.deleteItem && item.CanDelete === true && item.Type !== 'Playlist',
    run: ({ item, app }) => app.deleteItem?.(item),
  });
  itemActions.register({
    id: 'builtin.favorite',
    title: 'Add to favourites',
    icon: 'heart',
    order: 20,
    group: 'library',
    when: ({ item }) => !!item.Id && !item.UserData?.IsFavorite,
    run: ({ item, app }) => app.setFavorite(item, true),
  });
  itemActions.register({
    id: 'builtin.unfavorite',
    title: 'Remove from favourites',
    icon: 'heart.fill',
    order: 20,
    group: 'library',
    when: ({ item }) => !!item.Id && !!item.UserData?.IsFavorite,
    run: ({ item, app }) => app.setFavorite(item, false),
  });
  itemActions.register({
    id: 'builtin.played',
    title: 'Mark as played',
    icon: 'checkmark.circle.fill',
    order: 30,
    group: 'library',
    when: ({ item }) => WATCHABLE.has(item.Type ?? '') && !item.UserData?.Played,
    run: ({ item, app }) => app.setPlayed(item, true),
  });
  itemActions.register({
    id: 'builtin.unplayed',
    title: 'Mark as unplayed',
    icon: 'circle',
    order: 30,
    group: 'library',
    when: ({ item }) => WATCHABLE.has(item.Type ?? '') && !!item.UserData?.Played,
    run: ({ item, app }) => app.setPlayed(item, false),
  });
  itemActions.register({
    id: 'builtin.goToSeries',
    title: 'Go to show',
    icon: 'tv',
    order: 40,
    group: 'goTo',
    when: ({ item, here }) => (item.Type === 'Episode' || item.Type === 'Season') && !!item.SeriesId && item.SeriesId !== here,
    run: ({ item, app }) => app.openItem({ Id: item.SeriesId ?? '', Type: 'Series', Name: item.SeriesName }),
  });
  itemActions.register({
    id: 'builtin.goToAlbum',
    title: 'Go to album',
    icon: 'square.stack',
    order: 40,
    group: 'goTo',
    when: ({ item, here }) => item.Type === 'Audio' && !!item.AlbumId && item.AlbumId !== here,
    run: ({ item, app }) => app.openItem({ Id: item.AlbumId ?? '', Type: 'MusicAlbum', Name: item.Album }),
  });
  itemActions.register({
    id: 'builtin.goToArtist',
    title: 'Go to artist',
    icon: 'music.mic',
    order: 41,
    group: 'goTo',
    when: ({ item, here }) => (item.Type === 'Audio' || item.Type === 'MusicAlbum') && !!item.AlbumArtists?.[0]?.Id && item.AlbumArtists[0].Id !== here,
    run: ({ item, app }) => {
      const a = item.AlbumArtists?.[0];
      app.openItem({ Id: a?.Id ?? '', Type: 'MusicArtist', Name: a?.Name });
    },
  });
}
