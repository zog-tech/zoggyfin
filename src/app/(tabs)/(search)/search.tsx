import { Stack, useFocusEffect } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { useSearch, useVideoGenres } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemActionSheet, useItemMenu } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { DownloadGlyph, downloadLabel } from '@/components/download-indicator';
import { ItemImage } from '@/components/item-image';
import { ItemRow, RowHeader } from '@/components/item-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { shapeFor } from '@/components/tile';
import { Touchable } from '@/components/touchable';
import { TvToolbarRow } from '@/components/tv-page-header';
import { isNetworkError, searchDownloads, useDownloadStatus } from '@/downloads';
import { useDownloadsStore } from '@/downloads/store';
import { TrackRow } from '@/features/detail/rows';
import { browseGenres, inGenre } from '@/features/genres/genres';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { useTabRootPlace } from '@/features/extensions/tab-nav';
import { useServerNames } from '@/features/servers/use-server-names';
import { savedName } from '@/player/audio/catalog';
import { useSavedId } from '@/player/audio/catalog-links';
import {
  filterSections,
  GENRE_SEARCH_FILTERS,
  groupSearchResults,
  pushRecentSearch,
  SEARCH_FILTERS,
  searchBody,
  type SearchFilter,
  topResult,
} from '@/features/search/group-results';
import { genreChipModel, genreOptions } from '@/features/search/genre-chip';
import { ExtensionSearchResults } from '@/features/search/extension-results';
import { globalSearchQuery } from '@/features/search/extension-search';
import { TvScrollView } from '@/features/tv/page-scroll';
import { TvToolbarItem } from '@/features/tv/tv-button';
import { formatDuration } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { useRootScreenOptions } from '@/lib/stack-options';
import { useOffline } from '@/lib/online';
import { useDebounced } from '@/lib/use-debounced';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { usePlayer } from '@/player';
import { readJson, writeJson } from '@/storage/json';
import { createStyles,
  type AppTheme,
  font,
  iconSize,
  radius,
  scaled,
  scriptStyle,
  sizes,
  spacing,
  tvFont,
  tvm,
  type,
  u,
  useLayout,
  useStyles,
  useTheme,
  webInput,
} from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

const RECENT_KEY = 'search.recent';
const PLACEHOLDER = 'Movies, shows, music, people';
const ownField = Platform.OS === 'web' || isTV;
/** Android TV: the app's own field is not controlled (voice typing, see the TextInput). */
const ownedField = ownField && Platform.OS === 'android';
/**
 * TV Modern (design system §7.22): a 72 u field whose focus is a white
 * border, the filters and the genre as a one-line text toolbar (no chips),
 * and a left-aligned hint before a query (no centred icon).
 */
const MODERN = isTV && isTvModern;

export default function SearchScreen() {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const l = useLayout();
  // iOS and Android: the native search field lives in a slim header. Web and TV draw their own field.
  const root = useRootScreenOptions({ bar: !ownField });
  // In the Library stack when an extension tab takes the place of Search on this phone (lib/tab-destination.ts).
  const pushed = useTabRootPlace('(search)', 'search');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  // A movie and show genre (its name): the search keeps to it, and with no words lists it.
  const [genre, setGenre] = useState<string | null>(null);
  const term = useDebounced(text.trim(), sizes.searchDebounce);
  const q = useSearch(term, genre ?? undefined);
  const offline = useOffline();
  const genreList = browseGenres(useVideoGenres(!offline).data);
  const [genreSheet, setGenreSheet] = useState(false);
  const records = useDownloadsStore((st) => st.records);
  const nameOf = useServerNames();
  // With downloads from more than one server, each local result names its server.
  const serverOf = useMemo(() => {
    const servers = new Set(Object.values(records).map((r) => r.serverId));
    return servers.size > 1 ? (it: BaseItemDto) => (it.Id && records[it.Id] ? nameOf(records[it.Id].serverId) : undefined) : null;
  }, [records, nameOf]);
  // Offline (or the server cannot be reached): search what is on this device.
  const localOnly = offline || (!!q.error && !q.data && isNetworkError(q.error));
  const localResults = useMemo(() => (localOnly ? inGenre(searchDownloads(records, term), genre) : []), [localOnly, records, term, genre]);
  const results = localOnly ? localResults : q.data;
  const all = useMemo(() => groupSearchResults(results ?? []), [results]);
  const sections = useMemo(() => filterSections(all, filter), [all, filter]);
  // A genre with no words is a list to browse: no top result.
  const top = filter === 'all' && term.length >= 2 ? topResult(sections) : null;
  const [recentVersion, setRecentVersion] = useState(0);
  const searchRef = useRef<SearchBarCommands>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  // TV Modern: the field's focus border (a text field is not a Touchable, so it has no focus mark).
  const [fieldFocused, setFieldFocused] = useState(false);
  const player = usePlayer();
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);

  // Remember a search only when it was used: the Search key, a played result, or an opened
  // result (the screen loses focus). Results alone do not count: with catalog sources, almost
  // every partial word returns results, and each pause in typing would be saved.
  const hasResults = !localOnly && !!q.data?.length;
  const latest = useRef({ term, hasResults });
  useEffect(() => {
    latest.current = { term, hasResults };
  }, [term, hasResults]);
  const remember = useCallback(() => {
    const { term: t, hasResults: ok } = latest.current;
    if (t.length >= 2 && ok) writeJson(RECENT_KEY, pushRecentSearch(readJson<string[]>(RECENT_KEY, []), t));
  }, []);
  useFocusEffect(useCallback(() => remember, [remember]));

  const active = term.length >= 2 || !!genre;
  const genreChip = genreChipModel({ genre, genreCount: genreList.length, localOnly });
  // Extension searches with `global: true` run beside the server search, never before it.
  const extQuery = globalSearchQuery(term, { offline: localOnly, genre, filter });
  const body = searchBody({
    active,
    localOnly,
    pending: q.isPending,
    placeholder: q.isPlaceholderData,
    error: !!q.error,
    hasData: !!q.data,
    sections: sections.length,
  });
  // Read when the recent list is on screen; it changes only between searches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => readJson<string[]>(RECENT_KEY, []), [active, recentVersion]);

  // Android: the field owns its text (see `fieldKey`); a new text from the app builds the field again with it.
  const [fieldKey, setFieldKey] = useState(0);
  const setFieldText = (t: string) => {
    setText(t);
    if (ownedField) setFieldKey((k) => k + 1);
  };
  const applyRecent = (r: string) => {
    setFieldText(r);
    searchRef.current?.setText(r);
  };

  // The chip row changes length when a genre is chosen or cleared: show its start again.
  const chipRow = useRef<ComponentRef<typeof ScrollView>>(null);
  const pickGenre = (name: string | null) => {
    setGenre(name);
    chipRow.current?.scrollTo({ x: 0, animated: false });
    // Episodes, Music and People do not exist within a genre.
    if (name && !GENRE_SEARCH_FILTERS.some((f) => f.value === filter)) setFilter('all');
  };

  return (
    <>
      <Stack.Screen
        options={{
          ...(pushed ? { headerLargeTitleEnabled: false } : root),
          title: 'Search',
          headerSearchBarOptions: ownField
            ? undefined
            : {
                ref: searchRef,
                placeholder: PLACEHOLDER,
                autoCapitalize: 'none',
                hideWhenScrolling: false,
                tintColor: c.accent,
                textColor: c.text,
                onChangeText: (e) => setText(e.nativeEvent.text),
                onCancelButtonPress: () => setText(''),
                onSearchButtonPress: remember,
              },
        }}
      />
      <TvScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={s.page}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad }]}>
        {ownField ? (
          <View style={[s.fieldRow, MODERN && s.fieldRowModern, { paddingHorizontal: l.gutter }]}>
            <View style={MODERN ? [s.field, s.fieldModern, fieldFocused && s.fieldFocusedModern] : s.field}>
              <Icon name="magnifyingglass" size={MODERN ? u(30) : scaled(iconSize.sm)} color={c.text3} />
              <TextInput
                key={fieldKey}
                ref={inputRef}
                // Android: not controlled. The keyboard's voice typing streams its words as a
                // composition; a controlled value written back late (a slow TV JS thread) replaced it.
                {...(ownedField ? { defaultValue: text } : { value: text })}
                onChangeText={setText}
                placeholder={PLACEHOLDER}
                placeholderTextColor={c.text3}
                selectionColor={c.accent}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!isTV}
                style={MODERN ? [s.input, s.inputModern] : s.input}
                accessibilityLabel="Search"
                returnKeyType="search"
                onSubmitEditing={remember}
                {...(MODERN ? { onFocus: () => setFieldFocused(true), onBlur: () => setFieldFocused(false) } : null)}
              />
              {/* TV Modern: no round clear glyph; Cancel beside the field clears. */}
              {text && !MODERN ? (
                <Touchable onPress={() => setFieldText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
                </Touchable>
              ) : null}
            </View>
            {text && MODERN ? (
              <Button
                title="Cancel"
                variant="text"
                onPress={() => {
                  setFieldText('');
                  inputRef.current?.blur();
                }}
              />
            ) : text ? (
              <Touchable
                onPress={() => {
                  setFieldText('');
                  inputRef.current?.blur();
                }}
                radius={8}
                accessibilityRole="button"
                accessibilityLabel="Cancel">
                <Text style={s.cancel}>Cancel</Text>
              </Touchable>
            ) : null}
          </View>
        ) : null}

        <OfflineBanner />
        {MODERN && (active || genreChip.visible) ? (
          <View style={[s.toolbarModern, { paddingHorizontal: l.gutter }]}>
            <TvToolbarRow ref={chipRow} inset={l.gutter}>
              {genreChip.visible ? (
                <>
                  <TvToolbarItem label="Genre" value={genre ?? 'Any'} onPress={() => setGenreSheet(true)} accessibilityLabel={genreChip.accessibilityLabel} />
                  {genreChip.showClear ? <TvToolbarItem value="Clear genre" on={false} onPress={() => pickGenre(null)} /> : null}
                </>
              ) : null}
              {active
                ? (genre ? GENRE_SEARCH_FILTERS : SEARCH_FILTERS).map((f) => (
                    <TvToolbarItem key={f.value} value={f.label} on={filter === f.value} onPress={() => setFilter(f.value)} />
                  ))
                : null}
            </TvToolbarRow>
          </View>
        ) : active || genreChip.visible ? (
          <ScrollView
            ref={chipRow}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chips}
            contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }, chipRowTV()]}>
            {active
              ? (genre ? GENRE_SEARCH_FILTERS : SEARCH_FILTERS).map((f) => (
                  <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
                ))
              : null}
            {genreChip.visible ? (
              <>
                <Chip
                  label={genreChip.label}
                  icon="chevron.down"
                  selected={genreChip.selected}
                  onPress={() => setGenreSheet(true)}
                  accessibilityLabel={genreChip.accessibilityLabel}
                />
                {genreChip.showClear ? <Chip label="Clear" icon="xmark" onPress={() => pickGenre(null)} accessibilityLabel="Clear genre" /> : null}
              </>
            ) : null}
          </ScrollView>
        ) : null}

        {body === 'idle' ? (
          recent.length ? (
            <View style={s.recent}>
              <RowHeader title="Recent searches" />
              {/* TV Modern: plain list rows on the page (no card); the row fill reaches into the gutter. */}
              <View style={MODERN ? { marginHorizontal: l.gutter - u(24) } : [s.recentList, { marginHorizontal: l.gutter }]}>
                {recent.map((r, i) => (
                  <Touchable
                    key={r}
                    kind="row"
                    onPress={() => applyRecent(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${r}`}
                    style={
                      MODERN ? s.recentRowModern : ({ pressed, hovered, focused }) => [s.recentRow, (pressed || hovered || (focused && !isTV)) && s.rowActive]
                    }>
                    <Icon name="clock.arrow.circlepath" size={MODERN ? u(30) : scaled(iconSize.sm)} color={c.text3} />
                    <View style={MODERN ? s.recentBodyModern : [s.recentBody, i < recent.length - 1 && s.line]}>
                      <Text style={[MODERN ? s.recentTextModern : s.recentText, scriptStyle(r, MODERN ? s.recentTextModern : s.recentText)]} numberOfLines={1}>
                        {r}
                      </Text>
                    </View>
                  </Touchable>
                ))}
              </View>
              <Button
                title="Clear recent searches"
                variant="text"
                onPress={() => {
                  writeJson(RECENT_KEY, []);
                  setRecentVersion((v) => v + 1);
                }}
                containerStyle={{ marginLeft: MODERN ? l.gutter - u(tvm.size.actionPadX) : l.gutter - spacing.sm, alignSelf: 'flex-start' }}
              />
            </View>
          ) : MODERN ? (
            <View style={[s.hintModern, { paddingHorizontal: l.gutter }]}>
              <Text style={s.hintTitleModern}>Search your server</Text>
              <Text style={s.hintTextModern}>Find movies, shows, episodes, albums, songs, artists and people.</Text>
            </View>
          ) : (
            <EmptyState icon="magnifyingglass" title="Search your server" message="Find movies, shows, episodes, albums, songs, artists and people." />
          )
        ) : body === 'loading' ? (
          <LoadingState />
        ) : body === 'error' ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : body === 'empty' ? (
          <EmptyState
            icon="magnifyingglass"
            title={term.length >= 2 ? `No results for “${term}”${genre ? ` in ${genre}` : ''}` : `Nothing in ${genre ?? 'this genre'}`}
            message={
              localOnly
                ? 'The server cannot be reached, so only downloads are searched.'
                : genre
                  ? 'Check the spelling or choose All genres.'
                  : filter === 'all'
                  ? 'Check the spelling or try fewer words.'
                  : 'Check the spelling or choose another filter.'
            }
          />
        ) : (
          <View style={q.isFetching && !localOnly ? s.stale : undefined}>
            {top ? <TopResult item={top} onPlay={() => { remember(); player.play({ item: top }); }} /> : null}
            {sections.map((sec) =>
              sec.key === 'songs' ? (
                <View key={sec.key} style={{ marginTop: l.sectionGap }}>
                  <RowHeader title={sec.title} />
                  {sec.items.slice(0, 8).map((song, i, list) => (
                    <TrackRow
                      key={song.Id ?? i}
                      item={song}
                      index={i}
                      showArt
                      note={localOnly ? serverOf?.(song) : undefined}
                      last={i === list.length - 1}
                      onPress={(it) => { remember(); player.play({ item: it }); }}
                      onLongPress={(it) => { remember(); setMenu(it); }}
                      queue="both"
                    />
                  ))}
                </View>
              ) : (
                <ItemRow
                  key={sec.key}
                  title={sec.title}
                  items={sec.items}
                  shape={sec.items[0] ? shapeFor(sec.items[0]) : 'poster'}
                  tileSubtitle={localOnly && serverOf ? serverOf : undefined}
                />
              ),
            )}
            {localOnly ? <Text style={[s.localNote, { paddingHorizontal: l.gutter }]}>Showing downloads only. The server cannot be reached.</Text> : null}
          </View>
        )}
        <ExtensionSearchResults query={extQuery} />
      </TvScrollView>
      <OptionSheet
        visible={genreSheet}
        title="Genre"
        options={genreOptions(genreList.map((g) => g.Name ?? '').filter(Boolean))}
        selected={[genre]}
        onSelect={pickGenre}
        onClose={() => setGenreSheet(false)}
      />
      <ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />
    </>
  );
}

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Audio', 'MusicAlbum', 'Series', 'Playlist']);
const TYPE_LABEL: Record<string, string> = {
  Movie: 'Movie',
  Series: 'Show',
  Episode: 'Episode',
  MusicAlbum: 'Album',
  Audio: 'Song',
  MusicArtist: 'Artist',
  Person: 'Person',
  Playlist: 'Playlist',
  BoxSet: 'Collection',
  Video: 'Video',
};

/** The top result card: art, title, facts and a Play or Resume button. */
function TopResult({ item, onPlay }: { item: BaseItemDto; onPlay: () => void }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const open = useOpenItem();
  // Long press, and right click on the web and the Mac app: the item actions. Not on TV.
  const menu = useItemMenu();
  const shape = shapeFor(item);
  const artWidth = MODERN ? u(shape === 'thumb' ? 240 : 120) : scaled(shape === 'thumb' ? 112 : 64);
  const aspect = shape === 'poster' ? 2 / 3 : shape === 'thumb' ? 16 / 9 : 1;
  const facts = [TYPE_LABEL[item.Type ?? ''], item.ProductionYear ? String(item.ProductionYear) : null, formatDuration(item.RunTimeTicks)]
    .filter(Boolean)
    .join(' · ');
  const resume = !!item.UserData?.PlaybackPositionTicks;
  const download = useDownloadStatus(item.Id);
  // A catalog song (☁) the server saved shows the saved name.
  const saved = useSavedId(item.Type === 'Audio' ? item.Id : null);
  const name = item.Type === 'Audio' && saved !== item.Id ? savedName(item.Name) : item.Name;
  return (
    <View style={{ marginTop: MODERN ? u(36) : spacing.lg, paddingHorizontal: l.gutter }}>
      <Text style={MODERN ? s.topHeaderModern : s.topHeader} accessibilityRole="header">
        Top result
      </Text>
      {/* The card press area and the Play button are siblings: a button must not be inside a button (web). */}
      <View>
        <Touchable
          kind="plain"
          radius={radius.lg}
          onPress={() => open(item)}
          onLongPress={l.tv ? undefined : () => menu.open(item)}
          accessibilityRole="button"
          accessibilityLabel={[name, facts, downloadLabel(download)].filter(Boolean).join(', ')}
          containerStyle={StyleSheet.absoluteFill}
          style={({ pressed, hovered }) => [s.topCardBg, (pressed || hovered) && s.topCardBgActive]}
        />
        <View style={MODERN ? [s.topCard, s.topCardModern] : s.topCard} pointerEvents="box-none">
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ItemImage
              item={item}
              variant={shape === 'thumb' ? 'landscape' : shape === 'poster' ? 'poster' : 'square'}
              width={artWidth}
              aspectRatio={aspect}
              rounded={MODERN ? u(12) : radius.sm}
              circle={shape === 'circle'}
              hideArtTitle
            />
          </View>
          <View style={s.topBody} pointerEvents="box-none">
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.topText}>
              <Text style={[MODERN ? s.topTitleModern : s.topTitle, scriptStyle(name, MODERN ? s.topTitleModern : s.topTitle)]} numberOfLines={2}>
                {name}
              </Text>
              {facts || download.state !== 'none' ? (
                <View style={s.topMetaRow}>
                  <DownloadGlyph id={item.Id} size={14} status={download} />
                  {facts ? <Text style={MODERN ? s.topMetaModern : s.topMeta}>{facts}</Text> : null}
                </View>
              ) : null}
            </View>
            {PLAYABLE.has(item.Type ?? '') ? (
              <Button title={resume ? 'Resume' : 'Play'} icon="play.fill" variant="small" onPress={onPlay} containerStyle={s.topButton} />
            ) : null}
          </View>
        </View>
      </View>
      {menu.sheet}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { backgroundColor: c.bg },
  content: { paddingBottom: spacing.huge * 2 },
  stale: { opacity: 0.6 },
  localNote: { ...font(type.footnote), color: c.text2, marginTop: spacing.xl },
  fieldRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, marginTop: spacing.sm },
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
  cancel: { ...font(type.body), color: c.accent },
  chips: { flexGrow: 0, marginTop: spacing.md },
  chipsContent: { gap: spacing.sm },
  recent: { marginTop: spacing.xxl },
  recentList: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const },
  recentRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface3 },
  recentBody: { flex: 1, minHeight: scaled(sizes.rowMin), justifyContent: 'center' as const, paddingRight: spacing.lg },
  line: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  recentText: { ...font(type.body), color: c.text },
  topHeader: { ...font(type.title3), color: c.text, marginBottom: 10 },
  topCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.md,
  },
  topCardBg: { flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous' as const },
  topCardBgActive: { backgroundColor: c.surface2 },
  topBody: { flex: 1 },
  topText: { gap: 2 },
  topTitle: { ...font(type.headline), color: c.text },
  topMeta: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  topMetaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  topButton: { alignSelf: 'flex-start' as const, marginTop: spacing.sm },
  // TV Modern (redesign §2.7).
  fieldRowModern: { gap: u(16), marginTop: u(20) },
  fieldModern: {
    height: u(72),
    gap: u(16),
    paddingHorizontal: u(24),
    borderRadius: u(tvm.size.plateRadius),
    borderWidth: u(2),
    borderColor: c.controlBorder,
  },
  // A wider edge eats into the padding, so the icon and the text do not move.
  fieldFocusedModern: { borderWidth: u(4), borderColor: c.text, paddingHorizontal: u(22) },
  inputModern: { ...tvFont(tvm.type.body), fontSize: u(30), fontWeight: '400' as const },
  toolbarModern: { marginTop: u(24) },
  topHeaderModern: { ...tvFont(tvm.type.rowTitle), color: c.text, marginBottom: u(tvm.size.rowTitleGap) },
  topCardModern: { gap: u(28), padding: u(20) },
  topTitleModern: { ...tvFont(tvm.type.rowTitle), color: c.text },
  topMetaModern: { ...tvFont(tvm.type.meta), color: c.text2, flexShrink: 1 },
  hintModern: { marginTop: u(48), gap: u(12) },
  hintTitleModern: { ...tvFont(tvm.type.body), fontSize: u(40), lineHeight: u(48), fontWeight: '700' as const, color: c.text },
  hintTextModern: { ...tvFont(tvm.type.body), color: c.text2 },
  recentRowModern: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: u(20), paddingHorizontal: u(24), minHeight: u(tvm.size.listRowHeight) },
  recentBodyModern: { flex: 1, justifyContent: 'center' as const },
  recentTextModern: { ...tvFont(tvm.type.body), fontSize: u(30), lineHeight: u(36), fontWeight: '500' as const, color: c.text },
}));
