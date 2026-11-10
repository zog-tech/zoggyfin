import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useViews } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';
import { useLiveTvTile } from '@/features/iptv/live-tv-tile';
import { isSupportedView } from '@/features/library/library-kind';
import { useRootScreenOptions } from '@/lib/stack-options';

export default function LibraryScreen() {
  const root = useRootScreenOptions();
  const views = useViews();
  const libraries = useMemo(() => (views.data ?? []).filter(isSupportedView), [views.data]);
  // Live TV is one more tile in the grid (iPhone, iPad, Android): see features/iptv/placement.ts.
  const live = useLiveTvTile(libraries);
  return (
    <>
      <Stack.Screen options={{ ...root, title: 'Library' }} />
      {views.isPending ? (
        <GridSkeleton shape="thumb" />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : (
        <ItemGrid
          items={live.items}
          renderTile={live.renderTile}
          shape="thumb"
          // Library folders have no item actions worth a menu.
          itemMenu={false}
          onRefresh={views.refetch}
          headerless
          ListEmptyComponent={<EmptyState icon="square.stack" title="No libraries" message="This account has no libraries yet." />}
        />
      )}
    </>
  );
}
