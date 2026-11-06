/**
 * The Live TV page (design system §7.21).
 *
 * TV and wide windows: a browse column at the leading edge (Search,
 * Favourites, Recently watched, All channels, other sections, the provider's
 * groups, Providers), the channel list, and on TV the focused channel's
 * details beside the list (TiviMate style). On TV, Left from the column
 * opens the side menu.
 * Narrow windows: the search field at the top, the lists and groups as chips,
 * and the channel list.
 *
 * Search is one step away everywhere: the Search entry at the top of the
 * column (TV: it opens the field and the keyboard at once), the Search button
 * in the TV header, and the field on phones. Results follow every key press
 * and match the channel name and number; a search used to play a channel is
 * kept as a recent search. Above the channels, "On now" lists programmes
 * from the providers' guides whose titles match (on now or within the hour;
 * not on the plain web); a tap plays the channel, and channel up and down
 * move through those programmes' channels.
 *
 * Several providers: "All providers" (two providers or more) merges
 * Favourites, Recently watched and Search of every provider; each row names
 * its provider, and channel up and down move through the merged list. The
 * provider switch is in the browse column on TV and wide windows, and a
 * chip row on phones. Groups, All channels, films and series stay per
 * provider: picking a provider shows them.
 */
import { router, Stack, useFocusEffect } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon, type IconName } from '@/components/icon';
import { LoadingState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { focusView } from '@/features/tv/focus';
import { TvScrollView, useTvPageScroll } from '@/features/tv/page-scroll';
import { useTvBack } from '@/features/tv/use-tv-back';
import { useTvRemote } from '@/features/tv/use-tv-remote';
import {
  ALL_PROVIDERS,
  asProviderChannel,
  browseEntries,
  type Channel,
  FAVOURITES_GROUP,
  iptv,
  mergedBrowseEntries,
  mergedDefaultGroup,
  type ProgrammeHit,
  programmePlayList,
  type ProviderChannel,
  providerChannelKey,
  providerEntryKey,
  RECENTS_GROUP,
  resolveGroup,
  SEARCH_ENTRY,
  syncSoon,
  useChannels,
  useChannelView,
  useFavouriteKeys,
  useLiveView,
  useMergedLists,
  useMergedSearch,
  useMinute,
  usePlayChannel,
  usePlayMerged,
  useProgrammeSearch,
  useProviders,
  useRecentSearches,
  useVodKinds,
} from '@/iptv';
import { useRootScreenOptions } from '@/lib/stack-options';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';
import { features, isNativeTV, isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, tvFocusBleed, type, useLayout, useStyles, useTheme, webInput } from '@/theme';

import { BrowseColumn } from './browse-column';
import { ChannelDetails } from './channel-details';
import { focusChannel, useFocusedChannel } from './focused-channel';
import { CHANNEL_ROW_HEIGHT, ChannelRow, HEART_TV } from './channel-row';
import { providerFormHref, providersHref, useLiveGroup } from './nav';
import { ProgrammeRow } from './programme-row';
import { takeChannelSearch } from './search-request';
import { liveTvSections, type LiveTvSection } from './sections';

const COLUMN_WIDTH = scaled(isTV ? 200 : 220);
const DETAILS_WIDTH = scaled(isTV ? 290 : 320);
const COLUMN_GAP = spacing.lg;

const VIEWABILITY = { itemVisiblePercentThreshold: 30, minimumViewTime: 250 };

export function LiveTvScreen() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions();
  const bottomPad = useTabBottomPadding(isTV ? spacing.xxl : undefined);
  const group = useLiveGroup();
  const providers = useProviders();
  // Live TV in the Jellyfin account: changes from another device show when the page opens.
  useEffect(() => syncSoon(), []);
  // A provider id, or ALL_PROVIDERS ("All providers").
  const liveView = useLiveView();
  const all = liveView === ALL_PROVIDERS;
  const providerId = all ? null : liveView;
  const provider = providers.find((p) => p.id === providerId) ?? null;
  const data = useChannels(providerId);
  const recentSearches = useRecentSearches(liveView);
  const names = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers]);

  // The group picked for a view (another provider starts on its own default group).
  const [pick, setPick] = useState<{ view: string | null; key: string } | null>(null);
  const picked = pick && pick.view === liveView ? pick.key : null;
  const setPicked = useCallback((key: string) => setPick({ view: liveView, key }), [liveView]);

  // Search: the field text, and (TV and wide windows) the open Search entry.
  const [text, setText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const query = useDebounced(text.trim(), 120);
  const searching = searchOpen || !!text.trim();

  const wide = l.tv || l.bp !== 'compact';
  // TV: the focused channel's details beside the list.
  const details = l.tv;
  const kinds = useVodKinds(providerId);
  const sections = useMemo(() => liveTvSections.filter((x) => x.available(kinds)), [kinds]);

  const base = useChannelView(providerId, '', '');
  // "All providers": Favourites and Recently watched of every provider, and a search over all of them.
  const merged = useMergedLists(all);
  const mergedSearch = useMergedSearch(all && searching, query);
  // Programmes on now (or within the hour) whose title matches: one provider, or every provider.
  const programmes = useProgrammeSearch(searching ? liveView : null, query);
  const groupKey = all ? mergedDefaultGroup(merged.favourites.length, merged.recents.length, picked) : resolveGroup(base.groups, picked);
  const view = useChannelView(providerId, groupKey, searching ? query : '');
  // The provider switch, with two providers or more: "All providers" first, then the user's order.
  const providerEntries = useMemo(
    () => (providers.length > 1 ? [{ providerId: ALL_PROVIDERS, label: 'All providers' }, ...providers.map((p) => ({ providerId: p.id, label: p.name }))] : []),
    [providers],
  );
  const entries = useMemo(
    () => (all ? mergedBrowseEntries(merged.favourites.length, merged.recents.length, providerEntries) : browseEntries(base.groups, sections, providerEntries)),
    [all, merged.favourites.length, merged.recents.length, providerEntries, base.groups, sections],
  );
  // The rows: one provider's channels, or the merged list (each row knows its provider).
  const rows: readonly (Channel | ProviderChannel)[] = useMemo(() => {
    if (searching && !query) return EMPTY;
    if (!all) return view.channels;
    if (searching) return mergedSearch.results;
    return groupKey === RECENTS_GROUP ? merged.recents : merged.favourites;
  }, [all, searching, query, view.channels, mergedSearch.results, groupKey, merged.recents, merged.favourites]);
  // The same ProviderChannel object for a channel on every render, so a row's props stay the same
  // and its memo holds (a new object per render re-rendered every row on each page render).
  const rowOf = useCallback((r: Channel | ProviderChannel): ProviderChannel => ('channel' in r ? r : wrappedRow(providerId ?? '', r)), [providerId]);

  const now = useMinute();
  const play = usePlayChannel();
  const playMerged = usePlayMerged();
  // The channel that plays, as a merged key (a merged list's channel ids are keys already).
  const playingKey = usePlayerStore((st) => {
    const live = st.now?.live;
    const id = live?.channels[live.index]?.id;
    if (!live || !id) return null;
    return live.source.providerId === ALL_PROVIDERS ? id : providerChannelKey(live.source.providerId, id);
  });
  const favourites = useFavouriteKeys();
  // A number column only when the list numbers its channels.
  const numbered = useMemo(
    () => (all ? rows.some((r) => rowOf(r).channel.number !== undefined) : data.channels.some((ch) => ch.number !== undefined)),
    [all, rows, rowOf, data.channels],
  );
  const searchCount = all ? mergedSearch.results.length : view.channels.length;

  const toggle = useCallback(
    (row: ProviderChannel) => {
      // The list stays where it is: the first favourite does not switch the page to Favourites.
      if (!picked) setPicked(groupKey);
      const on = iptv.toggleFavourite(row.providerId, row.channel);
      const ch = row.channel;
      toast(on ? `${ch.name} is in Favourites` : `${ch.name} is no longer in Favourites`, { icon: on ? 'heart.fill' : 'heart' });
    },
    [picked, groupKey, setPicked],
  );
  const onPlay = useCallback(
    (row: ProviderChannel) => {
      if (searching && query && liveView) iptv.rememberSearch(liveView, query);
      // Channel up and down move through the list the channel was played from.
      if (all) playMerged(rows.map(rowOf), row);
      else if (providerId) play(providerId, rows as Channel[], row.channel);
    },
    [all, providerId, liveView, play, playMerged, rows, rowOf, searching, query],
  );
  const onPlayProgramme = useCallback(
    (hit: ProgrammeHit, channel: Channel) => {
      if (query && liveView) iptv.rememberSearch(liveView, query);
      const item = asProviderChannel(hit.providerId, channel);
      // The first stream: channel up and down move through the programmes. Another stream: through that programme's streams.
      if (channel === hit.channels[0]) playMerged(programmePlayList(programmes), item);
      else playMerged(hit.channels.map((ch) => asProviderChannel(hit.providerId, ch)), item);
    },
    [query, liveView, playMerged, programmes],
  );
  // The list header's height: the item offsets start below it (the "On now" part can be tall).
  const [headerHeight, setHeaderHeight] = useState(0);

  // TV: the focused row (the menu key favourites it; the details panel shows it).
  const focused = useRef<ProviderChannel | null>(null);
  const onFocusRow = useCallback(
    (row: ProviderChannel | null) => {
      if (!row) return;
      focused.current = row;
      // Not page state: only the details panel reads it (focused-channel.ts).
      if (details) focusChannel(liveView, row);
    },
    [liveView, details],
  );
  useTvRemote(isNativeTV, (e) => {
    if (e.eventType === 'menu' && Number(e.eventKeyAction ?? -1) !== 0 && focused.current) toggle(focused.current);
  });

  // Search entry, field and Back.
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const searchEntry = useRef<ComponentRef<typeof View> | null>(null);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Straight into the field, and the keyboard opens. On TV a new field focuses itself
    // (autoFocus); one that is already there takes the focus here.
    field.current?.focus();
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setText('');
    field.current?.blur();
    if (isTV) setTimeout(() => focusView(searchEntry.current), 60);
  }, []);
  // TV: Back leaves the search (the keyboard closes first, by itself).
  useTvBack(isTV && searchOpen, closeSearch);
  // "Search channels" in the player's channel list: the player closed and left a request.
  useFocusEffect(
    useCallback(() => {
      if (takeChannelSearch()) openSearch();
    }, [openSearch]),
  );
  const pickGroup = useCallback(
    (key: string) => {
      setSearchOpen(false);
      setText('');
      setPicked(key);
    },
    [setPicked],
  );
  const openSection = useCallback((x: LiveTvSection) => {
    if (providerId) router.push(x.href(group, providerId));
  }, [group, providerId]);
  const openProviders = useCallback(() => router.push(providersHref(group)), [group]);
  const switchProvider = useCallback((id: string) => {
    setSearchOpen(false);
    setText('');
    iptv.setActive(id);
  }, []);

  // Xtream: now and next load for the rows on screen (in a merged list, per provider).
  const providerRef = useRef(providerId);
  useEffect(() => {
    providerRef.current = providerId;
  }, [providerId]);
  // FlatList needs the same function for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: { item?: Channel | ProviderChannel | null }[] }) => {
    const byProvider = new Map<string, Channel[]>();
    for (const v of viewableItems) {
      const r = v.item;
      if (!r) continue;
      const pid = 'channel' in r ? r.providerId : providerRef.current;
      if (!pid) continue;
      const shownRows = byProvider.get(pid) ?? [];
      shownRows.push('channel' in r ? r.channel : r);
      byProvider.set(pid, shownRows);
    }
    for (const [pid, chs] of byProvider) iptv.requestNowNext(pid, chs);
  });

  const list = useRef<ComponentRef<typeof FlatList<Channel | ProviderChannel>>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => list.current?.getNativeScrollRef(), []));
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [groupKey, query, liveView, searching]);

  // The Live TV tab's root page has no header (`useRootScreenOptions`); opened from Home or
  // Library it is a pushed page with a plain header and a back button.
  const title = <Stack.Screen options={group === '(live)' ? { ...root, title: 'Live TV' } : { title: 'Live TV', headerLargeTitleEnabled: false }} />;

  const renderItem = useCallback(
    ({ item }: { item: Channel | ProviderChannel }) => {
      const row = rowOf(item);
      return (
        <ChannelRow
          row={row}
          favourite={favourites.has(row.key)}
          playing={row.key === playingKey}
          now={now}
          showNext={!details}
          numbered={numbered}
          providerLabel={all ? names.get(row.providerId) : undefined}
          onPlay={onPlay}
          onToggleFavourite={toggle}
          onFocusRow={onFocusRow}
        />
      );
    },
    [rowOf, favourites, playingKey, now, details, numbered, all, names, onPlay, toggle, onFocusRow],
  );

  if (!providers.length || !liveView) {
    return (
      <>
        {title}
        <TvScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[s.emptyPage, { paddingHorizontal: l.gutter, paddingBottom: bottomPad }]}>
          {isTV ? <Text style={s.tvTitle}>Live TV</Text> : null}
          <View style={s.center}>
            <View style={s.stateIcon}>
              <Icon name="tv" size={scaled(iconSize.lg)} color={c.accent} />
            </View>
            <Text style={s.emptyTitle}>Add an IPTV provider</Text>
            <Text style={s.emptyText}>
              Watch live channels from an Xtream login or an M3U playlist. Your provider gives you the details.
              {features.iptvNeedsCors ? ' In a browser, only providers that allow web pages work; the apps work with all.' : ''}
            </Text>
            <View style={s.emptyActions}>
              <Button title="Xtream login" icon="key" onPress={() => router.push(providerFormHref(group, { kind: 'xtream' }))} preferredFocus={isTV} />
              <Button title="M3U playlist" icon="list.bullet" variant="tonal" onPress={() => router.push(providerFormHref(group, { kind: 'm3u' }))} />
            </View>
          </View>
        </TvScrollView>
      </>
    );
  }

  const busy = data.status === 'loading' || data.refreshing;
  // "All providers" has no reload: each provider reloads on its own page or in Manage providers.
  const refreshButton = !providerId ? null : (
    <Touchable
      kind="icon"
      radius={radius.pill}
      disabled={busy}
      onPress={() => void iptv.refresh(providerId)}
      accessibilityRole="button"
      accessibilityLabel="Load the channel list again"
      style={s.iconButton}>
      {busy ? <ActivityIndicator color={c.text2} /> : <Icon name="arrow.clockwise" size={scaled(iconSize.sm)} color={c.text} />}
    </Touchable>
  );
  const providersButton = (
    <Touchable kind="icon" radius={radius.pill} onPress={openProviders} accessibilityRole="button" accessibilityLabel="Providers" style={s.iconButton}>
      <Icon name="gearshape" size={scaled(iconSize.sm)} color={c.text} />
    </Touchable>
  );

  const searchField = (where: 'toolbar' | 'column') => (
    <View style={[s.field, where === 'column' && s.fieldColumn, isTV && fieldFocused && s.fieldFocusedTV]}>
      <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
      <TextInput
        ref={field}
        autoFocus={isTV && where === 'column'}
        value={text}
        onChangeText={setText}
        onFocus={() => {
          setFieldFocused(true);
          if (wide) setSearchOpen(true);
        }}
        onBlur={() => setFieldFocused(false)}
        placeholder={isTV ? 'Channel name or number' : 'Search channels'}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        autoCapitalize="none"
        autoCorrect={false}
        // Android TV: keep the page in view above the keyboard, so the results show while typing.
        disableFullscreenUI
        style={s.input}
        accessibilityLabel="Search channels by name or number"
        returnKeyType="search"
      />
      {text ? (
        <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
        </Touchable>
      ) : null}
    </View>
  );

  // Phones: the provider switch as chips ("All providers" first). TV and wide windows: the browse column.
  const providerChips =
    providerEntries.length && !wide ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }]}>
        {providerEntries.map((p) => (
          <Chip
            key={p.providerId}
            label={p.label}
            icon={p.providerId === ALL_PROVIDERS ? 'square.stack' : 'tv'}
            selected={p.providerId === liveView}
            onPress={() => switchProvider(p.providerId)}
          />
        ))}
      </ScrollView>
    ) : null;

  // TV header: the title and the provider, then Search, reload and Providers.
  const tvHeader = (
    <View style={[s.tvHeader, { paddingHorizontal: l.gutter }]}>
      <View style={s.tvTitleBlock}>
        <Text style={s.tvTitle}>Live TV</Text>
        <Text style={s.tvSubtitle} numberOfLines={1}>
          {all ? `All providers · ${providers.length} providers` : [provider?.name, data.channels.length ? `${data.channels.length} channels` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Button title="Search" icon="magnifyingglass" variant="smallTonal" onPress={openSearch} />
      {refreshButton}
      {providersButton}
    </View>
  );
  const toolbar = (
    <View style={[s.toolbar, { paddingHorizontal: l.gutter }]}>
      {searchField('toolbar')}
      {refreshButton}
      {providersButton}
    </View>
  );

  // Recent searches: under the field while there is no query.
  const recentChips =
    searching && !text.trim() && recentSearches.length ? (
      <View style={s.recent}>
        <Text style={s.recentTitle}>RECENT SEARCHES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, chipRowTV()]}>
          {recentSearches.map((q) => (
            <Chip key={q} label={q} icon="clock.arrow.circlepath" onPress={() => setText(q)} accessibilityLabel={`Search again for ${q}`} />
          ))}
          <Chip label="Clear" onPress={() => iptv.clearSearches(liveView)} accessibilityLabel="Clear recent searches" />
        </ScrollView>
      </View>
    ) : null;

  // Narrow windows: the lists, sections and groups as chips.
  const groupChips = !wide ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }]}>
      {entries.map((e) => {
        if (e.kind === 'group') {
          const icon: IconName | undefined = e.key === FAVOURITES_GROUP ? 'heart.fill' : undefined;
          return <Chip key={e.key} label={e.group.label} icon={icon} selected={!searching && e.key === groupKey} onPress={() => pickGroup(e.key)} />;
        }
        if (e.kind === 'section') {
          const x = sections.find((y) => `section:${y.key}` === e.key);
          return x ? <Chip key={e.key} label={x.label} icon={x.icon} onPress={() => openSection(x)} /> : null;
        }
        return null;
      })}
    </ScrollView>
  ) : null;

  const banner =
    !all && data.error && data.channels.length ? (
      <View style={[s.banner, { marginHorizontal: l.gutter }]} accessibilityRole="alert">
        <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
        <Text style={s.bannerText} numberOfLines={3}>
          {data.error}
        </Text>
      </View>
    ) : null;

  const empty: { icon: IconName; title: string; text: string } = searching
    ? query
      ? { icon: 'magnifyingglass', title: `No channels match "${query}"`, text: 'Check the spelling, or search for the channel number.' }
      : { icon: 'magnifyingglass', title: 'Search channels', text: 'Type part of a channel name, or its number. The results show as you type.' }
    : groupKey === FAVOURITES_GROUP
      ? {
          icon: 'heart',
          title: 'No favourites yet',
          text:
            (isTV ? 'Press the menu key on a channel, or move Right to its heart, to add it here.' : 'Tap the heart on a channel, or press and hold it, to add it here.') +
            (all ? ' Favourites of every provider show here.' : ''),
        }
      : all && groupKey === RECENTS_GROUP
        ? { icon: 'clock.arrow.circlepath', title: 'Nothing watched yet', text: 'Channels you play from any provider show here, newest first.' }
        : { icon: 'tv', title: 'No channels here', text: 'This group is empty. Load the channel list again to update it.' };

  // The list's width (TV: react-native-tvos puts a list in a focus guide with no size of its
  // own, so in a row it took the width of its content).
  const listWidth = wide ? Math.max(0, l.contentWidth - l.gutter * 2 - COLUMN_WIDTH - COLUMN_GAP - (details ? DETAILS_WIDTH + COLUMN_GAP : 0)) : undefined;

  const results =
    searching && query && (searchCount || (all && mergedSearch.loading)) ? (
      <Text style={s.resultCount}>
        {searchCount >= 300 ? 'More than 300 channels match' : `${searchCount} ${searchCount === 1 ? 'channel matches' : 'channels match'}`}
        {all ? (mergedSearch.loading ? ' · loading the channel lists of every provider' : ` in ${providers.length} providers`) : ''}
      </Text>
    ) : null;

  const onNow =
    searching && query && programmes.length ? (
      <View style={s.onNow}>
        <Text style={[s.recentTitle, s.upper]} accessibilityRole="header">
          On now
        </Text>
        {programmes.map((hit) => (
          <ProgrammeRow key={hit.key} hit={hit} providerName={all ? (names.get(hit.providerId) ?? null) : null} now={now} onPlay={onPlayProgramme} />
        ))}
      </View>
    ) : null;

  const loading = !all && data.status === 'loading' && !data.channels.length;
  const failed = !all && data.status === 'error' && !data.channels.length;

  const channelsList = loading ? (
    <View style={s.flex}>
      <Text style={[s.loadingText, { paddingHorizontal: wide ? spacing.sm : l.gutter }]}>Loading the channels of {provider?.name ?? 'your provider'}. A large list can take a minute.</Text>
      <LoadingState rows={8} style={wide ? { paddingHorizontal: spacing.sm } : undefined} />
    </View>
  ) : failed ? (
    <View style={[s.center, { paddingHorizontal: l.gutter }]} accessibilityRole="alert">
      <View style={s.stateIcon}>
        <Icon name="wifi.exclamationmark" size={scaled(iconSize.lg)} color={c.danger} />
      </View>
      <Text style={s.emptyTitle}>The channels did not load</Text>
      <Text style={s.emptyText}>{data.error}</Text>
      <View style={s.emptyActions}>
        <Button title="Try again" icon="arrow.clockwise" onPress={() => providerId && void iptv.refresh(providerId)} preferredFocus={isTV} />
        <Button title="Edit provider" variant="tonal" onPress={() => providerId && router.push(providerFormHref(group, { id: providerId }))} />
      </View>
    </View>
  ) : (
    <FlatList
      ref={list}
      {...tvScroll.props}
      data={rows}
      keyExtractor={(r) => ('channel' in r ? r.key : r.id)}
      style={[s.flex, listWidth !== undefined ? { width: listWidth } : null]}
      // TV: room for the heart's focus scale and ring at the trailing edge (the list clips).
      contentContainerStyle={{ paddingLeft: wide ? 0 : l.gutter, paddingRight: isTV ? tvFocusBleed(HEART_TV) : wide ? 0 : l.gutter, paddingBottom: bottomPad, paddingTop: spacing.xs, flexGrow: 1 }}
      getItemLayout={(_d, index) => ({ length: CHANNEL_ROW_HEIGHT, offset: headerHeight + CHANNEL_ROW_HEIGHT * index, index })}
      initialNumToRender={14}
      // TV: fewer rows mounted and rendered per batch, so a slow TV stick keeps up with the D-pad.
      maxToRenderPerBatch={isTV ? 8 : 16}
      updateCellsBatchingPeriod={isTV ? 50 : undefined}
      windowSize={isTV ? 5 : 9}
      removeClippedSubviews={!isTV}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      // The search field, recent searches and the count sit in the list's header: the list must be a
      // direct child of the row (TV: its focus guide takes no size from a column around it).
      ListHeaderComponent={
        <View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h !== headerHeight) setHeaderHeight(h);
          }}>
          {wide && isTV && searchOpen ? searchField('column') : null}
          {wide ? recentChips : null}
          {onNow}
          {results}
        </View>
      }
      ListEmptyComponent={
        // Programmes but no channels: "On now" is the answer, so no "No channels match".
        onNow ? undefined : (
          <View style={[s.listEmpty, searching && s.listEmptyTop]}>
            <Icon name={empty.icon} size={scaled(iconSize.lg)} color={c.text3} />
            <Text style={s.listEmptyTitle}>{empty.title}</Text>
            <Text style={s.listEmptyText}>{empty.text}</Text>
          </View>
        )
      }
      renderItem={renderItem}
    />
  );

  return (
    <>
      {title}
      <View style={s.page}>
        {isTV ? tvHeader : toolbar}
        {providerChips}
        {!wide ? recentChips : null}
        {groupChips}
        {banner}
        {wide ? (
          <View style={[s.columns, { paddingLeft: l.gutter, paddingRight: l.gutter }]}>
            <BrowseColumn
              entries={entries}
              sections={sections}
              selected={[searching ? SEARCH_ENTRY : groupKey, providerEntryKey(liveView)]}
              width={COLUMN_WIDTH}
              bottomPad={bottomPad}
              searchRef={searchEntry}
              onSearch={isTV ? openSearch : () => field.current?.focus()}
              onGroup={pickGroup}
              onSection={openSection}
              onProviders={openProviders}
              onProvider={switchProvider}
            />
            {channelsList}
            {details && !loading && !failed ? (
              <FocusedDetails view={liveView} providerId={providerId} all={all} names={names} now={now} favourites={favourites} />
            ) : null}
          </View>
        ) : (
          channelsList
        )}
      </View>
    </>
  );
}

const EMPTY: Channel[] = [];

const wrappedRows = new WeakMap<Channel, ProviderChannel>();

/** One ProviderChannel per channel object (a channel object belongs to one provider's list). */
function wrappedRow(providerId: string, channel: Channel): ProviderChannel {
  let w = wrappedRows.get(channel);
  if (!w || w.providerId !== providerId) {
    w = asProviderChannel(providerId, channel);
    wrappedRows.set(channel, w);
  }
  return w;
}

/** TV: the details panel of the focused row. It alone follows the focus (focused-channel.ts). */
function FocusedDetails({
  view,
  providerId,
  all,
  names,
  now,
  favourites,
}: {
  view: string | null;
  providerId: string | null;
  all: boolean;
  names: ReadonlyMap<string, string>;
  now: number;
  favourites: ReadonlySet<string>;
}) {
  const shown = useFocusedChannel(view);
  return (
    <ChannelDetails
      providerId={shown?.providerId ?? providerId ?? ''}
      channel={shown?.channel ?? null}
      providerLabel={all && shown ? names.get(shown.providerId) : undefined}
      now={now}
      favourite={!!shown && favourites.has(shown.key)}
      width={DETAILS_WIDTH}
    />
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: c.bg },
  emptyPage: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, paddingVertical: spacing.huge },
  stateIcon: {
    width: scaled(72),
    height: scaled(72),
    borderRadius: radius.pill,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  emptyText: { ...font(type.body), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
  emptyActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, justifyContent: 'center' as const, marginTop: spacing.md },
  tvHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  tvTitleBlock: { flex: 1, minWidth: 0 },
  tvTitle: { ...font(type.largeTitle), color: c.text },
  tvSubtitle: { ...font(type.subheadline), color: c.text2 },
  toolbar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    // The focus border is inside the field: 4 more points keep the text clear of it.
    height: scaled(sizes.webSearchHeight) + 4,
    backgroundColor: c.surface2,
    borderRadius: radius.md + 2,
    borderCurve: 'continuous' as const,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  fieldColumn: { flex: 0, marginBottom: spacing.sm },
  // TV: a text field shows its focus as a white border (design system §7.19).
  fieldFocusedTV: { borderColor: c.text },
  input: { ...font(type.body), ...webInput, color: c.text, flex: 1, height: '100%' as const },
  iconButton: { width: scaled(sizes.iconButton), height: scaled(sizes.iconButton), alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: radius.pill },
  chips: { flexGrow: 0 },
  chipsContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  recent: { gap: spacing.xxs, marginBottom: spacing.xs },
  recentTitle: { ...font(type.caption1), fontWeight: '600' as const, letterSpacing: 0.5, color: c.text3, marginLeft: spacing.xs },
  onNow: { gap: spacing.xxs, marginBottom: spacing.sm },
  upper: { textTransform: 'uppercase' as const },
  resultCount: { ...font(type.footnote), color: c.text3, marginLeft: spacing.sm, marginBottom: spacing.xs },
  banner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface2, marginBottom: spacing.sm },
  bannerText: { ...font(type.footnote), color: c.text2, flex: 1 },
  loadingText: { ...font(type.footnote), color: c.text2, marginBottom: spacing.sm },
  listEmpty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.sm, padding: spacing.xxl },
  // A search: the message stays above the TV keyboard.
  listEmptyTop: { justifyContent: 'flex-start' as const, paddingTop: spacing.xl },
  listEmptyTitle: { ...font(type.headline), color: c.text, textAlign: 'center' as const },
  listEmptyText: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(360) },
  columns: { flex: 1, flexDirection: 'row' as const, gap: COLUMN_GAP, paddingBottom: isTV ? spacing.sm : 0 },
}));
