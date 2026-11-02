/**
 * The Films or the Series page of a provider: a title search, Continue
 * watching, Favourites, then the provider's categories ("All" first). A
 * category opens its poster grid. TV: the first tile of Continue watching
 * (or the first category) takes the focus when the page opens.
 */
import { router, Stack } from 'expo-router';
import { type ComponentRef, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState, LoadingState } from '@/components/states';
import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import {
  ALL_CATEGORY,
  continueWatching,
  favouritesOf,
  type ProviderRecord,
  useActiveProviderId,
  useProviders,
  useVodCategories,
  useVodLists,
  useVodSearch,
  vod,
  type VodCategory,
  type VodKind,
} from '@/iptv';
import { useTvPageScroll } from '@/features/tv/page-scroll';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme, webInput } from '@/theme';

import { providerFormHref, useLiveGroup } from '../nav';
import { VodGrid } from './vod-grid';
import { vodCategoryHref } from './vod-nav';
import { openTile, VodShelf } from './vod-shelf';
import type { VodTileData } from './vod-tile';
import { tileOfFavourite, tileOfItem, tileOfPosition } from './vod-view';

const LABELS: Record<VodKind, { title: string; all: string; search: string; none: string; icon: 'film' | 'tv' }> = {
  film: { title: 'Films', all: 'All films', search: 'Search films', none: 'This provider has no films.', icon: 'film' },
  series: { title: 'Series', all: 'All series', search: 'Search series', none: 'This provider has no series.', icon: 'tv' },
};

export function VodHomeScreen({ kind, providerId: wanted }: { kind: VodKind; providerId?: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const group = useLiveGroup();
  const providers = useProviders();
  const active = useActiveProviderId();
  const provider: ProviderRecord | null = providers.find((p) => p.id === (wanted || active)) ?? null;
  const pid = provider?.id ?? null;
  const labels = LABELS[kind];
  const cats = useVodCategories(pid, kind);
  const lists = useVodLists(pid);
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 200);
  const search = useVodSearch(pid, kind, query);

  const resume = useMemo(() => continueWatching(lists, kind === 'film' ? 'film' : 'episode').map(tileOfPosition), [lists, kind]);
  const favourites = useMemo(() => favouritesOf(lists, kind).map(tileOfFavourite), [lists, kind]);
  const results = useMemo(() => search.results.map((x) => tileOfItem(kind, x)), [search.results, kind]);
  const list = useRef<ComponentRef<typeof FlatList<VodCategory>>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => list.current?.getNativeScrollRef(), []));
  const rows = useMemo<VodCategory[]>(() => (cats.data.length ? [{ id: ALL_CATEGORY, name: labels.all }, ...cats.data] : []), [cats.data, labels.all]);

  const seriesOf = useCallback((episodeId: string) => lists.positions[`episode:${episodeId}`]?.seriesId, [lists]);
  const open = useCallback((d: VodTileData) => pid && openTile(group, pid, d, seriesOf), [group, pid, seriesOf]);
  const forget = useCallback(
    (d: VodTileData) => {
      if (!pid || d.kind === 'series') return;
      vod.forget(pid, d.kind, d.id);
      toast(`${d.title} is no longer in Continue watching`, { icon: 'checkmark' });
    },
    [pid],
  );

  const title = <Stack.Screen options={{ title: labels.title }} />;
  if (!provider || !pid) {
    return (
      <>
        {title}
        <EmptyState icon={labels.icon} title="No IPTV provider" message="Add a provider in Live TV first." />
      </>
    );
  }

  const busy = cats.status === 'loading' || cats.refreshing;
  const toolbar = (
    <View style={[s.toolbar, { paddingHorizontal: l.gutter }]}>
      {isTV ? <Text style={s.tvTitle}>{labels.title}</Text> : null}
      <View style={s.field}>
        <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={labels.search}
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
          accessibilityLabel={labels.search}
          returnKeyType="search"
        />
        {text ? (
          <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
          </Touchable>
        ) : null}
      </View>
      <Touchable
        kind="icon"
        radius={radius.pill}
        disabled={busy}
        onPress={() => void vod.refresh(pid, kind)}
        accessibilityRole="button"
        accessibilityLabel={`Load the ${labels.title.toLowerCase()} again`}
        style={s.iconButton}>
        {busy ? <ActivityIndicator color={c.text2} /> : <Icon name="arrow.clockwise" size={scaled(iconSize.sm)} color={c.text} />}
      </Touchable>
    </View>
  );

  const banner = cats.error && cats.data.length ? (
    <View style={[s.banner, { marginHorizontal: l.gutter }]} accessibilityRole="alert">
      <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
      <Text style={s.bannerText} numberOfLines={3}>
        {cats.error}
      </Text>
    </View>
  ) : null;

  let body;
  if (query) {
    const loadingAll = search.status === 'loading' || search.status === 'idle';
    body = (
      <VodGrid
        items={results}
        onPress={open}
        focusFirstTile={false}
        ListEmptyComponent={
          loadingAll ? (
            <Text style={s.note}>Loading every title to search. A large catalogue can take a minute.</Text>
          ) : search.status === 'error' ? (
            <Text style={s.note}>{search.error}</Text>
          ) : (
            <Text style={s.note}>{`No titles match "${query}".`}</Text>
          )
        }
      />
    );
  } else if (cats.status === 'error' && !cats.data.length) {
    body = (
      <View style={[s.center, { paddingHorizontal: l.gutter }]} accessibilityRole="alert">
        <Icon name="wifi.exclamationmark" size={scaled(sizes.stateIcon)} color={c.text3} />
        <Text style={s.emptyTitle}>{`The ${labels.title.toLowerCase()} did not load`}</Text>
        <Text style={s.emptyText}>{cats.error}</Text>
        <View style={s.emptyActions}>
          <Button title="Try again" icon="arrow.clockwise" onPress={() => void vod.refresh(pid, kind)} preferredFocus={isTV} />
          <Button title="Edit provider" variant="tonal" onPress={() => router.push(providerFormHref(group, { id: pid }))} />
        </View>
      </View>
    );
  } else if ((cats.status === 'loading' || cats.status === 'idle') && !cats.data.length) {
    body = <LoadingState rows={8} />;
  } else {
    const columns = l.tv ? 3 : l.bp === 'compact' ? 1 : 2;
    const shelvesFirst = resume.length > 0 || favourites.length > 0;
    body = (
      <FlatList
        ref={list}
        {...tvScroll.props}
        key={columns}
        data={rows}
        numColumns={columns}
        keyExtractor={(cat) => cat.id}
        columnWrapperStyle={columns > 1 ? { gap: spacing.sm, paddingHorizontal: l.gutter } : undefined}
        contentContainerStyle={{ paddingBottom: spacing.huge * 2, paddingTop: spacing.xs }}
        // On a TV, react-native-tvos wraps a FlatList in a focus guide with no size: give it the page height.
        style={isTV ? { height: l.height } : s.flex}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <>
            {banner}
            <VodShelf title="Continue watching" items={resume} onPress={open} onLongPress={forget} firstFocus />
            <VodShelf title="Favourites" items={favourites} onPress={open} firstFocus={!resume.length} />
            <Text style={[s.section, { paddingHorizontal: l.gutter }]} accessibilityRole="header">
              Categories
            </Text>
          </>
        }
        ListEmptyComponent={<Text style={s.note}>{labels.none}</Text>}
        renderItem={({ item, index }) => (
          <Touchable
            kind="row"
            radius={radius.md}
            firstFocus={!shelvesFirst && index === 0}
            onPress={() => router.push(vodCategoryHref(group, kind, pid, item.id, item.name))}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            containerStyle={columns > 1 ? s.flex : { marginHorizontal: l.gutter }}
            style={({ pressed, hovered }) => [s.category, (pressed || hovered) && s.categoryPressed]}>
            <Text style={s.categoryLabel} numberOfLines={1}>
              {item.name}
            </Text>
            <Icon name="chevron.right" size={scaled(iconSize.sm)} color={c.text3} />
          </Touchable>
        )}
      />
    );
  }

  return (
    <>
      {title}
      <View style={s.page}>
        {toolbar}
        {body}
      </View>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, paddingVertical: spacing.huge },
  emptyTitle: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  emptyText: { ...font(type.body), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
  emptyActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, justifyContent: 'center' as const, marginTop: spacing.md },
  tvTitle: { ...font(type.largeTitle), color: c.text, marginRight: spacing.lg },
  toolbar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingTop: isTV ? spacing.xxl : spacing.sm, paddingBottom: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: scaled(sizes.webSearchHeight),
    backgroundColor: c.surface2,
    borderRadius: radius.md + 2,
    borderCurve: 'continuous' as const,
  },
  input: { ...font(type.body), ...webInput, color: c.text, flex: 1, height: '100%' as const },
  iconButton: { width: scaled(sizes.iconButton), height: scaled(sizes.iconButton), alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: radius.pill },
  banner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface2, marginBottom: spacing.sm },
  bannerText: { ...font(type.footnote), color: c.text2, flex: 1 },
  note: { ...font(type.body), color: c.text2, textAlign: 'center' as const, padding: spacing.xxl },
  section: { ...font(type.title3), color: c.text, marginBottom: spacing.sm },
  category: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    minHeight: scaled(sizes.rowMin),
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    marginBottom: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  categoryPressed: { backgroundColor: c.surface2 },
  categoryLabel: { ...font(type.body), color: c.text, flex: 1 },
}));
