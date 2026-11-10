/**
 * The poster grid of one film or series category (or "All"), in the
 * provider's order. The titles load when the page opens, from the saved file
 * first. TV: the first poster takes the focus.
 */
import { Stack } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { PlainGrid } from '@/components/plain-grid';
import { EmptyState, GridSkeleton } from '@/components/states';
import { ALL_CATEGORY, playedFractionOf, positionOf, useActiveProviderId, useVodCategory, useVodLists, vod, type VodKind } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, spacing, type, useLayout, useStyles } from '@/theme';

import { useLiveGroup } from '../nav';
import { openTile } from './vod-nav';
import { tileOfItem, type VodTileData } from './vod-view';

export function VodCategoryScreen({ kind, providerId: wanted, categoryId, name }: { kind: VodKind; providerId?: string; categoryId: string; name?: string }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const group = useLiveGroup();
  const active = useActiveProviderId();
  const pid = wanted || active;
  const list = useVodCategory(pid, kind, categoryId);
  const lists = useVodLists(pid);
  const tiles = useMemo(
    () => list.data.map((x) => tileOfItem(kind, x, kind === 'film' ? playedFractionOf(positionOf(lists, 'film', x.id)) : null)),
    [list.data, kind, lists],
  );
  const open = useCallback((d: VodTileData) => pid && openTile(group, pid, d), [group, pid]);
  const title = name || (categoryId === ALL_CATEGORY ? (kind === 'film' ? 'All films' : 'All series') : kind === 'film' ? 'Films' : 'Series');

  let body;
  if (list.status === 'error' && !list.data.length) {
    body = (
      <View style={s.center} accessibilityRole="alert">
        <Text style={s.title2}>This category did not load</Text>
        <Text style={s.text}>{list.error}</Text>
        {pid ? <Button title="Try again" icon="arrow.clockwise" onPress={() => void vod.refresh(pid, kind)} preferredFocus={isTV} /> : null}
      </View>
    );
  } else if (!list.data.length && (list.status === 'loading' || list.status === 'idle')) {
    body = <GridSkeleton shape="poster" />;
  } else {
    body = (
      <PlainGrid
        items={tiles}
        onPress={open}
        ListHeaderComponent={
          isTV || list.error ? (
            <View style={s.header}>
              {isTV ? <Text style={s.tvTitle}>{title}</Text> : null}
              {list.error ? <Text style={s.text}>{list.error}</Text> : null}
            </View>
          ) : null
        }
        ListEmptyComponent={<EmptyState icon={kind === 'film' ? 'film' : 'tv'} title="Nothing here yet" message="This category is empty at the provider." />}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={[s.page, { paddingTop: l.tv ? spacing.xl : 0 }]}>{body}</View>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, padding: spacing.xxl },
  title2: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  text: { ...font(type.body), color: c.text2, textAlign: 'center' as const },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  tvTitle: { ...font(type.largeTitle), color: c.text },
}));
