import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { type ComponentRef, type RefObject, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { Avatar } from '@/components/avatar';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { Touchable } from '@/components/touchable';
import { registerBuiltinHomeSections } from '@/features/home/builtin-sections';
import { Billboard, BillboardRows } from '@/features/tv/billboard';
import type { FocusTarget } from '@/features/tv/focus';
import { tvDrivenScroll } from '@/features/tv/scroll';
import { type TvRowPage, TvRowScroll } from '@/features/tv/shelf';
import { mountedCut, rowsToMount } from '@/features/tv/shelf-window';
import { ProfileMenu } from '@/features/profile/profile-menu';
import { LibraryHeaderButton } from '@/features/extensions/moved-tab-tile';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { HomeTogetherSheet, homeTogether, NearbyHomeCard, TogetherHeaderButton } from '@/features/together/home-entry';
import { useRootScreenOptions } from '@/lib/stack-options';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { isTV } from '@/platform/tv';
import { homeSections } from '@/registry/home-sections';
import { createStyles, type AppTheme, sizes, spacing, tvPageEndPadding, useLayout, useStyles, useTheme } from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

registerBuiltinHomeSections();

/** TV: the Home sections mounted before any are measured. */
const FIRST_ROWS = 2;

export default function HomeScreen() {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions({ bar: true });
  const { session, scope } = useApi();
  const qc = useQueryClient();
  const sections = useSyncExternalStore(homeSections.subscribe, homeSections.list, homeSections.list);
  const [accounts, setAccounts] = useState(false);

  const pull = usePullRefresh(() => qc.invalidateQueries({ queryKey: queryKeys.all(scope) }));
  useRefreshSpinner(pull.refreshing);

  // TV: the row with the focus scrolls to the top of the list, right under the billboard.
  const tvScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const tvContent = useRef<ComponentRef<typeof View> | null>(null);
  const lastRowY = useRef(-1);
  const rows = useRef(new Set<RefObject<FocusTarget | null>>());
  const [listH, setListH] = useState(0);
  const [end, setEnd] = useState<{ rowsH: number; lastTop: number } | null>(null);
  // The sections mount as the focus comes near them (rowsToMount); once mounted they stay (kept by id).
  const [mountedIds, setMountedIds] = useState<ReadonlySet<string>>(() => new Set(sections.slice(0, FIRST_ROWS).map((sec) => sec.id)));
  const ids = useMemo(() => sections.map((sec) => sec.id), [sections]);
  const mounted = mountedCut(ids, mountedIds, FIRST_ROWS);
  const tvSizes = useRef({ contentH: 0, listH: 0 });
  const grow = useCallback(() => {
    const { contentH, listH: h } = tvSizes.current;
    setMountedIds((prev) => {
      const cut = mountedCut(ids, prev, FIRST_ROWS);
      const next = rowsToMount({ mounted: cut, total: ids.length, contentHeight: contentH, rowTop: lastRowY.current, listHeight: h });
      return next === cut ? prev : new Set([...prev, ...ids.slice(0, next)]);
    });
  }, [ids]);
  // New sections may add no height (empty rows hide): look again after they had time to lay out.
  useEffect(() => {
    if (!isTV) return;
    const t = setTimeout(grow, 120);
    return () => clearTimeout(t);
  }, [mounted, grow]);
  // The rows' height and the top of the last row size the space after it (tvPageEndPadding).
  const measureEnd = useCallback((rowsH: number) => {
    tvSizes.current.contentH = rowsH;
    grow();
    const content = tvContent.current;
    if (!content) return;
    const found = [...rows.current].map((r) => r.current).filter((v): v is FocusTarget => !!v);
    if (!found.length) return setEnd({ rowsH, lastTop: 0 });
    let lastTop = 0;
    let left = found.length;
    const done = () => {
      left -= 1;
      if (!left) setEnd({ rowsH, lastTop });
    };
    for (const row of found) {
      row.measureLayout(
        content,
        (_x, y) => {
          lastTop = Math.max(lastTop, y);
          done();
        },
        done,
      );
    }
  }, [grow]);
  // Only the last row that asks in one turn scrolls. Back to Home, Android gives the focus to the
  // first row and the page gives it back to the row it had in the same moment: scrolling for both
  // glided to the first row, and the second glide (to where the page already was) did not move it.
  const pendingRow = useRef<FocusTarget | null>(null);
  const tvPage = useMemo<TvRowPage>(
    () => ({
      scrollTo: (row) => {
        if (!row) return;
        const first = !pendingRow.current;
        pendingRow.current = row;
        if (!first) return;
        setTimeout(() => {
          const last = pendingRow.current;
          pendingRow.current = null;
          const content = tvContent.current;
          if (!last || !content) return;
          last.measureLayout(
            content,
            (_x, y) => {
              if (Math.abs(y - lastRowY.current) < 1) return;
              lastRowY.current = y;
              tvScroll.current?.scrollTo({ y, animated: true });
              grow();
            },
            () => undefined,
          );
        }, 0);
      },
      track: (row) => {
        rows.current.add(row);
        return () => {
          rows.current.delete(row);
        };
      },
    }),
    [grow],
  );

  if (isTV) {
    // Until the rows are measured: room for any row to scroll up to the top.
    const endPad = end && listH ? tvPageEndPadding(listH, end.rowsH, end.lastTop) : l.height * 0.5;
    // TV: the billboard for the focused item stays at the top; the rows scroll under it.
    return (
      <View style={s.flex}>
        <Billboard />
        <BillboardRows.Provider value>
          <TvRowScroll.Provider value={tvPage}>
            <ScrollView
              ref={tvScroll}
              {...tvDrivenScroll}
              style={s.tvRows}
              contentContainerStyle={{ paddingBottom: Math.max(bottomPad, endPad) }}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                tvSizes.current.listH = h;
                setListH(h);
                grow();
              }}>
              <View ref={tvContent} onLayout={(e) => measureEnd(e.nativeEvent.layout.height)}>
                <OfflineBanner entries />
                {sections.slice(0, mounted).map((sec) => (
                  <View key={sec.id}>
                    <sec.component />
                  </View>
                ))}
              </View>
            </ScrollView>
          </TvRowScroll.Provider>
        </BillboardRows.Provider>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Home',
          headerRight: () => (
            <View style={s.headerRow}>
              {/* Only while an extension tab takes the place of Library on this phone. */}
              <LibraryHeaderButton />
              {homeTogether ? <TogetherHeaderButton /> : null}
              <Touchable
                onPress={() => setAccounts(true)}
                onLongPress={() => router.push('/(tabs)/(home)/settings')}
                radius={sizes.avatarSmall / 2}
                accessibilityRole="button"
                accessibilityLabel="Profile menu"
                accessibilityHint="Account, Together, Downloads, Settings and more"
                hitSlop={8}>
                <Avatar session={session} size={sizes.avatarSmall} />
              </Touchable>
            </View>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={s.flex}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad }]}
        refreshControl={isTV ? undefined : <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} />}>
        <OfflineBanner entries />
        {homeTogether ? <NearbyHomeCard /> : null}
        {sections.map((sec) => (
          <View key={sec.id}>
            <sec.component />
          </View>
        ))}
      </ScrollView>
      <ProfileMenu visible={accounts} onClose={() => setAccounts(false)} />
      {homeTogether ? <HomeTogetherSheet /> : null}
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, backgroundColor: c.bg },
  // No background: the billboard art fades out behind the first row.
  tvRows: { flex: 1 },
  content: { paddingBottom: spacing.huge * 2 },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
}));
