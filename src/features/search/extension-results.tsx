/**
 * Extension results in the main Search tab: one row per global search feed
 * of the account's enabled extensions (`extension-search.ts`), after the
 * server's results.
 *
 * Each row loads on its own, in parallel with the server search, so a slow
 * extension never holds back the server's results. A row shows a small
 * loading line while its reply is out; an empty or failed reply takes no
 * room. Tiles are the extension page's own (`EntryRow`), so a tap opens the
 * Jellyfin item, the entry page or the media exactly as on the page. On TV
 * the row is a TV shelf, so the D-pad reaches it from the rows above.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { RowHeader } from '@/components/item-row';
import { useExtensions } from '@/extensions/store';
import { useFeedSearchNow } from '@/extensions/ui/use-feed';
import { EntryRow } from '@/features/extensions/sections';
import { createStyles, type AppTheme, font, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { type GlobalSearch, globalSearches, globalSectionView } from './extension-search';

/** The extension rows for `query` ('' shows nothing and sends nothing). */
export function ExtensionSearchResults({ query }: { query: string }) {
  const list = useExtensions((st) => st.list);
  const searches = useMemo(() => globalSearches(list), [list]);
  if (!query || !searches.length) return null;
  return (
    <>
      {searches.map((s) => (
        <ExtensionSearchSection key={s.key} search={s} query={query} />
      ))}
    </>
  );
}

function ExtensionSearchSection({ search, query }: { search: GlobalSearch; query: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const source = useMemo(() => ({ extId: search.extId, feed: search.feed }), [search.extId, search.feed]);
  const feed = useFeedSearchNow(source, query);
  const view = globalSectionView({ status: feed.status, count: feed.rows.length });
  if (view === 'hidden') return null;
  if (view === 'loading') {
    return (
      <View style={{ marginTop: l.sectionGap }}>
        <RowHeader title={search.title} />
        <View style={[s.loading, { paddingHorizontal: l.gutter }]} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={c.text3} />
          <Text style={s.loadingText}>Searching {search.extensionName}…</Text>
        </View>
      </View>
    );
  }
  return <EntryRow extId={search.extId} title={search.title} rows={feed.rows} shape={search.shape} />;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  loading: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.xs },
  loadingText: { ...font(type.footnote), color: c.text2 },
}));
