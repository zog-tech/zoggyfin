import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useGenreItems, useLibrary } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { Button } from '@/components/button';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, FadeInAfterLoad, GridSkeleton } from '@/components/states';
import { usePlayer } from '@/player';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { spacing, u, useLayout } from '@/theme';

/** TV Modern (design system §7.22): the page title over the grid; Play is the primary action, the others text actions. */
const MODERN = isTV && isTvModern;

/** A genre. `kind=video`: its movies and shows in every library. Else a music genre. */
export default function GenreScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  return kind === 'video' ? <VideoGenre /> : <MusicGenre />;
}

const VIDEO_TYPES = ['Movie', 'Series'] as const;

/** Movies and shows of the genre, A to Z, a page at a time. */
function VideoGenre() {
  const { name } = useLocalSearchParams<{ id: string; name?: string }>();
  const genres = useMemo(() => (name ? [name] : []), [name]);
  const lib = useLibrary({
    parentId: '',
    includeItemTypes: VIDEO_TYPES,
    sortBy: 'SortName',
    sortOrder: 'Ascending',
    played: 'all',
    favorites: false,
    genres,
    years: [],
  });
  const items = useMemo(() => lib.data?.pages.flatMap((p) => p.items) ?? [], [lib.data]);
  return (
    <>
      <Stack.Screen options={{ title: name || 'Genre' }} />
      <FadeInAfterLoad loading={lib.isPending}>
        {lib.isPending ? (
          <GridSkeleton shape="poster" title={name || 'Genre'} />
        ) : lib.error && !lib.data ? (
          <ErrorState error={lib.error} onRetry={lib.refetch} />
        ) : (
          <ItemGrid
            items={items}
            shape="poster"
            onEndReached={() => {
              if (lib.hasNextPage && !lib.isFetchingNextPage) lib.fetchNextPage();
            }}
            isFetchingMore={lib.isFetchingNextPage}
            onRefresh={lib.refetch}
            title={name || 'Genre'}
            ListEmptyComponent={<EmptyState icon="theatermasks" title="No movies or shows in this genre" />}
          />
        )}
      </FadeInAfterLoad>
    </>
  );
}

/** A music genre: Play, Shuffle and Instant mix, then its albums. */
function MusicGenre() {
  const { id, name, libraryId } = useLocalSearchParams<{ id: string; name?: string; libraryId?: string }>();
  const q = useGenreItems(libraryId, id);
  const player = usePlayer();
  const l = useLayout();
  const genre: BaseItemDto = { Id: id, Name: name, Type: 'MusicGenre' };
  const header = MODERN ? (
    <View style={styles.actionsModern}>
      <Button title="Play" icon="play.fill" variant="primary" onPress={() => player.play({ item: genre })} />
      <Button title="Shuffle" icon="shuffle" variant="text" onPress={() => player.play({ item: genre, shuffle: true })} />
      <Button title="Mix" icon="wand.and.stars" variant="text" onPress={() => player.instantMix(genre)} accessibilityLabel="Instant mix" />
    </View>
  ) : (
    <View style={[styles.actions, l.fontScale >= 1.5 && styles.stack]}>
      <Button title="Play" icon="play.fill" variant="tonalAccent" onPress={() => player.play({ item: genre })} containerStyle={styles.flex} />
      <Button title="Shuffle" icon="shuffle" variant="tonalAccent" onPress={() => player.play({ item: genre, shuffle: true })} containerStyle={styles.flex} />
      <Button title="Mix" icon="wand.and.stars" variant="tonalAccent" onPress={() => player.instantMix(genre)} containerStyle={styles.flex} accessibilityLabel="Instant mix" />
    </View>
  );
  return (
    <>
      <Stack.Screen options={{ title: name || 'Genre' }} />
      <FadeInAfterLoad loading={q.isPending}>
        {q.isPending ? (
          <GridSkeleton shape="square" title={name || 'Genre'} />
        ) : q.error && !q.data ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : (
          <ItemGrid
            items={q.data ?? []}
            shape="square"
            onRefresh={q.refetch}
            title={name || 'Genre'}
            ListHeaderComponent={q.data?.length ? header : null}
            ListEmptyComponent={<EmptyState icon="music.note" title="No albums in this genre" />}
          />
        )}
      </FadeInAfterLoad>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  stack: { flexDirection: 'column' },
  // One row; the text actions follow the primary one with 24 u (redesign §2.3).
  actionsModern: { flexDirection: 'row', alignItems: 'center', gap: u(24), marginBottom: u(28) },
});
