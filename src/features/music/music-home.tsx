/**
 * The Home tab of a music library: a vertical page of rows from the music
 * Home section registry (Recently played, Mixes for you, Genres and more).
 * Pull to refresh loads every row again. TV: the first row that shows takes
 * the first focus (`firstFilled`).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { ItemActionSheet } from '@/components/action-sheet';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { TvScrollView } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { isTV } from '@/platform/tv';
import { musicHomeSections } from '@/registry/music-home-sections';
import { spacing, useTheme } from '@/theme';

import { registerBuiltinMusicHomeSections } from './builtin-sections';
import { firstFilled } from './home-rules';
import { type MusicHomeRows, MusicHomeRowsContext, MusicHomeSectionId } from './home-row';

registerBuiltinMusicHomeSections();

export function MusicHome({ libraryId }: { libraryId: string }) {
  const { c } = useTheme();
  const { scope } = useApi();
  const qc = useQueryClient();
  const sections = useSyncExternalStore(musicHomeSections.subscribe, musicHomeSections.list, musicHomeSections.list);
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set());

  const pull = usePullRefresh(() =>
    Promise.all([
      // The Home rows sit under `music`; the played songs and Recently added have their own keys.
      qc.invalidateQueries({ queryKey: [...queryKeys.all(scope), 'music', libraryId] }),
      qc.invalidateQueries({ queryKey: [...queryKeys.all(scope), 'played', libraryId] }),
      qc.invalidateQueries({ queryKey: queryKeys.latest(scope, libraryId) }),
    ]),
  );
  useRefreshSpinner(pull.refreshing);

  const report = useCallback((id: string, has: boolean) => {
    setFilled((prev) => {
      if (prev.has(id) === has) return prev;
      const next = new Set(prev);
      if (has) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const first = firstFilled(
    sections.map((sec) => sec.id),
    filled,
  );
  const rows = useMemo<MusicHomeRows>(() => ({ report, first, openMenu: setMenu }), [report, first]);

  return (
    <>
      <TvScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={isTV || !pull.onRefresh ? undefined : <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} />}>
        <MusicHomeRowsContext.Provider value={rows}>
          {sections.map((sec) => (
            <MusicHomeSectionId.Provider key={sec.id} value={sec.id}>
              <View>
                <sec.component libraryId={libraryId} />
              </View>
            </MusicHomeSectionId.Provider>
          ))}
        </MusicHomeRowsContext.Provider>
      </TvScrollView>
      <ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
