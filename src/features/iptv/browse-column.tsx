/**
 * The Live TV browse column (wide windows and TV): Search, the lists
 * (Favourites, Recently watched, All channels), other sections, with two
 * providers or more "All providers" and each provider, the provider's
 * groups and Manage providers last. The order is `iptv/browse.ts`.
 * The selected entry has the `accentSoft` fill; on TV the focus adds the
 * shared row fill (§7.19). On TV the selected entry takes the first focus.
 */
import { type ComponentRef, type RefObject, useCallback, useRef } from 'react';
import { FlatList, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { useTvPageScroll } from '@/features/tv/page-scroll';
import { ALL_GROUP, ALL_PROVIDERS, type BrowseEntry, FAVOURITES_GROUP, RECENTS_GROUP } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import type { LiveTvSection } from './sections';

const GROUP_ICONS: Record<string, IconName> = {
  [FAVOURITES_GROUP]: 'heart.fill',
  [RECENTS_GROUP]: 'clock.arrow.circlepath',
  [ALL_GROUP]: 'square.grid.2x2',
};

export function BrowseColumn({
  entries,
  sections,
  selected,
  width,
  bottomPad,
  searchRef,
  onSearch,
  onGroup,
  onSection,
  onProviders,
  onProvider,
}: {
  entries: BrowseEntry[];
  sections: LiveTvSection[];
  /** The selected entries: a group key or 'search', and the key of the provider shown. */
  selected: readonly string[];
  width: number;
  bottomPad: number;
  /** The Search entry (Back from a search gives the focus back to it). */
  searchRef?: RefObject<ComponentRef<typeof View> | null>;
  onSearch: () => void;
  onGroup: (key: string) => void;
  onSection: (section: LiveTvSection) => void;
  onProviders: () => void;
  /** Switches the page to a provider, or to ALL_PROVIDERS. */
  onProvider: (providerId: string) => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const list = useRef<ComponentRef<typeof FlatList<BrowseEntry>>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => list.current?.getNativeScrollRef(), []));
  return (
    <FlatList
      ref={list}
      {...tvScroll.props}
      data={entries}
      keyExtractor={(e) => e.key}
      style={[s.column, { width }]}
      contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: spacing.xs }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        if (item.kind === 'heading') {
          return (
            <Text style={s.heading} accessibilityRole="header">
              {item.label.toUpperCase()}
            </Text>
          );
        }
        const on = selected.includes(item.key);
        let icon: IconName | null = null;
        let label = '';
        let count: number | null = null;
        let press = () => {};
        let a11y = '';
        if (item.kind === 'search') {
          icon = 'magnifyingglass';
          label = 'Search';
          press = onSearch;
          a11y = 'Search channels';
        } else if (item.kind === 'group') {
          icon = GROUP_ICONS[item.key] ?? null;
          label = item.group.label;
          count = item.group.count;
          press = () => onGroup(item.key);
          a11y = `${label}, ${count} ${count === 1 ? 'channel' : 'channels'}`;
        } else if (item.kind === 'section') {
          const section = sections.find((x) => `section:${x.key}` === item.key);
          icon = section?.icon ?? 'square.stack';
          label = item.section.label;
          press = () => {
            if (section) onSection(section);
          };
          a11y = label;
        } else if (item.kind === 'provider') {
          const all = item.providerId === ALL_PROVIDERS;
          icon = all ? 'square.stack' : 'tv';
          label = item.label;
          press = () => onProvider(item.providerId);
          a11y = all ? 'All providers: favourites, recently watched and search of every provider' : `Provider ${label}`;
        } else {
          icon = 'gearshape';
          label = 'Manage providers';
          press = onProviders;
          a11y = 'Manage providers: add, edit, reorder, reload or remove';
        }
        const end = item.kind === 'section' || item.kind === 'providers';
        return (
          <Touchable
            ref={item.kind === 'search' ? searchRef : undefined}
            kind="row"
            radius={radius.md}
            onPress={press}
            // TV: focus comes into the page on the selected entry.
            firstFocus={isTV && item.key === selected[0]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={a11y}
            containerStyle={item.kind === 'providers' ? s.providersGap : undefined}
            style={({ pressed, hovered }) => [s.row, on && s.selected, (pressed || hovered) && !on && s.pressed]}>
            {icon ? <Icon name={icon} size={scaled(iconSize.sm - 2)} color={on ? c.accent : item.key === FAVOURITES_GROUP ? c.accent : c.text2} /> : <View style={s.iconSpace} />}
            <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>
              {label}
            </Text>
            {count !== null ? <Text style={s.count}>{count}</Text> : null}
            {end ? <Icon name="chevron.right" size={scaled(iconSize.sm - 4)} color={c.text3} weight="semibold" /> : null}
          </Touchable>
        );
      }}
    />
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  column: { flexGrow: 0 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm + 2,
    minHeight: scaled(sizes.rowMin),
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xxs,
    borderCurve: 'continuous' as const,
  },
  selected: { backgroundColor: c.accentSoft },
  pressed: { backgroundColor: c.surface2 },
  iconSpace: { width: scaled(iconSize.sm - 2) },
  label: { ...font(type.body), color: c.text, flex: 1 },
  labelOn: { fontWeight: '600' as const },
  count: { ...font(type.footnote), color: c.text3, fontVariant: ['tabular-nums' as const] },
  heading: { ...font(type.caption1), fontWeight: '600' as const, letterSpacing: 0.5, color: c.text3, marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.md },
  providersGap: { marginTop: spacing.lg },
}));
