import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { useLibrary, useViews } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, FadeInAfterLoad, GridSkeleton } from '@/components/states';
import { shapeForList } from '@/components/tile';
import { FilterBar } from '@/features/library/filter-bar';
import { hasActiveFilters, useFiltersFor } from '@/features/library/filter-store';
import { gridItemTypes, libraryKind } from '@/features/library/library-kind';

export default function LibraryGridScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const views = useViews();
  const view = views.data?.find((v) => v.Id === id);
  const kind = libraryKind(view ?? {});
  const itemTypes = useMemo(() => gridItemTypes(kind), [kind]);
  const filters = useFiltersFor(id);

  // The item types come from the library's kind. Wait for the libraries list (or its
  // first failure), so a cold open does not load the grid twice with two type sets.
  const kindKnown = views.data !== undefined || views.failureCount > 0;
  const lib = useLibrary({ parentId: id, includeItemTypes: itemTypes, ...filters }, kindKnown);
  const items = useMemo(() => lib.data?.pages.flatMap((p) => p.items) ?? [], [lib.data]);

  return (
    <>
      <Stack.Screen options={{ title: view?.Name ?? name ?? 'Library' }} />
      <FadeInAfterLoad loading={lib.isPending}>
        {lib.isPending ? (
          <GridSkeleton shape={kind === 'music' ? 'square' : 'poster'} />
        ) : lib.error && !lib.data ? (
          <ErrorState error={lib.error} onRetry={lib.refetch} />
        ) : (
          <ItemGrid
            items={items}
            shape={kind === 'music' ? 'square' : shapeForList(items.slice(0, 30), 'poster')}
            onEndReached={() => {
              if (lib.hasNextPage && !lib.isFetchingNextPage) lib.fetchNextPage();
            }}
            isFetchingMore={lib.isFetchingNextPage}
            onRefresh={lib.refetch}
            ListHeaderComponent={<FilterBar libraryId={id} itemTypes={itemTypes} />}
            ListEmptyComponent={
              <EmptyState
                icon="line.3.horizontal.decrease"
                title={hasActiveFilters(filters) ? 'Nothing matches these filters' : 'This library is empty'}
                message={hasActiveFilters(filters) ? 'Clear a filter to see more.' : undefined}
              />
            }
          />
        )}
      </FadeInAfterLoad>
    </>
  );
}
