/**
 * An extension page: its title, an optional search field, then its
 * sections in order (`section-view.ts` says how each renders). While a
 * search runs, its results replace the sections. With `sectionId` the
 * screen shows that one section on its own ("See all").
 *
 * A section that fails shows a short note and never blocks the page. Pull
 * to refresh loads every feed of the extension again. TV: the first tile of
 * the first section takes the first focus.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { type ReactElement, useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/use-api';
import { Icon } from '@/components/icon';
import { refreshTint, useRefreshSpinner } from '@/components/refresh-spinner';
import { EmptyState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { extensionFeedsKey } from '@/extensions/feeds';
import type { SectionSpec, Shape } from '@/extensions/schema';
import { useExtensions } from '@/extensions/store';
import { useFeedSearch, useFeedSection } from '@/extensions/ui/use-feed';
import { TvScrollView } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme, webInput } from '@/theme';

import { pageHref, useExtGroup } from './nav';
import { resolvePageRoute } from './routes';
import { InfiniteEntries, SectionBlock } from './sections';
import { sectionMode } from './section-view';

export function PageScreen({ extId, pageId, sectionId }: { extId: string; pageId: string; sectionId?: string }) {
  const s = useStyles(makeStyles);
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === extId));
  const route = resolvePageRoute(ext?.manifest, { page: pageId, section: sectionId });
  const title = route ? (route.section?.title ?? route.page.title) : 'Extension';
  const head = <Stack.Screen options={{ title }} />;

  if (!ext) {
    return (
      <>
        {head}
        <EmptyState icon="square.grid.2x2" title="This extension is not installed" message="Add it again in Settings, Extensions." />
      </>
    );
  }
  if (!ext.enabled) {
    return (
      <>
        {head}
        <EmptyState icon="square.grid.2x2" title={`${ext.manifest.name} is turned off`} message="Turn it on in Settings, Extensions." />
      </>
    );
  }
  if (!route) {
    return (
      <>
        {head}
        <EmptyState icon="square.grid.2x2" title="This page is not available" message={`${ext.manifest.name} no longer has this page.`} />
      </>
    );
  }
  return (
    <>
      {head}
      <View style={s.page}>
        <PageBody extId={extId} extensionName={ext.manifest.name} pageId={route.page.id} title={title} sections={route.sections} search={route.section ? undefined : route.page.search} standalone={!!route.section} />
      </View>
    </>
  );
}

function PageBody({
  extId,
  extensionName,
  pageId,
  title,
  sections,
  search,
  standalone,
}: {
  extId: string;
  extensionName: string;
  pageId: string;
  title: string;
  sections: SectionSpec[];
  search?: { feed: string; placeholder?: string };
  standalone: boolean;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const group = useExtGroup();
  const qc = useQueryClient();
  const { scope } = useApi();
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const [text, setText] = useState('');
  const results = useFeedSearch(search ? { extId, feed: search.feed } : undefined, text);

  const refresh = useCallback(() => qc.refetchQueries({ queryKey: extensionFeedsKey(scope, extId), type: 'active' }), [qc, scope, extId]);
  const pull = usePullRefresh(refresh);
  useRefreshSpinner(pull.refreshing);
  const refreshControl = !isTV && pull.onRefresh ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={refreshTint(c.text2)} /> : undefined;

  const last = sections.length - 1;
  const lastInfinite = sectionMode(sections, last) === 'infinite';
  const blocks = sections.map((sec, i) => {
    if (i === last && lastInfinite) return null;
    const mode = sectionMode(sections, i);
    if (mode === 'infinite') return null;
    return (
      <SectionBlock
        key={sec.id}
        extId={extId}
        extensionName={extensionName}
        section={sec}
        mode={mode}
        where="page"
        firstFocus={i === 0}
        onSeeAll={mode === 'preview' ? () => router.push(pageHref(group, extId, pageId, sec.id)) : undefined}
      />
    );
  });

  const toolbar =
    search || isTV ? (
      <View style={[s.toolbar, { paddingHorizontal: l.gutter }]}>
        {isTV ? <Text style={s.tvTitle}>{title}</Text> : null}
        {search ? (
          <View style={s.field}>
            <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={search.placeholder ?? `Search ${extensionName}`}
              placeholderTextColor={c.text3}
              selectionColor={c.accent}
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
              accessibilityLabel={search.placeholder ?? `Search ${extensionName}`}
              returnKeyType="search"
            />
            {text ? (
              <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
              </Touchable>
            ) : null}
          </View>
        ) : null}
      </View>
    ) : null;

  let body;
  if (results.query) {
    body = (
      <InfiniteEntries
        extId={extId}
        extensionName={extensionName}
        feed={results}
        layout="grid"
        shape={searchShape(sections)}
        empty={`Nothing matches "${results.query}".`}
        focusFirst={false}
      />
    );
  } else if (lastInfinite) {
    body = (
      <LastSection
        extId={extId}
        extensionName={extensionName}
        section={sections[last]}
        header={blocks.some(Boolean) ? <>{blocks}</> : null}
        focusFirst={last === 0}
        refreshControl={refreshControl}
        standalone={standalone}
      />
    );
  } else {
    const Scroll = isTV ? TvScrollView : ScrollView;
    body = (
      <Scroll style={s.flex} contentContainerStyle={{ paddingBottom: bottomPad }} refreshControl={refreshControl} keyboardDismissMode="on-drag">
        {blocks}
      </Scroll>
    );
  }

  return (
    <>
      {toolbar}
      {body}
    </>
  );
}

/** The last grid or list of the page: it loads more pages near its end. */
function LastSection({
  extId,
  extensionName,
  section,
  header,
  focusFirst,
  refreshControl,
  standalone,
}: {
  extId: string;
  extensionName: string;
  section: SectionSpec;
  header: ReactElement | null;
  focusFirst: boolean;
  refreshControl?: ReactElement;
  standalone: boolean;
}) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const feed = useFeedSection({ extId, feed: section.feed, refreshSeconds: section.refreshSeconds }, { paged: true });
  // On a page with sections above, the last section has its own title; alone, the screen title is enough.
  const head = standalone ? (
    header
  ) : (
    <>
      {header}
      <Text style={[s.sectionTitle, { paddingHorizontal: l.gutter }]} accessibilityRole="header">
        {section.title}
      </Text>
    </>
  );
  return (
    <InfiniteEntries
      extId={extId}
      extensionName={extensionName}
      feed={feed}
      layout={section.layout === 'list' ? 'list' : 'grid'}
      shape={section.shape}
      header={head}
      empty="Nothing here yet."
      focusFirst={focusFirst}
      refreshControl={refreshControl}
    />
  );
}

/** Search results use the shape of the page's first grid, else wide tiles. */
function searchShape(sections: SectionSpec[]): Shape {
  return sections.find((x) => x.layout === 'grid')?.shape ?? 'thumb';
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: c.bg },
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
  sectionTitle: { ...font(type.title3), color: c.text, marginTop: spacing.xl, marginBottom: sizes.sectionHeaderGap },
}));
