/**
 * Built-in sections of the music Home tab. They register through the music
 * Home section registry, the same way later contributors will. Every row is
 * scoped to the chosen music library and hides when it is empty.
 *
 * Recently played, Recently added and Your top songs are core rows: they show
 * a skeleton while they load. The others are discovery rows, like the
 * discovery rows on Home: no skeleton, no error, and hidden while the server
 * is out of reach.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';

import { useLatest, useMusicItemsByIds, useMusicShelf, usePlayedSongs } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemRow } from '@/components/item-row';
import { useDay } from '@/features/home/use-day';
import { useOffline } from '@/lib/online';
import { musicGenreHref, useTabGroup } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { musicHomeSections, type MusicHomeSectionProps } from '@/registry/music-home-sections';

import {
  genreSongs,
  MAX_MIXES,
  mixSeeds,
  mixSubtitle,
  MUSIC_GENRE_ROW_MAX,
  orderByIds,
  PLAY_POOL_SIZE,
  rediscoverAlbumIds,
  topMusicGenres,
} from './home-rules';
import { useMusicHomeRow } from './home-row';

const songSubtitle = (item: BaseItemDto) => item.Artists?.[0] ?? item.Album;
const albumSubtitle = (item: BaseItemDto) => [item.AlbumArtist, item.ProductionYear].filter(Boolean).join(' · ') || undefined;
const mixTitle = (item: BaseItemDto) => item.Name;

/** Tap a song: play the row as a queue from that song. */
function usePlayRow(list: BaseItemDto[] | undefined) {
  const player = usePlayer();
  return (item: BaseItemDto) => {
    if (!list) return;
    player.play({ item, list, index: list.indexOf(item) });
  };
}

function PlayedSongs({ libraryId, kind, title }: MusicHomeSectionProps & { kind: 'recent' | 'most'; title: string }) {
  const q = usePlayedSongs(libraryId, kind);
  const row = useMusicHomeRow(!!q.data?.length);
  const play = usePlayRow(q.data);
  return (
    <ItemRow
      title={title}
      shape="square"
      items={q.data}
      isLoading={q.isPending}
      hideWhenEmpty
      onPress={play}
      tileSubtitle={songSubtitle}
      {...row}
    />
  );
}

function RecentlyPlayed({ libraryId }: MusicHomeSectionProps) {
  return <PlayedSongs libraryId={libraryId} kind="recent" title="Recently played" />;
}

function TopSongs({ libraryId }: MusicHomeSectionProps) {
  return <PlayedSongs libraryId={libraryId} kind="most" title="Your top songs" />;
}

/** The most played songs: the base of the mixes and of Rediscover. Both rows share one request. */
function usePlayPool(libraryId: string, enabled: boolean) {
  return useMusicShelf(libraryId, 'playPool', PLAY_POOL_SIZE, enabled);
}

/** Instant mixes from the user's top artists and genres. A tap starts the mix. */
function Mixes({ libraryId }: MusicHomeSectionProps) {
  const offline = useOffline();
  const player = usePlayer();
  const pool = usePlayPool(libraryId, !offline);
  const ids = useMemo(() => mixSeeds(pool.data, MAX_MIXES).map((s) => s.id), [pool.data]);
  const q = useMusicItemsByIds(libraryId, 'mixes', ids, !offline);
  const items = orderByIds(q.data, ids);
  const row = useMusicHomeRow(!offline && items.length > 0);
  if (offline || !items.length) return null;
  return (
    <ItemRow
      title="Mixes for you"
      shape="square"
      items={items}
      tileTitle={mixTitle}
      tileSubtitle={mixSubtitle}
      onPress={(item) => player.instantMix(item)}
      {...row}
    />
  );
}

function RecentlyAdded({ libraryId }: MusicHomeSectionProps) {
  const q = useLatest(libraryId);
  const row = useMusicHomeRow(!!q.data?.length);
  return (
    <ItemRow
      title="Recently added"
      shape="square"
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      tileSubtitle={albumSubtitle}
      {...row}
    />
  );
}

/** A discovery row of one plain request: hidden while offline and while empty. */
function ShelfRow({
  libraryId,
  shelf,
  title,
  subtitle,
}: MusicHomeSectionProps & {
  shelf: 'newReleases' | 'playlists';
  title: string;
  subtitle?: (item: BaseItemDto) => string | null | undefined;
}) {
  const offline = useOffline();
  const q = useMusicShelf(libraryId, shelf, undefined, !offline);
  const row = useMusicHomeRow(!offline && !!q.data?.length);
  if (offline || !q.data?.length) return null;
  return <ItemRow title={title} shape="square" items={q.data} tileSubtitle={subtitle} {...row} />;
}

function NewReleases({ libraryId }: MusicHomeSectionProps) {
  return <ShelfRow libraryId={libraryId} shelf="newReleases" title="New releases" subtitle={albumSubtitle} />;
}

/** Favourite albums, then favourite artists. One section, so one claim on the first TV focus. */
function Favourites({ libraryId }: MusicHomeSectionProps) {
  const offline = useOffline();
  const albums = useMusicShelf(libraryId, 'favouriteAlbums', undefined, !offline);
  const artists = useMusicShelf(libraryId, 'favouriteArtists', undefined, !offline);
  const hasAlbums = !!albums.data?.length;
  const row = useMusicHomeRow(!offline && (hasAlbums || !!artists.data?.length));
  if (offline) return null;
  return (
    <>
      <ItemRow
        title="Favourite albums"
        shape="square"
        items={albums.data}
        tileSubtitle={albumSubtitle}
        onLongPress={row.onLongPress}
        preferredFocus={row.preferredFocus}
      />
      <ItemRow
        title="Favourite artists"
        shape="circle"
        items={artists.data}
        onLongPress={row.onLongPress}
        preferredFocus={row.preferredFocus && !hasAlbums}
      />
    </>
  );
}

function Playlists({ libraryId }: MusicHomeSectionProps) {
  return <ShelfRow libraryId={libraryId} shelf="playlists" title="Playlists" />;
}

/** Albums the user played a lot, but not in the last two months. */
function Rediscover({ libraryId }: MusicHomeSectionProps) {
  const offline = useOffline();
  const day = useDay();
  const pool = usePlayPool(libraryId, !offline);
  const ids = useMemo(() => rediscoverAlbumIds(pool.data, Date.parse(day)), [pool.data, day]);
  const q = useMusicItemsByIds(libraryId, 'rediscover', ids, !offline);
  const items = orderByIds(q.data, ids);
  const row = useMusicHomeRow(!offline && items.length > 0);
  if (offline || !items.length) return null;
  return <ItemRow title="Rediscover" shape="square" items={items} tileSubtitle={albumSubtitle} {...row} />;
}

/** Music genres, the largest first. A tile opens the genre page of this library. */
function Genres({ libraryId }: MusicHomeSectionProps) {
  const offline = useOffline();
  const group = useTabGroup();
  // All genres: the server sorts them by name, the row by size.
  const q = useMusicShelf(libraryId, 'genres', 500, !offline);
  const items = topMusicGenres(q.data, MUSIC_GENRE_ROW_MAX);
  const row = useMusicHomeRow(!offline && items.length > 0);
  if (offline || !items.length) return null;
  return (
    <ItemRow
      title="Genres"
      shape="square"
      items={items}
      tileSubtitle={genreSongs}
      onPress={(genre) => router.push(musicGenreHref(group, genre, libraryId))}
      {...row}
    />
  );
}

let registered = false;

export function registerBuiltinMusicHomeSections(): void {
  if (registered) return;
  registered = true;
  musicHomeSections.register({ id: 'builtin.recentlyPlayed', order: 10, component: RecentlyPlayed });
  musicHomeSections.register({ id: 'builtin.mixes', order: 20, component: Mixes });
  musicHomeSections.register({ id: 'builtin.recentlyAdded', order: 30, component: RecentlyAdded });
  musicHomeSections.register({ id: 'builtin.topSongs', order: 40, component: TopSongs });
  musicHomeSections.register({ id: 'builtin.newReleases', order: 50, component: NewReleases });
  musicHomeSections.register({ id: 'builtin.favourites', order: 60, component: Favourites });
  musicHomeSections.register({ id: 'builtin.playlists', order: 70, component: Playlists });
  musicHomeSections.register({ id: 'builtin.rediscover', order: 80, component: Rediscover });
  musicHomeSections.register({ id: 'builtin.genres', order: 90, component: Genres });
}
