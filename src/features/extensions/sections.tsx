/**
 * The section renderers of extension pages and Home rows: a row (TV shelf
 * on TV, a free-scrolling row elsewhere), a list, and the infinite grid or
 * list that ends a page. What each draws for loading, empty and failed
 * feeds comes from `section-view.ts`. An entry with a Jellyfin item draws
 * the normal item tile; any other entry a plain tile.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type ComponentRef, type ReactElement, memo, useCallback, useContext, useMemo, useRef } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useItemMenu } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { RowHeader } from '@/components/item-row';
import { PlainArt } from '@/components/plain-art';
import { PlainGrid } from '@/components/plain-grid';
import { PlainTile, type PlainTileData } from '@/components/plain-tile';
import { Delayed, SkeletonBlock } from '@/components/skeleton';
import { GridSkeleton } from '@/components/states';
import { Tile, tileAspect, tileHeight } from '@/components/tile';
import { Touchable } from '@/components/touchable';
import type { SectionSpec, Shape } from '@/extensions/schema';
import { type FeedRow, type FeedState, useFeedSection } from '@/extensions/ui/use-feed';
import { BillboardRows, showOnBillboard } from '@/features/tv/billboard';
import { tvFocusRest } from '@/features/tv/focus-settle';
import { flashScroll, useTvPageScroll } from '@/features/tv/page-scroll';
import { TvShelf } from '@/features/tv/shelf';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, sizes, spacing, tvFocusBleed, type, useLayout, useStyles, useTheme } from '@/theme';

import { entryIsPressable, useOpenEntry } from './open-entry';
import { failedText, LIST_PREVIEW, sectionBody, type SectionMode, tileOfEntry } from './section-view';

/** A plain tile that carries its feed row. */
export interface EntryTileData extends PlainTileData {
  row: FeedRow;
}

function useEntryTiles(rows: FeedRow[]): EntryTileData[] {
  return useMemo(() => rows.map((row) => ({ ...tileOfEntry(row.entry), row })), [rows]);
}

/** One entry in a row or a grid: the item tile for a Jellyfin item, else a plain tile. */
const EntryTile = memo(function EntryTile({
  tile,
  width,
  shape,
  onPress,
  onLongPressItem,
  firstFocus,
  index = 0,
  onFocus,
}: {
  tile: EntryTileData;
  width: number;
  shape: Shape;
  onPress: (tile: EntryTileData) => void;
  onLongPressItem?: (item: BaseItemDto) => void;
  firstFocus?: boolean;
  index?: number;
  /** TV: the tile took the focus (the shelf's stable callback). */
  onFocus?: (tile: EntryTileData, index: number) => void;
}) {
  const press = useCallback(() => onPress(tile), [onPress, tile]);
  const focus = useCallback(() => onFocus?.(tile, index), [onFocus, tile, index]);
  const item = tile.row.item;
  if (item) {
    return (
      <Tile
        item={item}
        width={width}
        shape={shape}
        onPress={press}
        onLongPress={onLongPressItem}
        subtitle={tile.row.entry.subtitle}
        preferredFocus={firstFocus}
        index={index}
        onFocusItem={onFocus ? focus : undefined}
      />
    );
  }
  return (
    <PlainTile
      data={tile}
      width={width}
      aspectRatio={tileAspect(shape)}
      onPress={entryIsPressable(tile.row.entry, false) ? press : undefined}
      firstFocus={firstFocus}
      index={index}
      onFocus={onFocus ? focus : undefined}
    />
  );
});

/** A titled row of entries. TV: the TV shelf (windowed, the focus keeps its place). */
export function EntryRow({ extId, title, rows, shape, onSeeAll, firstFocus }: { extId: string; title: string; rows: FeedRow[]; shape: Shape; onSeeAll?: () => void; firstFocus?: boolean }) {
  const l = useLayout();
  const open = useOpenEntry(extId);
  const press = useCallback((t: EntryTileData) => open(t.row.entry, t.row.item), [open]);
  // Long press, and right click on the web and the Mac app: the item actions. Not on TV.
  const menu = useItemMenu();
  const tiles = useEntryTiles(rows);
  const section = useRef<ComponentRef<typeof View> | null>(null);
  // TV Home: the billboard shows the Jellyfin item the focus rests on.
  const billboard = useContext(BillboardRows) && l.tv;
  const onFocusItem = useCallback(
    (t: EntryTileData) => {
      const item = t.row.item;
      if (billboard && item) tvFocusRest.push(() => showOnBillboard(item), item.Id ?? item);
    },
    [billboard],
  );
  const width = l.rowTile[shape];
  const padV = l.tv ? tvFocusBleed(tileHeight(shape, width)) : spacing.xs;
  return (
    <View ref={section} style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      {isTV ? (
        <TvShelf
          items={tiles}
          keyOf={(t) => t.key}
          tileWidth={width}
          gap={l.gap}
          gutter={l.gutter}
          bleed={tvFocusBleed(width)}
          padV={padV}
          anchor={section}
          onFocusItem={onFocusItem}
          renderTile={(t, i, onFocus) => <EntryTile tile={t} width={width} shape={shape} onPress={press} firstFocus={firstFocus && i === 0} index={i} onFocus={onFocus} />}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: l.gutter, gap: l.gap, paddingVertical: padV }}>
          {tiles.map((t) => (
            <EntryTile key={t.key} tile={t} width={width} shape={shape} onPress={press} onLongPressItem={menu.open} />
          ))}
        </ScrollView>
      )}
      {menu.sheet}
    </View>
  );
}

/** One entry as a list line: art, title, subtitle, badge and progress. */
export const EntryListRow = memo(function EntryListRow({ tile, onPress, firstFocus }: { tile: EntryTileData; onPress: (tile: EntryTileData) => void; firstFocus?: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const { entry, item } = tile.row;
  const pressable = entryIsPressable(entry, !!item);
  const artWidth = scaled(sizes.episodeThumb) * (l.bp === 'compact' && !l.tv ? 0.75 : 1);
  const title = entry.title ?? item?.Name ?? '';
  const label = [title, entry.subtitle, entry.badge].filter(Boolean).join(', ');
  const body = (
    <>
      <View>
        {item ? (
          <ItemImage item={item} variant="landscape" width={artWidth} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
        ) : (
          <PlainArt uri={tile.poster} name={title} id={tile.id} kind={tile.kind} width={artWidth} aspectRatio={16 / 9} rounded={radius.sm} showTitle={false} />
        )}
        {tile.progress !== null && tile.progress !== undefined ? (
          <View style={s.track}>
            <View style={[s.bar, { width: `${Math.max(2, Math.round(tile.progress * 100))}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={s.listText}>
        <Text style={s.listTitle} numberOfLines={2}>
          {title}
        </Text>
        {entry.subtitle ? (
          <Text style={s.listSub} numberOfLines={2}>
            {entry.subtitle}
          </Text>
        ) : null}
        {entry.badge ? (
          <View style={s.badge}>
            <Text style={s.badgeText} numberOfLines={1}>
              {entry.badge}
            </Text>
          </View>
        ) : null}
      </View>
      {pressable ? <Icon name="chevron.right" size={scaled(iconSize.sm)} color={c.text3} /> : null}
    </>
  );
  if (!pressable) {
    return (
      <View style={[s.listRow, { marginHorizontal: l.gutter }]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Touchable
      kind="row"
      radius={radius.md}
      firstFocus={firstFocus}
      onPress={() => onPress(tile)}
      accessibilityRole="button"
      accessibilityLabel={label}
      containerStyle={{ marginHorizontal: l.gutter }}
      style={({ pressed, hovered }) => [s.listRow, (pressed || hovered) && s.listRowPressed]}>
      {body}
    </Touchable>
  );
});

/** The first entries of a list that is not the last section, under a header with "See all". */
function ListPreview({ extId, title, rows, onSeeAll, firstFocus }: { extId: string; title: string; rows: FeedRow[]; onSeeAll?: () => void; firstFocus?: boolean }) {
  const l = useLayout();
  const open = useOpenEntry(extId);
  const press = useCallback((t: EntryTileData) => open(t.row.entry, t.row.item), [open]);
  const tiles = useEntryTiles(rows.slice(0, LIST_PREVIEW));
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      <View style={{ gap: spacing.sm }}>
        {tiles.map((t, i) => (
          <EntryListRow key={t.key} tile={t} onPress={press} firstFocus={firstFocus && i === 0} />
        ))}
      </View>
      {/* TV: the header is not a focus stop, so "See all" is a button under the list. */}
      {isTV && onSeeAll ? (
        <View style={{ paddingHorizontal: l.gutter, marginTop: spacing.sm, flexDirection: 'row' }}>
          <Button title="See all" variant="tonal" onPress={onSeeAll} />
        </View>
      ) : null}
    </View>
  );
}

/** A section that did not load: its title and a short note. It never blocks the screen. */
export function FailedSection({ title, extensionName }: { title: string; extensionName: string }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} />
      <Text style={[s.note, { paddingHorizontal: l.gutter }]}>{failedText(extensionName)}</Text>
    </View>
  );
}

function RowPlaceholder({ title, shape }: { title: string; shape: Shape }) {
  const l = useLayout();
  const width = l.rowTile[shape];
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} />
      <Delayed>
        <View style={{ flexDirection: 'row', overflow: 'hidden', paddingHorizontal: l.gutter, gap: l.gap }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} width={width} height={width / tileAspect(shape)} radius={radius.md} />
          ))}
        </View>
      </Delayed>
    </View>
  );
}

/**
 * A row or a preview section: one feed page. On Home, a row that loads or
 * is empty takes no room, and one that fails shows a note.
 */
export function SectionBlock({
  extId,
  extensionName,
  section,
  mode,
  where,
  onSeeAll,
  firstFocus,
}: {
  extId: string;
  extensionName: string;
  section: SectionSpec;
  mode: Exclude<SectionMode, 'infinite'>;
  where: 'page' | 'home';
  onSeeAll?: () => void;
  firstFocus?: boolean;
}) {
  const feed = useFeedSection({ extId, feed: section.feed, refreshSeconds: section.refreshSeconds });
  const body = sectionBody({ status: feed.status, count: feed.rows.length }, mode, where);
  if (body === 'hidden' || body === 'empty') return null;
  if (body === 'failed') return <FailedSection title={section.title} extensionName={extensionName} />;
  if (body === 'placeholder') return <RowPlaceholder title={section.title} shape={section.shape} />;
  if (mode === 'preview' && section.layout === 'list') return <ListPreview extId={extId} title={section.title} rows={feed.rows} onSeeAll={onSeeAll} firstFocus={firstFocus} />;
  return <EntryRow extId={extId} title={section.title} rows={feed.rows} shape={section.shape} onSeeAll={onSeeAll} firstFocus={firstFocus} />;
}

/**
 * The grid or list that ends a screen (the last section, a section on its
 * own, or search results): it fills the rest of the screen and loads the
 * next page near its end. `header` scrolls with it.
 */
export function InfiniteEntries({
  extId,
  extensionName,
  feed,
  layout,
  shape,
  header,
  empty,
  focusFirst,
  refreshControl,
}: {
  extId: string;
  extensionName: string;
  feed: FeedState;
  layout: 'grid' | 'list';
  shape: Shape;
  header?: ReactElement | null;
  /** The text when the feed is empty. */
  empty: string;
  /** TV: the first entry takes the first focus. */
  focusFirst: boolean;
  refreshControl?: ReactElement;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const open = useOpenEntry(extId);
  const press = useCallback((t: EntryTileData) => open(t.row.entry, t.row.item), [open]);
  const menu = useItemMenu();
  const tiles = useEntryTiles(feed.rows);
  const body = sectionBody({ status: feed.status, count: feed.rows.length }, 'infinite', 'page');

  const footer = feed.loadingMore ? (
    <ActivityIndicator color={c.text2} style={s.footer} />
  ) : feed.capped ? (
    <Text style={[s.note, s.footer, { paddingHorizontal: l.gutter }]}>{`Showing the first ${feed.rows.length} entries.`}</Text>
  ) : feed.error && feed.rows.length ? (
    <Text style={[s.note, s.footer, { paddingHorizontal: l.gutter }]}>{failedText(extensionName)}</Text>
  ) : null;

  const emptyView =
    body === 'placeholder' ? (
      layout === 'grid' ? (
        <GridSkeleton shape={shape} />
      ) : (
        <ActivityIndicator color={c.text2} style={s.footer} />
      )
    ) : body === 'failed' ? (
      <View style={s.center} accessibilityRole="alert">
        <Icon name="exclamationmark.triangle" size={scaled(sizes.stateIcon)} color={c.text3} />
        <Text style={s.centerText}>{failedText(extensionName)}</Text>
        <Button title="Try again" icon="arrow.clockwise" onPress={() => void feed.refresh()} preferredFocus={isTV && focusFirst} />
      </View>
    ) : (
      <Text style={[s.note, s.center]}>{empty}</Text>
    );

  const renderTile = useCallback(
    (t: EntryTileData, width: number, first: boolean) => <EntryTile tile={t} width={width} shape={shape} onPress={press} onLongPressItem={l.tv ? undefined : menu.open} firstFocus={first} />,
    [shape, press, l.tv, menu.open],
  );

  if (layout === 'grid') {
    return (
      <>
        <PlainGrid
          items={tiles}
          onPress={press}
          shape={shape}
          renderTile={renderTile}
          focusFirstTile={focusFirst}
          ListHeaderComponent={header}
          headerFullWidth
          ListEmptyComponent={emptyView}
          ListFooterComponent={footer}
          onEndReached={feed.loadMore}
          refreshControl={refreshControl}
        />
        {menu.sheet}
      </>
    );
  }
  return <EntryList tiles={tiles} onPress={press} header={header} empty={emptyView} footer={footer} onEndReached={feed.loadMore} focusFirst={focusFirst} refreshControl={refreshControl} />;
}

/** The virtualized list form of `InfiniteEntries`. */
function EntryList({
  tiles,
  onPress,
  header,
  empty,
  footer,
  onEndReached,
  focusFirst,
  refreshControl,
}: {
  tiles: EntryTileData[];
  onPress: (t: EntryTileData) => void;
  header?: ReactElement | null;
  empty: ReactElement;
  footer: ReactElement | null;
  onEndReached: () => void;
  focusFirst: boolean;
  refreshControl?: ReactElement;
}) {
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const list = useRef<FlashListRef<EntryTileData>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => flashScroll(list.current?.getNativeScrollRef()), []));
  return (
    <FlashList
      ref={list}
      {...tvScroll.props}
      data={tiles}
      keyExtractor={(t) => t.key}
      contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: spacing.sm }}
      ItemSeparatorComponent={Separator}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header ? <View style={{ marginBottom: spacing.lg }}>{header}</View> : null}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={refreshControl}
      renderItem={({ item, index }) => <EntryListRow tile={item} onPress={onPress} firstFocus={isTV && focusFirst && index === 0} />}
    />
  );
}

function Separator() {
  return <View style={{ height: spacing.sm }} />;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  note: { ...font(type.footnote), color: c.text2 },
  footer: { paddingVertical: spacing.xl, textAlign: 'center' as const },
  center: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, paddingVertical: spacing.huge, paddingHorizontal: spacing.xxl, textAlign: 'center' as const },
  centerText: { ...font(type.body), color: c.text2, textAlign: 'center' as const },
  listRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    borderCurve: 'continuous' as const,
  },
  listRowPressed: { backgroundColor: c.surface2 },
  listText: { flex: 1, gap: sizes.tileMetaGap },
  listTitle: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text },
  listSub: { ...font(type.footnote), color: c.text2 },
  badge: { alignSelf: 'flex-start' as const, marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.pill, backgroundColor: c.accentSoft },
  badgeText: { ...font(type.footnote), fontWeight: '600' as const, color: c.accent },
  track: {
    position: 'absolute' as const,
    left: spacing.xs,
    right: spacing.xs,
    bottom: spacing.xs,
    height: scaled(sizes.progress),
    borderRadius: radius.pill,
    backgroundColor: c.progressTrack,
    overflow: 'hidden' as const,
  },
  bar: { height: '100%' as const, backgroundColor: mediaColors.white },
}));
