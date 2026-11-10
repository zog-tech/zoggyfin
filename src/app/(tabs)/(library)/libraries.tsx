import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useViews } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';
import { useExtensionPageTiles } from '@/features/extensions/page-tile';
import { useMovedTabTile } from '@/features/extensions/moved-tab-tile';
import { useTabRootPlace } from '@/features/extensions/tab-nav';
import { useLiveTvTile } from '@/features/iptv/live-tv-tile';
import { isSupportedView } from '@/features/library/library-kind';
import { useRootScreenOptions } from '@/lib/stack-options';

export default function LibraryScreen() {
  const root = useRootScreenOptions();
  // In the Home stack when an extension tab takes the place of Library on this phone (lib/tab-destination.ts).
  const pushed = useTabRootPlace('(library)', 'library');
  const views = useViews();
  const libraries = useMemo(() => (views.data ?? []).filter(isSupportedView), [views.data]);
  // Live TV is one more tile in the grid (iPhone, iPad, Android): see features/iptv/placement.ts.
  const live = useLiveTvTile(libraries);
  // Then a tile per extension page that asks for one: see features/extensions/placement.ts.
  // A tab that an extension page took the place of on this phone keeps a tile here.
  const moved = useMovedTabTile(live.items, live.renderTile);
  const tiles = useExtensionPageTiles(moved.items, moved.renderTile);
  return (
    <>
      <Stack.Screen options={pushed ? { title: 'Library', headerLargeTitleEnabled: false } : { ...root, title: 'Library' }} />
      {views.isPending ? (
        <GridSkeleton shape="thumb" />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : (
        <ItemGrid
          items={tiles.items}
          renderTile={tiles.renderTile}
          shape="thumb"
          // Library folders have no item actions worth a menu.
          itemMenu={false}
          onRefresh={views.refetch}
          headerless={!pushed}
          ListEmptyComponent={<EmptyState icon="square.stack" title="No libraries" message="This account has no libraries yet." />}
        />
      )}
    </>
  );
}
