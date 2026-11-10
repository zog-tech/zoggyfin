import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { MusicHome } from '@/features/music/music-home';
import { musicGenreHref, useOpenItem, useTabGroup } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { usePlayer } from '@/player';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';
import { spacing, useLayout, useTheme } from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

export type AudioLibraryKind = 'music' | 'books';

/** A pager tab: a music tab, or the music Home page. */
type BrowserTab = MusicTab | 'home';

const MUSIC_TABS: (PagerTab & { key: BrowserTab })[] = [
  { key: 'home', title: 'Home' },
  { key: 'albums', title: 'Albums' },
  { key: 'artists', title: 'Artists' },
  { key: 'playlists', title: 'Playlists' },
  { key: 'songs', title: 'Songs' },
  { key: 'genres', title: 'Genres' },
];

const BOOK_TABS: (PagerTab & { key: BrowserTab })[] = [
  { key: 'audiobooks', title: 'Audiobooks' },
  { key: 'authors', title: 'Authors' },
];

const EMPTY: Record<MusicTab, string> = {
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
  albums: [NAME, { value: 'AlbumArtist', label: 'Artist' }, { value: 'ProductionYear', label: 'Year' }, ADDED, PLAYED, COUNT, RANDOM],
  artists: [NAME, ADDED],
  playlists: [NAME, ADDED],
  songs: [NAME, { value: 'Album', label: 'Album' }, { value: 'Artist', label: 'Artist' }, ADDED, PLAYED, COUNT, RANDOM],
  genres: [NAME],
  audiobooks: [NAME, ADDED, PLAYED],
  authors: [NAME],
};


/**
 * Home / Albums / Artists / Playlists / Songs / Genres (or Audiobooks /
 * Authors), as a pager that follows a horizontal swipe. The saved tab opens
 * first; with none saved, the first tab (Home for music).
 */
export function MusicBrowser({ libraryId, kind = 'music' }: { libraryId: string; kind?: AudioLibraryKind }) {
  const tabs = kind === 'books' ? BOOK_TABS : MUSIC_TABS;
  const lastKey = `music.tab.${libraryId}`;
  const initial = Math.max(0, tabs.findIndex((t) => t.key === storage.getString(lastKey)));
  return (
    <TabPager
      tabs={tabs}
      initialIndex={initial}
      onIndexChange={(i) => storage.set(lastKey, tabs[i]?.key ?? tabs[0]?.key ?? 'home')}
      renderPage={(tab) =>
        tab.key === 'home' ? <MusicHome libraryId={libraryId} /> : <MusicPage libraryId={libraryId} tab={tab.key as MusicTab} />
      }
    />
  );
}

function useMusicOptions(libraryId: string, tab: MusicTab): [MusicOptions, (patch: Partial<MusicOptions>) => void] {
  const key = `music.options.${libraryId}.${tab}`;
  const [options, setOptions] = useState<MusicOptions>(() => ({ ...DEFAULT_MUSIC_OPTIONS, ...readJson<Partial<MusicOptions>>(key, {}) }));
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
        {tab !== 'genres' ? <Chip label="Favourites" selected={options.favorites} onPress={() => onChange({ favorites: !options.favorites })} /> : null}
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

  if (q.isPending) {
    return (
      <View style={styles.flex}>
        {bar}
        {tab === 'songs' || tab === 'artists' || tab === 'authors' ? <LoadingState /> : <GridSkeleton shape="square" />}
      </View>
    );
  }
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const empty = <EmptyState icon="music.note" title={EMPTY[tab]} message={options.favorites ? 'No favourites here yet.' : undefined} />;

  if (tab === 'songs' || tab === 'artists' || tab === 'authors') {
    return (
      <>
        <FlashList
          ref={list}
          {...tvScroll.props}
          data={items}
          keyExtractor={(it, i) => it.Id ?? String(i)}
          renderItem={({ item, index }) =>
            tab === 'songs' ? (
              <TrackRow
                item={item}
                index={index}
                showArt
                last={index === items.length - 1}
                onPress={() => player.play({ item, list: items, index })}
                onLongPress={setMenu}
                queue="both"
              />
            ) : (
              <ArtistRow item={item} last={index === items.length - 1} onPress={open} onLongPress={l.tv ? undefined : setMenu} />
            )
          }
          ListHeaderComponent={bar}
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { gap: spacing.sm, paddingVertical: spacing.sm },
});
