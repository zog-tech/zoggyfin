import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { DEFAULT_MUSIC_OPTIONS, type MusicOptions, type MusicTab } from '@/api/jellyfin';
import { useMusicTab } from '@/api/queries';
import type { BaseItemDto, ItemSortBy } from '@/api/types';
import { ItemActionSheet } from '@/components/action-sheet';
import { Chip, chipRowTV } from '@/components/chip';
import { ItemGrid } from '@/components/item-grid';
import { OptionSheet } from '@/components/option-sheet';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { EmptyState, ErrorState, GridSkeleton, LoadingState } from '@/components/states';
import { TabPager } from '@/components/tab-pager';
import type { PagerTab } from '@/components/tab-pager-types';
import { ArtistRow, TrackRow } from '@/features/detail/rows';
import { flashScroll, useTvPageScroll } from '@/features/tv/page-scroll';
import { DownloadedSongs } from '@/features/music/downloaded-songs';
import { MusicHome } from '@/features/music/music-home';
import { SongListHeader } from '@/features/music/song-list-header';
import { musicGenreHref, useOpenItem, useTabGroup } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { usePlayer } from '@/player';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';
import { spacing, useLayout, useTheme } from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

export type AudioLibraryKind = 'music' | 'books';

/** A pager tab: a music tab, the music Home page, or the songs on the device. */
type BrowserTab = MusicTab | 'home' | 'downloaded';

const MUSIC_TABS: (PagerTab & { key: BrowserTab })[] = [
  { key: 'home', title: 'Home' },
  { key: 'liked', title: 'Liked Songs' },
  { key: 'albums', title: 'Albums' },
  { key: 'artists', title: 'Artists' },
  { key: 'playlists', title: 'Playlists' },
  { key: 'songs', title: 'Songs' },
  { key: 'genres', title: 'Genres' },
  // Last: it is about this device, not the library.
  { key: 'downloaded', title: 'Downloaded' },
];

const BOOK_TABS: (PagerTab & { key: BrowserTab })[] = [
  { key: 'audiobooks', title: 'Audiobooks' },
  { key: 'authors', title: 'Authors' },
];

const EMPTY: Record<MusicTab, string> = {
  liked: 'No liked songs yet',
  albums: 'No albums',
  artists: 'No artists',
  playlists: 'No playlists yet',
  songs: 'No songs',
  genres: 'No genres',
  audiobooks: 'No audiobooks',
  authors: 'No authors',
};

type SortChoice = { value: ItemSortBy; label: string };

const NAME: SortChoice = { value: 'SortName', label: 'Name' };
const ADDED: SortChoice = { value: 'DateCreated', label: 'Date added' };
const PLAYED: SortChoice = { value: 'DatePlayed', label: 'Recently played' };
const COUNT: SortChoice = { value: 'PlayCount', label: 'Play count' };
const RANDOM: SortChoice = { value: 'Random', label: 'Random' };

const SORTS: Record<MusicTab, SortChoice[]> = {
  liked: [ADDED, NAME, { value: 'Album', label: 'Album' }, { value: 'Artist', label: 'Artist' }, PLAYED, COUNT, RANDOM],
  albums: [NAME, { value: 'AlbumArtist', label: 'Artist' }, { value: 'ProductionYear', label: 'Year' }, ADDED, PLAYED, COUNT, RANDOM],
  artists: [NAME, ADDED],
  playlists: [NAME, ADDED],
  songs: [NAME, { value: 'Album', label: 'Album' }, { value: 'Artist', label: 'Artist' }, ADDED, PLAYED, COUNT, RANDOM],
  genres: [NAME],
  audiobooks: [NAME, ADDED, PLAYED],
  authors: [NAME],
};


/**
 * Home / Liked Songs / Albums / Artists / Playlists / Songs / Genres /
 * Downloaded (or Audiobooks / Authors), as a pager that follows a horizontal
 * swipe. The saved tab opens first; with none saved, the first tab (Home for
 * music). A memo: the Music tab's screen renders on every navigation (its
 * header options follow the route), and the whole browser rendering with it
 * cost a TV stick 370 ms.
 */
export const MusicBrowser = memo(function MusicBrowser({ libraryId, kind = 'music' }: { libraryId: string; kind?: AudioLibraryKind }) {
  const tabs = kind === 'books' ? BOOK_TABS : MUSIC_TABS;
  const lastKey = `music.tab.${libraryId}`;
  const initial = Math.max(0, tabs.findIndex((t) => t.key === storage.getString(lastKey)));
  return (
    <TabPager
      tabs={tabs}
      initialIndex={initial}
      onIndexChange={(i) => storage.set(lastKey, tabs[i]?.key ?? tabs[0]?.key ?? 'home')}
      renderPage={(tab) =>
        tab.key === 'home' ? (
          <MusicHome libraryId={libraryId} />
        ) : tab.key === 'downloaded' ? (
          <DownloadedSongs />
        ) : (
          <MusicPage libraryId={libraryId} tab={tab.key as MusicTab} />
        )
      }
    />
  );
});

/**
 * Liked Songs opens with the newest songs first, like the liked list of other
 * music apps. Jellyfin keeps no date for a like, so the date the song was
 * added to the library stands in for it.
 */
const TAB_DEFAULTS: Partial<Record<MusicTab, Partial<MusicOptions>>> = {
  liked: { sortBy: 'DateCreated', sortOrder: 'Descending' },
};

function useMusicOptions(libraryId: string, tab: MusicTab): [MusicOptions, (patch: Partial<MusicOptions>) => void] {
  const key = `music.options.${libraryId}.${tab}`;
  const [options, setOptions] = useState<MusicOptions>(() => ({ ...DEFAULT_MUSIC_OPTIONS, ...TAB_DEFAULTS[tab], ...readJson<Partial<MusicOptions>>(key, {}) }));
  const update = (patch: Partial<MusicOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    writeJson(key, next);
  };
  return [options, update];
}

/** Sort and filter chips for one music tab. */
function SortBar({ tab, options, onChange }: { tab: MusicTab; options: MusicOptions; onChange: (patch: Partial<MusicOptions>) => void }) {
  const l = useLayout();
  const [open, setOpen] = useState(false);
  const sorts = SORTS[tab];
  const label = sorts.find((s) => s.value === options.sortBy)?.label ?? 'Name';
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.bar, { paddingHorizontal: l.gutter }, chipRowTV()]}>
        {sorts.length > 1 ? (
          <Chip label={label} icon="arrow.up.arrow.down" onPress={() => setOpen(true)} accessibilityLabel={`Sort by ${label}`} />
        ) : null}
        {options.sortBy !== 'Random' ? (
          <Chip
            label={options.sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
            onPress={() => onChange({ sortOrder: options.sortOrder === 'Ascending' ? 'Descending' : 'Ascending' })}
          />
        ) : null}
        {/* Songs leave it out: the Liked Songs tab is that list. */}
        {tab !== 'genres' && tab !== 'liked' && tab !== 'songs' ? <Chip label="Liked" icon="heart" selected={options.favorites} onPress={() => onChange({ favorites: !options.favorites })} /> : null}
      </ScrollView>
      <OptionSheet
        visible={open}
        title="Sort by"
        options={sorts}
        selected={[options.sortBy]}
        onSelect={(v) => onChange({ sortBy: v, sortOrder: v === 'DateCreated' || v === 'DatePlayed' || v === 'PlayCount' ? 'Descending' : 'Ascending' })}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function MusicPage({ libraryId, tab }: { libraryId: string; tab: MusicTab }) {
  const [options, setOptions] = useMusicOptions(libraryId, tab);
  const q = useMusicTab(libraryId, tab, options);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const group = useTabGroup();
  const player = usePlayer();
  const open = useOpenItem();
  const pull = usePullRefresh(q.refetch);
  useRefreshSpinner(pull.refreshing);
  const { c } = useTheme();
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);
  const l = useLayout();
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const list = useRef<FlashListRef<BaseItemDto>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => flashScroll(list.current?.getNativeScrollRef()), []));
  const more = () => {
    if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  };

  const bar = <SortBar tab={tab} options={options} onChange={setOptions} />;
  const rows = tab === 'songs' || tab === 'liked' || tab === 'artists' || tab === 'authors';

  if (q.isPending) {
    return (
      <View style={styles.flex}>
        {bar}
        {rows ? <LoadingState /> : <GridSkeleton shape="square" />}
      </View>
    );
  }
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const empty =
    tab === 'liked' ? (
      <EmptyState icon="heart" title={EMPTY.liked} message="Tap the heart on a song to see it here." />
    ) : (
      <EmptyState icon="music.note" title={EMPTY[tab]} message={options.favorites ? 'Nothing liked here yet.' : undefined} />
    );
  const total = q.data?.pages[0]?.total ?? items.length;
  const header =
    tab === 'liked' && items.length ? (
      <>
        <SongListHeader count={total} songs={() => allPages(q)} context={LIKED_CONTEXT} />
        {bar}
      </>
    ) : (
      bar
    );

  if (rows) {
    return (
      <>
        <FlashList
          ref={list}
          {...tvScroll.props}
          data={items}
          keyExtractor={(it, i) => it.Id ?? String(i)}
          renderItem={({ item, index }) =>
            tab === 'songs' || tab === 'liked' ? (
              <TrackRow
                item={item}
                index={index}
                showArt
                last={index === items.length - 1}
                onPress={() => player.play({ item, list: items, index, context: tab === 'liked' ? LIKED_CONTEXT : undefined })}
                onLongPress={setMenu}
                queue="both"
              />
            ) : (
              <ArtistRow item={item} last={index === items.length - 1} onPress={open} onLongPress={l.tv ? undefined : setMenu} />
            )
          }
          ListHeaderComponent={header}
          onEndReached={more}
          onEndReachedThreshold={0.8}
          refreshControl={pull.onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} /> : undefined}
          ListEmptyComponent={empty}
          contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: spacing.sm }}
        />
        <ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />
      </>
    );
  }

  return (
    <ItemGrid
      items={items}
      shape="square"
      autoInset={false}
      onEndReached={more}
      isFetchingMore={q.isFetchingNextPage}
      onRefresh={q.refetch}
      // The grid has its own side padding; the chips and rows bring theirs.
      ListHeaderComponent={<View style={{ marginHorizontal: -l.gutter, marginTop: -spacing.lg }}>{bar}</View>}
      ListEmptyComponent={empty}
      focusFirstTile
      onPress={tab === 'genres' ? (g) => router.push(musicGenreHref(group, g, libraryId)) : undefined}
      itemMenu={tab !== 'genres'}
    />
  );
}

const LIKED_CONTEXT: BaseItemDto = { Name: 'Liked Songs' };

/** Most songs Play and Shuffle load for one queue (100 pages of the music page size). */
const MAX_PAGES = 100;

/** Loads the pages that are not loaded yet, then gives every song of the list. */
async function allPages(q: ReturnType<typeof useMusicTab>): Promise<BaseItemDto[]> {
  let data = q.data;
  let hasNext = q.hasNextPage;
  for (let i = 0; hasNext && i < MAX_PAGES; i++) {
    const res = await q.fetchNextPage();
    if (res.isError) break;
    data = res.data;
    hasNext = res.hasNextPage;
  }
  return data?.pages.flatMap((p) => p.items) ?? [];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { gap: spacing.sm, paddingVertical: spacing.sm },
});
