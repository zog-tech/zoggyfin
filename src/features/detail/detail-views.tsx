import { type ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import { useChildren, useEpisodes, useNextUp, useSeasons, useSimilar } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemActionSheet } from '@/components/action-sheet';
import { ItemRow, RowHeader } from '@/components/item-row';
import { ErrorState, LoadingState } from '@/components/states';
import { shapeForList } from '@/components/tile';
import { episodeLabel, formatDuration } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { usePlayer } from '@/player';
import { createStyles, type AppTheme, font, spacing, type, useLayout, useStyles } from '@/theme';

import { DetailScaffold } from './detail-scaffold';
import { EpisodeRow, personToItem, TrackRow } from './rows';
import { useTrailerAction } from './trailer-action';

interface ViewProps {
  item: BaseItemDto;
  onRefresh: () => unknown;
}

function year(item: BaseItemDto): string | null {
  return item.ProductionYear ? String(item.ProductionYear) : null;
}

function rating(item: BaseItemDto): string | null {
  return item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null;
}

function genre(item: BaseItemDto): string | null {
  return item.Genres?.[0] ?? null;
}

/** Height and HDR facts from the first video stream: "4K", "1080p", "HDR10". */
function videoFacts(item: BaseItemDto): (string | null)[] {
  const v = item.MediaStreams?.find((m) => m.Type === 'Video');
  if (!v?.Height) return [];
  const h = v.Height;
  const res = (v.Width ?? 0) >= 3800 || h >= 2100 ? '4K' : h >= 1000 ? '1080p' : h >= 700 ? '720p' : `${h}p`;
  const range = v.VideoRangeType && v.VideoRangeType !== 'SDR' && v.VideoRangeType !== 'Unknown' ? String(v.VideoRangeType).replace('DOVI', 'Dolby Vision') : null;
  return [res, range];
}

/** Cast row and "More Like This". Shared by movies, shows and episodes. */
function CastAndSimilar({ item, similar = true }: { item: BaseItemDto; similar?: boolean }) {
  const cast = (item.People ?? []).filter((p) => p.Id).slice(0, 30).map(personToItem);
  const sim = useSimilar(item.Id ?? undefined, similar);
  return (
    <>
      {cast.length ? (
        <ItemRow title="Cast & crew" shape="circle" items={cast} tileSubtitle={(p) => p.Overview ?? null} />
      ) : null}
      {similar ? (
        <ItemRow title="More like this" shape={shapeForList(sim.data, 'poster')} items={sim.data} isLoading={sim.isPending} error={sim.error} onRetry={sim.refetch} />
      ) : null}
    </>
  );
}

function SectionMessage({ children }: { children: string }) {
  const styles = useStyles(makeStyles);
  const l = useLayout();
  return <Text style={[styles.message, { paddingHorizontal: l.gutter }]}>{children}</Text>;
}

function Block({ children }: { children: ReactNode }) {
  const l = useLayout();
  return <View style={{ marginTop: l.sectionGap }}>{children}</View>;
}

// ---- Movie / video -------------------------------------------------------------

export function MovieDetail({ item, onRefresh }: ViewProps) {
  const trailer = useTrailerAction(item);
  return (
    <>
      <DetailScaffold
        item={item}
        meta={[year(item), genre(item), formatDuration(item.RunTimeTicks), item.OfficialRating, ...videoFacts(item)]}
        playable
        onRefresh={onRefresh}
        extraActions={trailer.action ? [trailer.action] : undefined}
        footer={<CastAndSimilar item={item} />}
      />
      {trailer.sheet}
    </>
  );
}

// ---- Series -> seasons ---------------------------------------------------------

export function SeriesDetail({ item, onRefresh }: ViewProps) {
  const seasons = useSeasons(item.Id ?? undefined);
  const nextUp = useNextUp(item.Id ?? undefined);
  const next = nextUp.data?.[0];
  const trailer = useTrailerAction(item);
  return (
    <>
      <DetailScaffold
        item={item}
        meta={[
          year(item),
          genre(item),
          item.ChildCount ? `${item.ChildCount} season${item.ChildCount === 1 ? '' : 's'}` : null,
          item.OfficialRating,
          rating(item),
        ]}
        playable
        playLabel={next ? `${next.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'} ${episodeLabel(next) ?? ''}`.trim() : 'Play'}
        onRefresh={onRefresh}
        extraActions={trailer.action ? [trailer.action] : undefined}
        footer={
          <>
            {next ? <ItemRow title="Next up" shape="thumb" items={[next]} tileSubtitle={(e) => episodeLabel(e)} tileTitle={(e) => e.Name} /> : null}
            {seasons.error && !seasons.data ? (
              <Block>
                <RowHeader title="Seasons" />
                <ErrorState error={seasons.error} onRetry={seasons.refetch} compact />
              </Block>
            ) : (
              <ItemRow
                title="Seasons"
                shape="poster"
                items={seasons.data}
                isLoading={seasons.isPending}
                hideWhenEmpty={false}
                tileTitle={(s) => s.Name}
                tileSubtitle={(s) => (s.ChildCount ? `${s.ChildCount} episodes` : null)}
              />
            )}
            <CastAndSimilar item={item} />
          </>
        }
      />
      {trailer.sheet}
    </>
  );
}

// ---- Season -> episodes --------------------------------------------------------

export function SeasonDetail({ item, onRefresh }: ViewProps) {
  const seriesId = item.SeriesId ?? item.ParentId ?? undefined;
  const episodes = useEpisodes(seriesId, item.Id ?? undefined);
  const open = useOpenItem();
  return (
    <DetailScaffold
      item={item}
      eyebrow={item.SeriesName}
      meta={[year(item), episodes.data ? `${episodes.data.length} ${episodes.data.length === 1 ? 'episode' : 'episodes'}` : null]}
      playable
      onRefresh={() => Promise.all([onRefresh(), episodes.refetch()])}
      beforeRows={
        <Block>
          <RowHeader title="Episodes" />
          {episodes.isPending ? <LoadingState rows={4} /> : null}
          {episodes.error && !episodes.data ? <ErrorState error={episodes.error} onRetry={episodes.refetch} compact /> : null}
          {episodes.data && episodes.data.length === 0 ? <SectionMessage>No episodes in this season.</SectionMessage> : null}
        </Block>
      }
      rows={episodes.data}
      rowKey={(e, i) => e.Id ?? String(i)}
      renderRow={(e) => <EpisodeRow item={e} onPress={open} />}
    />
  );
}

// ---- Episode ---------------------------------------------------------------------

export function EpisodeDetail({ item, onRefresh }: ViewProps) {
  const seriesId = item.SeriesId ?? undefined;
  const episodes = useEpisodes(seriesId, item.SeasonId ?? undefined);
  const others = episodes.data?.filter((e) => e.Id !== item.Id);
  return (
    <DetailScaffold
      item={item}
      eyebrow={[item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ')}
      meta={[item.PremiereDate ? new Date(item.PremiereDate).getFullYear().toString() : null, formatDuration(item.RunTimeTicks), item.OfficialRating, ...videoFacts(item)]}
      playable
      onRefresh={onRefresh}
      footer={
        <>
          {others?.length ? (
            <ItemRow
              title={item.SeasonName ?? 'More episodes'}
              shape="thumb"
              items={others}
              tileTitle={(e) => e.Name}
              tileSubtitle={(e) => episodeLabel(e)}
            />
          ) : null}
          <CastAndSimilar item={item} similar={false} />
        </>
      }
    />
  );
}

// ---- Album / playlist -> tracks -------------------------------------------------

function TrackListDetail({ item, onRefresh, kind }: ViewProps & { kind: 'tracks' | 'playlist' }) {
  const tracks = useChildren(item.Id ?? undefined, kind);
  const player = usePlayer();
  const open = useOpenItem();
  const styles = useStyles(makeStyles);
  const l = useLayout();
  const list = tracks.data ?? [];
  const totalTicks = list.reduce((sum, t) => sum + (t.RunTimeTicks ?? 0), 0);
  const isPlaylist = kind === 'playlist';
  const multiDisc = !isPlaylist && new Set(list.map((t) => t.ParentIndexNumber ?? 1)).size > 1;
  const artistId = item.AlbumArtists?.[0]?.Id;
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);

  return (
    <DetailScaffold
      item={item}
      eyebrow={isPlaylist ? null : item.AlbumArtist ?? item.AlbumArtists?.[0]?.Name}
      onEyebrowPress={artistId ? () => open({ Id: artistId, Type: 'MusicArtist', Name: item.AlbumArtists?.[0]?.Name }) : undefined}
      meta={[
        isPlaylist ? 'Playlist' : 'Album',
        year(item),
        list.length ? `${list.length} ${isPlaylist ? (list.length === 1 ? 'item' : 'items') : list.length === 1 ? 'song' : 'songs'}` : null,
        formatDuration(totalTicks),
      ]}
      playable
      onShuffle={() => player.play({ item, shuffle: true })}
      onRefresh={() => Promise.all([onRefresh(), tracks.refetch()])}
      footer={<ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />}
      beforeRows={
        <View style={{ marginTop: spacing.xl }}>
          {tracks.isPending ? <LoadingState rows={6} /> : null}
          {tracks.error && !tracks.data ? <ErrorState error={tracks.error} onRetry={tracks.refetch} compact /> : null}
          {tracks.data && list.length === 0 ? <SectionMessage>Nothing here yet.</SectionMessage> : null}
        </View>
      }
      rows={list}
      rowKey={(t, i) => t.PlaylistItemId ?? t.Id ?? String(i)}
      renderRow={(t, i) => (
        <>
          {multiDisc && (i === 0 || list[i - 1]?.ParentIndexNumber !== t.ParentIndexNumber) ? (
            <Text style={[styles.disc, { paddingHorizontal: l.gutter }]}>DISC {t.ParentIndexNumber ?? 1}</Text>
          ) : null}
          <TrackRow
            item={t}
            index={i}
            showArt={isPlaylist}
            last={i === list.length - 1}
            onPress={(song) => player.play({ item: song, list, index: i, context: item })}
            onLongPress={setMenu}
          />
        </>
      )}
    />
  );
}

export function AlbumDetail(props: ViewProps) {
  return <TrackListDetail {...props} kind="tracks" />;
}

export { PlaylistDetail } from './playlist-detail';

// ---- Artist ------------------------------------------------------------------------

export function ArtistDetail({ item, onRefresh }: ViewProps) {
  const albums = useChildren(item.Id ?? undefined, 'artistAlbums');
  const songs = useChildren(item.Id ?? undefined, 'artistSongs');
  const player = usePlayer();
  const songList = songs.data ?? [];
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);
  return (
    <DetailScaffold
      item={item}
      meta={['Artist', albums.data ? `${albums.data.length} ${albums.data.length === 1 ? 'album' : 'albums'}` : null]}
      playable
      onShuffle={() => player.play({ item, shuffle: true })}
      extraActions={[{ icon: 'wand.and.stars', label: 'Instant mix', onPress: () => player.instantMix(item) }]}
      footer={<ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />}
      onRefresh={onRefresh}
      beforeRows={
        <>
          <ItemRow title="Albums" shape="square" items={albums.data} isLoading={albums.isPending} error={albums.error} onRetry={albums.refetch} />
          {songList.length || songs.isPending || songs.error ? (
            <Block>
              <RowHeader title="Top songs" />
              {songs.isPending ? <LoadingState rows={5} /> : null}
              {songs.error && !songs.data ? <ErrorState error={songs.error} onRetry={songs.refetch} compact /> : null}
            </Block>
          ) : null}
        </>
      }
      rows={songList}
      rowKey={(t, i) => t.Id ?? String(i)}
      renderRow={(t, i) => (
        <TrackRow
          item={t}
          index={i}
          showArt
          last={i === songList.length - 1}
          onPress={() => player.play({ item: t, list: songList, index: i, context: item })}
          onLongPress={setMenu}
        />
      )}
    />
  );
}

// ---- Person ------------------------------------------------------------------------

export function PersonDetail({ item, onRefresh }: ViewProps) {
  const titles = useChildren(item.Id ?? undefined, 'personItems');
  const movies = titles.data?.filter((t) => t.Type === 'Movie');
  const shows = titles.data?.filter((t) => t.Type === 'Series');
  const born = item.PremiereDate ? new Date(item.PremiereDate).getFullYear() : null;
  return (
    <DetailScaffold
      item={item}
      meta={[born ? `Born ${born}` : null, titles.data ? `${titles.data.length} ${titles.data.length === 1 ? 'title' : 'titles'}` : null]}
      onRefresh={onRefresh}
      footer={
        titles.error && !titles.data ? (
          <Block>
            <ErrorState error={titles.error} onRetry={titles.refetch} compact />
          </Block>
        ) : (
          <>
            <ItemRow title="Movies" shape="poster" items={movies} isLoading={titles.isPending} />
            <ItemRow title="Shows" shape="poster" items={shows} isLoading={titles.isPending} />
            {titles.data && titles.data.length === 0 ? <SectionMessage>No titles in your libraries.</SectionMessage> : null}
          </>
        )
      }
    />
  );
}

// ---- Collection (BoxSet) and folders ------------------------------------------------

export function CollectionDetail({ item, onRefresh }: ViewProps) {
  const children = useChildren(item.Id ?? undefined, 'items');
  return (
    <DetailScaffold
      item={item}
      eyebrow={item.Type === 'BoxSet' ? 'Collection' : undefined}
      meta={[children.data ? `${children.data.length} ${children.data.length === 1 ? 'item' : 'items'}` : null]}
      playable={item.Type === 'BoxSet'}
      onRefresh={onRefresh}
      footer={
        children.error && !children.data ? (
          <Block>
            <ErrorState error={children.error} onRetry={children.refetch} compact />
          </Block>
        ) : (
          <ItemRow title="Items" shape={shapeForList(children.data, 'poster')} items={children.data} isLoading={children.isPending} hideWhenEmpty={false} />
        )
      }
    />
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  message: { ...font(type.subheadline), color: c.text2, marginTop: spacing.md },
  disc: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2, marginTop: spacing.lg, marginBottom: spacing.xs },
}));
