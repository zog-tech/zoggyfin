/**
 * Built-in Home sections. They register through the Home section registry,
 * the same way later contributors will.
 */
import { router } from 'expo-router';

import {
  useGenreOfDayItems,
  useLatest,
  useMovieRecommendations,
  useNextUp,
  useResume,
  useShortMoviePool,
  useVideoGenres,
  useViews,
} from '@/api/queries';
import { useApi } from '@/api/use-api';
import { downloadsSupported, useDownloadLists } from '@/downloads';
import { useServerNames } from '@/features/servers/use-server-names';
import { useOffline } from '@/lib/online';
import type { BaseItemDto } from '@/api/types';
import { ItemRow } from '@/components/item-row';
import { EmptyState } from '@/components/states';
import { shapeForList } from '@/components/tile';
import { browseGenres, GENRE_ROW_MAX, genreCount } from '@/features/genres/genres';
import { daySeed } from '@/features/home/daily';
import { GENRE_POOL_SIZE, pickDailyGenre, spotlightItems, spotlightTitle } from '@/features/home/genre-spotlight';
import { recommendationRows } from '@/features/home/recommendations';
import { SHORT_POOL_SIZE, shortOnTime } from '@/features/home/short-on-time';
import { useDay } from '@/features/home/use-day';
import { LiveTvHomeRow } from '@/features/iptv/home-row';
import { isSupportedView } from '@/features/library/library-kind';
import { episodeLabel, formatDuration, remainingLabel } from '@/lib/format';
import { itemHref, useOpenItem, useTabGroup, videoGenreHref } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { useHomeSettings } from '@/settings/home';
import { isTV } from '@/platform/tv';
import { homeSections } from '@/registry/home-sections';
import { openTabRoot } from '@/features/extensions/tab-nav';

const runtimeSubtitle = (item: BaseItemDto) => formatDuration(item.RunTimeTicks);

const episodeSubtitle = (item: BaseItemDto) =>
  item.Type === 'Episode' ? [episodeLabel(item), item.Name].filter(Boolean).join(' · ') : undefined;

/**
 * Continue watching: an episode says its season, number and name under the show's title. TV puts the
 * caption under the art, which has no room for the time left beside it: there a movie's line says it.
 */
const continueSubtitle = (item: BaseItemDto) => episodeSubtitle(item) ?? (isTV ? (remainingLabel(item) ?? undefined) : undefined);

/**
 * TV: Select on a tile of a "watch now" row plays it at once (from where it was left), like the
 * streaming apps; a long press opens its page. Elsewhere the tile opens the page.
 */
function useWatchNowPress(): { onPress?: (item: BaseItemDto) => void; onLongPress?: (item: BaseItemDto) => void } {
  const player = usePlayer();
  const open = useOpenItem();
  if (!isTV) return {};
  return { onPress: (item) => void player.play({ item }), onLongPress: open };
}

function ContinueWatching() {
  const q = useResume('Video');
  const press = useWatchNowPress();
  return (
    <ItemRow
      title="Continue watching"
      shape="thumb"
      titleOnArt
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      tileSubtitle={continueSubtitle}
      // TV: the first focus is on Home's Play button (HomeHero), not on this row.
      {...press}
    />
  );
}

function NextUp() {
  const q = useNextUp();
  const press = useWatchNowPress();
  return (
    <ItemRow
      title="Next up"
      shape="thumb"
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      tileSubtitle={episodeSubtitle}
      {...press}
    />
  );
}

/*
 * Discovery rows ("Because you watched", "Short on time", the daily genre)
 * are extras: they show no skeleton and no error, and they hide while the
 * server is out of reach, since their items do not play offline. A load
 * with no cache adds them when the data arrives; after that the persisted
 * cache shows them at once on a cold start.
 */

/** "Because you watched …": up to three rows from the server's movie recommendations. */
function BecauseYouWatched() {
  const offline = useOffline();
  const q = useMovieRecommendations(!offline);
  const rows = recommendationRows(q.data);
  if (offline || !rows.length) return null;
  return (
    <>
      {rows.map((r) => (
        <ItemRow key={r.key} title={r.title} shape="poster" items={r.items} />
      ))}
    </>
  );
}

/** "Short on time": unwatched movies of 100 minutes or less, in an order that stays for the day. */
function ShortOnTime() {
  const offline = useOffline();
  const { userId } = useApi();
  const day = useDay();
  const q = useShortMoviePool(SHORT_POOL_SIZE, !offline);
  const items = shortOnTime(q.data, daySeed(day, userId));
  if (offline || !items.length) return null;
  return <ItemRow title="Short on time" shape="poster" items={items} tileSubtitle={runtimeSubtitle} />;
}

/** The genre of the day: one movie or show genre per user and day, unwatched items first. */
function GenreOfTheDay() {
  const offline = useOffline();
  const { userId } = useApi();
  const day = useDay();
  const genres = useVideoGenres(!offline);
  const genre = pickDailyGenre(genres.data, daySeed(day, userId));
  const q = useGenreOfDayItems(day, genre?.Id ?? undefined, GENRE_POOL_SIZE, !offline);
  const items = spotlightItems(q.data);
  if (offline || !genre || !items.length) return null;
  return <ItemRow title={spotlightTitle(genre)} shape="poster" items={items} />;
}

/** Movie and show genres, the largest first. A tile opens the genre with all its movies and shows. */
function Genres() {
  const offline = useOffline();
  const group = useTabGroup();
  const genres = useVideoGenres(!offline);
  const items = browseGenres(genres.data, GENRE_ROW_MAX);
  if (offline || !items.length) return null;
  return (
    <ItemRow
      title="Genres"
      shape="thumb"
      titleOnArt
      items={items}
      tileSubtitle={genreCount}
      onPress={(genre) => {
        const href = videoGenreHref(group, genre);
        if (href) router.push(href);
      }}
    />
  );
}

function ContinueListening() {
  const q = useResume('Audio');
  const music = useHomeSettings((st) => st.music);
  if (!music) return null;
  return (
    <ItemRow title="Continue listening" shape="square" items={q.data} isLoading={q.isPending} error={q.error} onRetry={q.refetch} />
  );
}

function LatestRow({ view }: { view: BaseItemDto }) {
  const q = useLatest(view.Id ?? '');
  const group = useTabGroup();
  const shape =
    view.CollectionType === 'music' ? 'square' : shapeForList(q.data, view.CollectionType === 'homevideos' ? 'thumb' : 'poster');
  return (
    <ItemRow
      title={`Recently added in ${view.Name ?? 'Library'}`}
      shape={shape}
      items={q.data}
      isLoading={q.isPending}
      error={q.error}
      onRetry={q.refetch}
      onSeeAll={() => {
        const href = itemHref(group, view);
        if (href) router.push(href);
      }}
    />
  );
}

function RecentlyAdded() {
  const views = useViews();
  // Settings, Home: "Show music on Home" off leaves the music libraries' rows out.
  const music = useHomeSettings((st) => st.music);
  if (views.error && !views.data) {
    return <ItemRow title="Recently added" shape="poster" items={undefined} error={views.error} onRetry={views.refetch} />;
  }
  if (views.data && views.data.filter(isSupportedView).length === 0) {
    return <EmptyState icon="square.stack" title="No libraries yet" message="Add a library on the server, then pull to refresh." />;
  }
  return (
    <>
      {(views.data ?? [])
        .filter((v) => isSupportedView(v) && v.CollectionType !== 'playlists' && v.CollectionType !== 'boxsets' && (music || v.CollectionType !== 'music'))
        .map((v) => (
          <LatestRow key={v.Id} view={v} />
        ))}
    </>
  );
}

/** Downloads on this device as tiles: the album, the show or the movie, from every saved server. */
function DownloadedRow() {
  const { sections } = useDownloadLists();
  const nameOf = useServerNames();
  const groups = sections.flatMap((sec) => sec.groups);
  const items = groups.map((g) => g.item);
  if (!downloadsSupported || !items.length) return null;
  const many = sections.length > 1;
  return (
    <ItemRow
      title="Downloads"
      shape={shapeForList(items, 'poster')}
      items={items}
      onSeeAll={() => openTabRoot('downloads')}
      tileSubtitle={(it) => {
        const g = groups.find((x) => x.id === it.Id);
        const count = g && g.records.length > 1 ? `${g.records.length} ${g.type === 'Series' ? 'episodes' : 'songs'}` : null;
        // With downloads from more than one server, each tile names its server.
        return [count, many && g ? nameOf(g.serverId) : null].filter(Boolean).join(' · ') || undefined;
      }}
    />
  );
}

/** Offline: the downloads come first, since they are what plays. */
function DownloadedFirst() {
  return useOffline() ? <DownloadedRow /> : null;
}

function DownloadedLast() {
  return useOffline() ? null : <DownloadedRow />;
}

let registered = false;

export function registerBuiltinHomeSections(): void {
  if (registered) return;
  registered = true;
  homeSections.register({ id: 'builtin.downloadedOffline', order: 5, component: DownloadedFirst });
  homeSections.register({ id: 'builtin.continueWatching', order: 10, component: ContinueWatching });
  homeSections.register({ id: 'builtin.nextUp', order: 20, component: NextUp });
  // Live TV after the rows of things already started: favourite channels are a "watch now" choice too.
  homeSections.register({ id: 'builtin.liveTv', order: 22, component: LiveTvHomeRow });
  homeSections.register({ id: 'builtin.becauseYouWatched', order: 25, component: BecauseYouWatched });
  homeSections.register({ id: 'builtin.continueListening', order: 30, component: ContinueListening });
  homeSections.register({ id: 'builtin.shortOnTime', order: 35, component: ShortOnTime });
  homeSections.register({ id: 'builtin.recentlyAdded', order: 40, component: RecentlyAdded });
  homeSections.register({ id: 'builtin.genreOfTheDay', order: 42, component: GenreOfTheDay });
  homeSections.register({ id: 'builtin.genres', order: 44, component: Genres });
  homeSections.register({ id: 'builtin.downloaded', order: 50, component: DownloadedLast });
}
