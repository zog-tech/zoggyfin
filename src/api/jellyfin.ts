/**
 * The thin wrapper over `@jellyfin/sdk`. Screens call these functions, never the
 * SDK directly, so field lists live in one place and every call here has been
 * checked against a Jellyfin 10.11 server.
 */
import type { Api } from '@jellyfin/sdk';
import { getArtistApi } from '@jellyfin/sdk/lib/utils/api/artist-api';
import { getAuthenticationApi } from '@jellyfin/sdk/lib/utils/api/authentication-api';
import { getFilterApi } from '@jellyfin/sdk/lib/utils/api/filter-api';
import { getGenreApi } from '@jellyfin/sdk/lib/utils/api/genre-api';
import { getInstantMixApi } from '@jellyfin/sdk/lib/utils/api/instant-mix-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getLyricApi } from '@jellyfin/sdk/lib/utils/api/lyric-api';
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api';
import { getMovieApi } from '@jellyfin/sdk/lib/utils/api/movie-api';
import { getMediaSegmentApi } from '@jellyfin/sdk/lib/utils/api/media-segment-api';
import { getPersonApi } from '@jellyfin/sdk/lib/utils/api/person-api';
import { getPlaylistApi } from '@jellyfin/sdk/lib/utils/api/playlist-api';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api';
import { getShowApi } from '@jellyfin/sdk/lib/utils/api/show-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';
import { getUserDataApi } from '@jellyfin/sdk/lib/utils/api/user-data-api';
import { getUserViewApi } from '@jellyfin/sdk/lib/utils/api/user-view-api';
import axios, { isCancel } from 'axios';

import { devOffline } from '@/lib/dev-offline';

import type { LibraryQuery } from './query-keys';
import { serverUrlCandidates } from './server-url';
import type {
  AuthenticationResult,
  BaseItemDto,
  BaseItemKind,
  ImageType,
  ItemFields,
  ItemFilter,
  ItemSortBy,
  LyricDto,
  MediaSegmentDto,
  PlaybackInfoDto,
  PlaybackInfoResponse,
  PlaybackProgressInfo,
  PlaybackStopInfo,
  PublicSystemInfo,
  QueryFiltersLegacy,
  QuickConnectResult,
  RecommendationDto,
  UserDto,
} from './types';

export interface Page {
  items: BaseItemDto[];
  total: number;
  startIndex: number;
}

/** Fields every tile needs. Image tags and blurhashes come by default. */
// CanDelete lets a tile's action menu offer "Delete from server".
const TILE_FIELDS: ItemFields[] = ['PrimaryImageAspectRatio', 'ChildCount', 'Trickplay', 'CanDelete'];
const IMAGE_TYPES: ImageType[] = ['Primary', 'Thumb', 'Backdrop'];
const tile = {
  fields: TILE_FIELDS,
  enableImageTypes: IMAGE_TYPES,
  imageTypeLimit: 1,
  enableUserData: true,
};

function toPage(data: { Items?: BaseItemDto[] | null; TotalRecordCount?: number; StartIndex?: number }): Page {
  const items = data.Items ?? [];
  return { items, total: data.TotalRecordCount ?? items.length, startIndex: data.StartIndex ?? 0 };
}

// ---- Server and sign-in ---------------------------------------------------------

export interface FoundServer {
  url: string;
  info: PublicSystemInfo;
}

/**
 * Finds a Jellyfin server from what the user typed. Tries HTTPS first when no
 * scheme is given. Throws the last error when nothing answers.
 */
export async function findServer(input: string, signal?: AbortSignal): Promise<FoundServer> {
  const candidates = serverUrlCandidates(input);
  if (!candidates.length) throw new Error('Enter a server address, for example https://jellyfin.example.com');
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const res = await axios.get<PublicSystemInfo>(`${url}/System/Info/Public`, { timeout: 8000, signal });
      if (res.data?.Id && res.data.Version) return { url, info: res.data };
      lastError = new Error('This address does not look like a Jellyfin server.');
    } catch (e) {
      if (isCancel(e)) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('Cannot reach the server.');
}

export async function authenticateByName(api: Api, username: string, password: string): Promise<AuthenticationResult> {
  const res = await getAuthenticationApi(api).authenticateUserByName({
    authenticateUserByName: { Username: username, Pw: password },
  });
  return res.data;
}

export async function isQuickConnectEnabled(api: Api): Promise<boolean> {
  try {
    return (await getAuthenticationApi(api).getQuickConnectEnabled()).data === true;
  } catch {
    return false;
  }
}

export async function initiateQuickConnect(api: Api): Promise<QuickConnectResult> {
  return (await getAuthenticationApi(api).initiateQuickConnect()).data;
}

export async function quickConnectState(api: Api, secret: string): Promise<QuickConnectResult> {
  return (await getAuthenticationApi(api).getQuickConnectState({ secret })).data;
}

export async function authenticateWithQuickConnect(api: Api, secret: string): Promise<AuthenticationResult> {
  return (await getAuthenticationApi(api).authenticateWithQuickConnect({ quickConnectDto: { Secret: secret } })).data;
}

export async function logout(api: Api): Promise<void> {
  await getSessionApi(api).reportSessionEnded();
}

export async function getCurrentUser(api: Api): Promise<UserDto> {
  return (await getUserApi(api).getCurrentUser()).data;
}

// ---- Home -------------------------------------------------------------------------

export async function getViews(api: Api, userId: string): Promise<BaseItemDto[]> {
  return (await getUserViewApi(api).getUserViews({ userId })).data.Items ?? [];
}

export async function getResume(api: Api, userId: string, media: 'Video' | 'Audio'): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getResumeItems({
    userId,
    mediaTypes: [media],
    limit: 20,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

export async function getNextUp(api: Api, userId: string, seriesId?: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getNextUp({
    userId,
    seriesId,
    limit: 20,
    enableTotalRecordCount: false,
    enableResumable: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

export async function getLatest(api: Api, userId: string, parentId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getLatestMedia({ userId, parentId, limit: 20, ...tile });
  return res.data;
}

// ---- Items ------------------------------------------------------------------------

export async function getItem(api: Api, userId: string, itemId: string): Promise<BaseItemDto> {
  // GET /Items/{id} has no `fields` parameter: it returns the full item.
  return (await getLibraryApi(api).getItem({ itemId, userId })).data;
}

/** One page of a library grid. */
export async function getLibraryPage(
  api: Api,
  userId: string,
  q: LibraryQuery,
  startIndex: number,
  limit: number,
): Promise<Page> {
  const filters: ItemFilter[] = [];
  if (q.played === 'played') filters.push('IsPlayed');
  if (q.played === 'unplayed') filters.push('IsUnplayed');
  if (q.favorites) filters.push('IsFavorite');

  const sortBy: ItemSortBy[] = q.sortBy === 'SortName' ? ['SortName'] : [q.sortBy, 'SortName'];
  const res = await getLibraryApi(api).getItems({
    userId,
    // No parent: every library (a genre page).
    parentId: q.parentId || undefined,
    includeItemTypes: q.includeItemTypes as BaseItemKind[],
    recursive: true,
    sortBy,
    sortOrder: [q.sortOrder],
    filters: filters.length ? filters : undefined,
    genres: q.genres.length ? [...q.genres] : undefined,
    years: q.years.length ? [...q.years] : undefined,
    startIndex,
    limit,
    enableTotalRecordCount: true,
    ...tile,
  });
  return toPage(res.data);
}

export async function getFilters(
  api: Api,
  userId: string,
  parentId: string,
  includeItemTypes: readonly string[],
): Promise<QueryFiltersLegacy> {
  const res = await getFilterApi(api).getQueryFiltersLegacy({
    userId,
    parentId,
    includeItemTypes: includeItemTypes as BaseItemKind[],
  });
  return res.data;
}

export async function getSeasons(api: Api, userId: string, seriesId: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getSeasons({ seriesId, userId, ...tile });
  return res.data.Items ?? [];
}

export async function getEpisodes(api: Api, userId: string, seriesId: string, seasonId: string): Promise<BaseItemDto[]> {
  const res = await getShowApi(api).getEpisodes({
    seriesId,
    seasonId,
    userId,
    ...tile,
    fields: [...TILE_FIELDS, 'Overview'],
  });
  return res.data.Items ?? [];
}

export type ChildrenKind = 'tracks' | 'items' | 'playlist' | 'artistAlbums' | 'personItems' | 'artistSongs';

/** Children of a container: album tracks, collection items, playlist entries, an artist's albums, a person's titles. */
export async function getChildren(api: Api, userId: string, parentId: string, kind: ChildrenKind): Promise<BaseItemDto[]> {
  const lib = getLibraryApi(api);
  switch (kind) {
    case 'tracks': {
      const res = await lib.getItems({
        userId,
        parentId,
        sortBy: ['ParentIndexNumber', 'IndexNumber', 'SortName'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'playlist': {
      const res = await getPlaylistApi(api).getPlaylistItems({ playlistId: parentId, userId, ...tile });
      return res.data.Items ?? [];
    }
    case 'artistAlbums': {
      const res = await lib.getItems({
        userId,
        albumArtistIds: [parentId],
        includeItemTypes: ['MusicAlbum'],
        recursive: true,
        sortBy: ['ProductionYear', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'artistSongs': {
      const res = await lib.getItems({
        userId,
        artistIds: [parentId],
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy: ['PlayCount', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        limit: 20,
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'personItems': {
      const res = await lib.getItems({
        userId,
        personIds: [parentId],
        includeItemTypes: ['Movie', 'Series'],
        recursive: true,
        sortBy: ['PremiereDate', 'SortName'],
        sortOrder: ['Descending', 'Ascending'],
        ...tile,
      });
      return res.data.Items ?? [];
    }
    case 'items':
    default: {
      const res = await lib.getItems({ userId, parentId, sortBy: ['PremiereDate', 'SortName'], ...tile });
      return res.data.Items ?? [];
    }
  }
}

export async function getSimilar(api: Api, userId: string, itemId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getSimilarItems({ itemId, userId, limit: 16, fields: TILE_FIELDS });
  return res.data.Items ?? [];
}

// ---- Home discovery ---------------------------------------------------------------

/**
 * Movie recommendations ("Because you watched …"). Movies only: the server
 * has no such endpoint for shows or music. A server with no played or liked
 * movies answers with an empty list.
 */
export async function getMovieRecommendations(api: Api, userId: string): Promise<RecommendationDto[]> {
  const res = await getMovieApi(api).getMovieRecommendations({ userId, categoryLimit: 4, itemLimit: 12, fields: TILE_FIELDS });
  return res.data ?? [];
}

/**
 * The pool for "Short on time": the best-rated unwatched movies. The server
 * has no runtime filter, so the app filters this bounded set by runtime
 * (`features/home/short-on-time.ts`). `RunTimeTicks` comes by default.
 */
export async function getShortMoviePool(api: Api, userId: string, limit: number): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    includeItemTypes: ['Movie'],
    recursive: true,
    filters: ['IsUnplayed'],
    sortBy: ['CommunityRating', 'SortName'],
    sortOrder: ['Descending', 'Ascending'],
    limit,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

/** Movie and show genres with their counts (`MovieCount`, `SeriesCount`), for the genre of the day. */
export async function getVideoGenres(api: Api, userId: string): Promise<BaseItemDto[]> {
  const res = await getGenreApi(api).getGenres({
    userId,
    includeItemTypes: ['Movie', 'Series'],
    fields: ['ItemCounts'],
    enableImages: false,
    enableTotalRecordCount: false,
  });
  return res.data.Items ?? [];
}

/** The best-rated movies and shows of one genre. */
export async function getGenreVideos(api: Api, userId: string, genreId: string, limit: number): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    genreIds: [genreId],
    includeItemTypes: ['Movie', 'Series'],
    recursive: true,
    sortBy: ['CommunityRating', 'SortName'],
    sortOrder: ['Descending', 'Ascending'],
    limit,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

// ---- Music ------------------------------------------------------------------------

export type MusicTab = 'albums' | 'artists' | 'playlists' | 'songs' | 'genres' | 'audiobooks' | 'authors';

export interface MusicOptions {
  sortBy: ItemSortBy;
  sortOrder: 'Ascending' | 'Descending';
  favorites: boolean;
}

export const DEFAULT_MUSIC_OPTIONS: MusicOptions = { sortBy: 'SortName', sortOrder: 'Ascending', favorites: false };

export async function getMusicPage(
  api: Api,
  userId: string,
  libraryId: string,
  tab: MusicTab,
  startIndex: number,
  limit: number,
  options: MusicOptions = DEFAULT_MUSIC_OPTIONS,
): Promise<Page> {
  const base = { userId, startIndex, limit, enableTotalRecordCount: true, ...tile };
  const sortBy: ItemSortBy[] = options.sortBy === 'SortName' ? ['SortName'] : [options.sortBy, 'SortName'];
  // The server wants one sort order per sort field.
  const sortOrder: ('Ascending' | 'Descending')[] = sortBy.map((_, i) => (i === 0 ? options.sortOrder : 'Ascending'));
  const filters: ItemFilter[] | undefined = options.favorites ? ['IsFavorite'] : undefined;
  const isFavorite = options.favorites ? true : undefined;
  switch (tab) {
    case 'artists':
    case 'authors': {
      const res = await getArtistApi(api).getAlbumArtists({
        ...base,
        fields: [...TILE_FIELDS, 'ItemCounts'],
        parentId: libraryId,
        sortBy,
        sortOrder,
        isFavorite,
      });
      return toPage(res.data);
    }
    case 'genres': {
      const res = await getGenreApi(api).getGenres({ ...base, parentId: libraryId, sortBy, sortOrder, isFavorite });
      return toPage(res.data);
    }
    case 'playlists': {
      // Playlists live outside music libraries. Only audio playlists belong here.
      const res = await getLibraryApi(api).getItems({
        ...base,
        includeItemTypes: ['Playlist'],
        recursive: true,
        sortBy,
        sortOrder,
        filters,
        mediaTypes: ['Audio'],
      });
      return toPage(res.data);
    }
    case 'songs': {
      const res = await getLibraryApi(api).getItems({
        ...base,
        parentId: libraryId,
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy,
        sortOrder,
        filters,
      });
      return toPage(res.data);
    }
    case 'audiobooks': {
      // Audiobook libraries hold AudioBook items, and folders or albums of chapters.
      const res = await getLibraryApi(api).getItems({
        ...base,
        parentId: libraryId,
        includeItemTypes: ['AudioBook', 'MusicAlbum'],
        recursive: true,
        sortBy,
        sortOrder,
        filters,
      });
      return toPage(res.data);
    }
    case 'albums':
    default: {
      const res = await getLibraryApi(api).getItems({
        ...base,
        parentId: libraryId,
        includeItemTypes: ['MusicAlbum'],
        recursive: true,
        sortBy,
        sortOrder,
        filters,
      });
      return toPage(res.data);
    }
  }
}

/** The newest videos, or the most recently played songs, across every library (the Together picker). */
export async function getPickerItems(api: Api, userId: string, kind: 'video' | 'audio'): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    includeItemTypes: kind === 'video' ? ['Movie', 'Episode', 'Video', 'MusicVideo'] : ['Audio', 'AudioBook'],
    recursive: true,
    ...(kind === 'audio' ? { filters: ['IsPlayed' as const] } : null),
    sortBy: kind === 'video' ? ['DateCreated'] : ['DatePlayed'],
    sortOrder: ['Descending'],
    limit: 20,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

/** "Recently played" and "Most played" songs in a library. */
export async function getPlayedSongs(api: Api, userId: string, libraryId: string, kind: 'recent' | 'most'): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    parentId: libraryId,
    includeItemTypes: ['Audio', 'AudioBook'],
    recursive: true,
    filters: ['IsPlayed'],
    sortBy: kind === 'recent' ? ['DatePlayed', 'SortName'] : ['PlayCount', 'DatePlayed'],
    sortOrder: ['Descending', 'Descending'],
    limit: 20,
    enableTotalRecordCount: false,
    ...tile,
  });
  return res.data.Items ?? [];
}

/**
 * Every playable audio item under a container, in play order: an album's
 * tracks, a playlist's entries, an artist's songs (album by album), a
 * genre's songs, an audiobook folder's chapters.
 */
export async function getAudioTracks(api: Api, userId: string, item: BaseItemDto, libraryId?: string): Promise<BaseItemDto[]> {
  const lib = getLibraryApi(api);
  const id = item.Id ?? '';
  const fields: ItemFields[] = [...TILE_FIELDS, 'MediaSources', 'Chapters', 'Genres'];
  switch (item.Type) {
    case 'Audio':
    case 'AudioBook':
      return [item];
    case 'Playlist': {
      const res = await getPlaylistApi(api).getPlaylistItems({ playlistId: id, userId, ...tile, fields });
      return (res.data.Items ?? []).filter((i) => i.MediaType === 'Audio');
    }
    case 'MusicArtist': {
      const res = await lib.getItems({
        userId,
        artistIds: [id],
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy: ['ProductionYear', 'Album', 'ParentIndexNumber', 'IndexNumber', 'SortName'],
        sortOrder: ['Descending', 'Ascending', 'Ascending', 'Ascending', 'Ascending'],
        limit: 500,
        ...tile,
        fields,
      });
      return res.data.Items ?? [];
    }
    case 'MusicGenre':
    case 'Genre': {
      const res = await lib.getItems({
        userId,
        parentId: libraryId,
        genreIds: [id],
        includeItemTypes: ['Audio'],
        recursive: true,
        sortBy: ['Album', 'ParentIndexNumber', 'IndexNumber', 'SortName'],
        limit: 500,
        ...tile,
        fields,
      });
      return res.data.Items ?? [];
    }
    default: {
      // Albums and folders: the audio inside, in disc and track order.
      const res = await lib.getItems({
        userId,
        parentId: id,
        recursive: true,
        mediaTypes: ['Audio'],
        sortBy: ['ParentIndexNumber', 'IndexNumber', 'SortName'],
        ...tile,
        fields,
      });
      return res.data.Items ?? [];
    }
  }
}

/** Instant Mix: similar songs from a song, album, artist, playlist or genre. */
export async function getInstantMix(api: Api, userId: string, item: BaseItemDto): Promise<BaseItemDto[]> {
  const mix = getInstantMixApi(api);
  const id = item.Id ?? '';
  const common = { userId, limit: 100, ...tile, fields: [...TILE_FIELDS, 'MediaSources' as ItemFields] };
  let res;
  switch (item.Type) {
    case 'MusicArtist':
      res = await mix.getInstantMixFromArtists({ itemId: id, ...common });
      break;
    case 'MusicGenre':
    case 'Genre':
      res = await mix.getInstantMixFromMusicGenreById({ id, ...common });
      break;
    case 'MusicAlbum':
      res = await mix.getInstantMixFromAlbum({ itemId: id, ...common });
      break;
    case 'Playlist':
      res = await mix.getInstantMixFromPlaylist({ itemId: id, ...common });
      break;
    case 'Audio':
      res = await mix.getInstantMixFromSong({ itemId: id, ...common });
      break;
    default:
      res = await mix.getInstantMixFromItem({ itemId: id, ...common });
  }
  return (res.data.Items ?? []).filter((i) => i.MediaType === 'Audio' || i.Type === 'Audio');
}

/** Lyrics for a track, or null when it has none (the server answers 404). */
export async function getLyrics(api: Api, itemId: string): Promise<LyricDto | null> {
  try {
    return (await getLyricApi(api).getLyrics({ itemId })).data;
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw e;
  }
}

/** Songs and albums of one genre in a music library. */
export async function getGenreItems(api: Api, userId: string, libraryId: string | undefined, genreId: string): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    parentId: libraryId,
    genreIds: [genreId],
    includeItemTypes: ['MusicAlbum'],
    recursive: true,
    sortBy: ['SortName'],
    ...tile,
  });
  return res.data.Items ?? [];
}

// ---- User data -------------------------------------------------------------------

export async function setFavorite(api: Api, userId: string, itemId: string, favorite: boolean): Promise<void> {
  const ud = getUserDataApi(api);
  if (favorite) await ud.markFavoriteItem({ itemId, userId });
  else await ud.unmarkFavoriteItem({ itemId, userId });
}

export async function setPlayed(api: Api, userId: string, itemId: string, played: boolean): Promise<void> {
  const ud = getUserDataApi(api);
  if (played) await ud.markPlayedItem({ itemId, userId });
  else await ud.markUnplayedItem({ itemId, userId });
}

// ---- Search -----------------------------------------------------------------------

const SEARCH_TYPES: BaseItemKind[] = [
  'Movie',
  'Series',
  'Episode',
  'BoxSet',
  'MusicAlbum',
  'Audio',
  'Playlist',
  'Video',
  'MusicVideo',
];

/** Items, artists and people in parallel. Artists and people are not returned by /Items. */
/** Movies and shows of one genre (by name), matching `term` when there is one; with no term the best rated first. */
async function searchGenre(api: Api, userId: string, term: string, genre: string, signal?: AbortSignal): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems(
    {
      userId,
      searchTerm: term || undefined,
      genres: [genre],
      recursive: true,
      includeItemTypes: ['Movie', 'Series'],
      sortBy: term ? undefined : ['CommunityRating', 'SortName'],
      sortOrder: term ? undefined : ['Descending', 'Ascending'],
      limit: term ? 60 : 100,
      ...tile,
    },
    { signal },
  );
  return res.data.Items ?? [];
}

/** `genre`: only movies and shows of that genre (artists, people and songs have no movie genre). */
export async function search(api: Api, userId: string, term: string, signal?: AbortSignal, genre?: string): Promise<BaseItemDto[]> {
  if (genre) return searchGenre(api, userId, term, genre, signal);
  const opts = { signal };
  const [items, artists, people] = await Promise.all([
    getLibraryApi(api).getItems(
      { userId, searchTerm: term, recursive: true, includeItemTypes: SEARCH_TYPES, limit: 60, ...tile },
      opts,
    ),
    getArtistApi(api).getArtists({ userId, searchTerm: term, limit: 12, ...tile }, opts),
    getPersonApi(api).getPersons({ userId, searchTerm: term, limit: 12, enableImageTypes: ['Primary'] }, opts),
  ]);
  return [...(artists.data.Items ?? []), ...(items.data.Items ?? []), ...(people.data.Items ?? [])];
}

// ---- Playback --------------------------------------------------------------------

/** POST /Items/{id}/PlaybackInfo with the device profile. The answer picks direct play or a transcode. */
export async function getPlaybackInfo(api: Api, itemId: string, body: PlaybackInfoDto): Promise<PlaybackInfoResponse> {
  const res = await getMediaInfoApi(api).getPostedPlaybackInfo({ itemId, userId: body.UserId ?? undefined, playbackInfoDto: body });
  const data = res.data;
  if (data.ErrorCode) throw new Error(playbackErrorText(data.ErrorCode));
  return data;
}

function playbackErrorText(code: string): string {
  switch (code) {
    case 'NotAllowed':
      return 'Your account is not allowed to play this item.';
    case 'NoCompatibleStream':
      return 'The server has no stream this device can play.';
    case 'RateLimitExceeded':
      return 'The server is busy. Try again in a moment.';
    default:
      return `The server cannot play this item (${code}).`;
  }
}

export async function reportPlaybackStart(api: Api, info: PlaybackProgressInfo): Promise<void> {
  await getSessionApi(api).reportPlaybackStart({ playbackStartInfo: info });
}

export async function reportPlaybackProgress(api: Api, info: PlaybackProgressInfo): Promise<void> {
  await getSessionApi(api).reportPlaybackProgress({ playbackProgressInfo: info });
}

export async function reportPlaybackStopped(api: Api, info: PlaybackStopInfo): Promise<void> {
  await getSessionApi(api).reportPlaybackStopped({ playbackStopInfo: info });
}

/**
 * Intro, credits and recap segments. Media segments are new in 10.10; an
 * older server, a missing provider or any error gives an empty list.
 */
export async function getMediaSegments(api: Api, itemId: string): Promise<MediaSegmentDto[]> {
  try {
    const res = await getMediaSegmentApi(api).getItemSegments({
      itemId,
      includeSegmentTypes: ['Intro', 'Outro', 'Recap', 'Preview', 'Commercial'],
    });
    return res.data.Items ?? [];
  } catch {
    return [];
  }
}

/** The episode after `episode` in its series, or null at the end. */
export async function getNextEpisode(api: Api, userId: string, episode: BaseItemDto): Promise<BaseItemDto | null> {
  if (!episode.SeriesId || !episode.Id) return null;
  const res = await getShowApi(api).getEpisodes({
    seriesId: episode.SeriesId,
    userId,
    startItemId: episode.Id,
    limit: 2,
    ...tile,
  });
  const items = res.data.Items ?? [];
  const next = items.find((e) => e.Id !== episode.Id);
  return next ?? null;
}

/**
 * What "Play" on a container plays: a show starts at Next Up (or the first
 * episode), a season at its first unwatched episode, a collection at its first item.
 */
export async function resolvePlayable(api: Api, userId: string, item: BaseItemDto): Promise<BaseItemDto | null> {
  const lib = getLibraryApi(api);
  switch (item.Type) {
    case 'Series': {
      const next = await getNextUp(api, userId, item.Id ?? undefined);
      if (next[0]) return next[0];
      const res = await getShowApi(api).getEpisodes({ seriesId: item.Id ?? '', userId, limit: 1, ...tile });
      return res.data.Items?.[0] ?? null;
    }
    case 'Season': {
      const res = await getShowApi(api).getEpisodes({
        seriesId: item.SeriesId ?? item.ParentId ?? '',
        seasonId: item.Id ?? undefined,
        userId,
        ...tile,
      });
      const eps = res.data.Items ?? [];
      return eps.find((e) => !e.UserData?.Played) ?? eps[0] ?? null;
    }
    case 'BoxSet': {
      const res = await lib.getItems({ userId, parentId: item.Id ?? undefined, sortBy: ['PremiereDate', 'SortName'], limit: 1, ...tile });
      return res.data.Items?.[0] ?? null;
    }
    default:
      return item;
  }
}

/** A text file from the server (subtitles). The request carries the auth header. */
export async function getText(api: Api, url: string): Promise<string> {
  const res = await api.axiosInstance.get<string>(url, { responseType: 'text', transformResponse: (d: unknown) => d });
  return typeof res.data === 'string' ? res.data : String(res.data);
}

// ---- Playlists -------------------------------------------------------------------

/** The user's playlists, newest first. `mediaType` keeps only audio or only video playlists. */
export async function getPlaylists(api: Api, userId: string, mediaType?: 'Audio' | 'Video'): Promise<BaseItemDto[]> {
  const res = await getLibraryApi(api).getItems({
    userId,
    includeItemTypes: ['Playlist'],
    recursive: true,
    sortBy: ['DateCreated', 'SortName'],
    sortOrder: ['Descending', 'Ascending'],
    mediaTypes: mediaType ? [mediaType] : undefined,
    limit: 200,
    ...tile,
  });
  return res.data.Items ?? [];
}

/** Creates a playlist with the items in it. Returns the new playlist id. */
export async function createPlaylist(
  api: Api,
  userId: string,
  name: string,
  ids: string[],
  mediaType: 'Audio' | 'Video',
): Promise<string> {
  const res = await getPlaylistApi(api).createPlaylist({
    createPlaylistDto: { Name: name, Ids: ids, UserId: userId, MediaType: mediaType, IsPublic: false },
  });
  const id = res.data.Id;
  if (!id) throw new Error('The server did not make the playlist.');
  return id;
}

export async function addToPlaylist(api: Api, userId: string, playlistId: string, ids: string[]): Promise<void> {
  await getPlaylistApi(api).addItemToPlaylist({ playlistId, ids, userId });
}

/** `entryIds` are the PlaylistItemId values of the entries, not the item ids. */
export async function removeFromPlaylist(api: Api, playlistId: string, entryIds: string[]): Promise<void> {
  await getPlaylistApi(api).removeItemFromPlaylist({ playlistId, entryIds });
}

/** Moves one entry (its PlaylistItemId) to `newIndex`. */
export async function movePlaylistItem(api: Api, playlistId: string, entryId: string, newIndex: number): Promise<void> {
  await getPlaylistApi(api).moveItem({ playlistId, itemId: entryId, newIndex });
}

export async function renamePlaylist(api: Api, playlistId: string, name: string): Promise<void> {
  await getPlaylistApi(api).updatePlaylist({ playlistId, updatePlaylistDto: { Name: name } });
}

export async function deletePlaylist(api: Api, playlistId: string): Promise<void> {
  await getLibraryApi(api).deleteItem({ itemId: playlistId });
}

/** Deletes an item and its files from the server. The user needs the content deletion permission. */
export async function deleteItem(api: Api, itemId: string): Promise<void> {
  await getLibraryApi(api).deleteItem({ itemId });
}

// ---- Downloads and offline progress ---------------------------------------------

/**
 * The items a container download holds, with their media sources: an
 * album's tracks, a playlist's entries, a season's or a show's episodes,
 * a collection's items.
 */
export async function getDownloadChildren(api: Api, userId: string, item: BaseItemDto): Promise<BaseItemDto[]> {
  const id = item.Id ?? '';
  const fields: ItemFields[] = [...TILE_FIELDS, 'MediaSources', 'Chapters', 'Overview'];
  switch (item.Type) {
    case 'Playlist': {
      const res = await getPlaylistApi(api).getPlaylistItems({ playlistId: id, userId, ...tile, fields });
      return res.data.Items ?? [];
    }
    case 'Season': {
      const res = await getShowApi(api).getEpisodes({ seriesId: item.SeriesId ?? item.ParentId ?? '', seasonId: id, userId, ...tile, fields });
      return res.data.Items ?? [];
    }
    case 'Series': {
      const res = await getShowApi(api).getEpisodes({ seriesId: id, userId, ...tile, fields });
      return res.data.Items ?? [];
    }
    case 'BoxSet':
    case 'Folder': {
      const res = await getLibraryApi(api).getItems({ userId, parentId: id, recursive: true, mediaTypes: ['Video', 'Audio'], ...tile, fields });
      return res.data.Items ?? [];
    }
    default:
      return getAudioTracks(api, userId, item);
  }
}

/** Writes a position and played state made offline. Jellyfin 10.9+ (POST /UserItems/{id}/UserData). */
export async function updatePlayState(
  api: Api,
  userId: string,
  itemId: string,
  state: { positionTicks: number; played: boolean; at: number },
): Promise<void> {
  await getUserDataApi(api).updateItemUserData({
    itemId,
    userId,
    updateUserItemDataDto: {
      PlaybackPositionTicks: state.played ? 0 : state.positionTicks,
      Played: state.played,
      LastPlayedDate: new Date(state.at).toISOString(),
    },
  });
}

/** True when the server answers. Never throws. */
export async function ping(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
  if (devOffline()) return false;
  try {
    const res = await axios.get(`${baseUrl.replace(/\/+$/, '')}/System/Ping`, { timeout: timeoutMs });
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    // Any HTTP answer means the server is there.
    return !!(e as { response?: unknown }).response;
  }
}
