/**
 * The Live TV row on Home: the favourite channels, then the channels
 * watched last, and an "All channels" tile that opens Live TV. A tap on a
 * channel plays it at once; channel up and down move through the row.
 * It shows only when the account has a provider (placement.ts), so it
 * also keeps the iOS rule: nothing about Live TV before a provider exists.
 */
import { router } from 'expo-router';
import { Platform, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { RowHeader } from '@/components/item-row';
import { Touchable } from '@/components/touchable';
import { type ProviderChannel, useMergedLists, usePlayMerged, useProviders } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { ChannelLogo } from './channel-logo';
import { liveTvHref, liveTvTab, useLiveGroup } from './nav';
import { homeRowChannels, showHomeRow } from './placement';

const ENV = { os: Platform.OS, tab: liveTvTab, tv: isTV };

export function LiveTvHomeRow() {
  const providers = useProviders();
  const show = showHomeRow(ENV, providers.length);
  // Hooks run before the check below, so the row keeps the same hooks when a provider is added.
  const { favourites, recents } = useMergedLists(show);
  const play = usePlayMerged();
  const group = useLiveGroup();
  const s = useStyles(makeStyles);
  const l = useLayout();
  if (!show) return null;
  const channels = homeRowChannels(favourites, recents);
  const many = providers.length > 1;
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name;
  const width = l.rowTile.thumb;
  const openAll = () => router.push(liveTvHref(group));
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title="Live TV" onSeeAll={openAll} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        contentContainerStyle={[s.row, { paddingHorizontal: l.gutter, gap: l.gap }]}>
        {channels.map((ch) => (
          <ChannelTile
            key={ch.key}
            channel={ch}
            width={width}
            subtitle={many ? nameOf(ch.providerId) : ch.channel.group || undefined}
            // Channel up and down move through the channels of this row.
            onPress={() => play(channels, ch)}
          />
        ))}
        <AllChannelsTile width={width} onPress={openAll} />
      </ScrollView>
    </View>
  );
}

function ChannelTile({ channel, width, subtitle, onPress }: { channel: ProviderChannel; width: number; subtitle?: string; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const height = (width * 9) / 16;
  const name = channel.channel.name;
  return (
    <Touchable
      kind="tile"
      radius={radius.md}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[name, subtitle].filter(Boolean).join(', ')}
      accessibilityHint="Plays the channel"
      containerStyle={{ width }}>
      <View style={[s.art, { width, height }]}>
        <ChannelLogo uri={channel.channel.logo} name={name} size={Math.round(height * 0.55)} />
      </View>
      <Text style={s.title} numberOfLines={1}>
        {name}
      </Text>
      <Text style={s.meta} numberOfLines={1}>
        {subtitle ?? ' '}
      </Text>
    </Touchable>
  );
}

function AllChannelsTile({ width, onPress }: { width: number; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const height = (width * 9) / 16;
  return (
    <Touchable kind="tile" radius={radius.md} onPress={onPress} accessibilityRole="button" accessibilityLabel="All channels" containerStyle={{ width }}>
      <View style={[s.art, s.all, { width, height }]}>
        <Icon name="square.grid.2x2" size={scaled(iconSize.lg)} color={c.accent} />
        <Text style={s.allText}>All channels</Text>
      </View>
    </Touchable>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  row: { paddingVertical: spacing.xs },
  art: {
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    // The logo plate is surface2 too: the logo sits on the card, like generated art on a tile.
    backgroundColor: c.surface2,
  },
  all: { gap: spacing.sm, backgroundColor: c.accentSoft },
  allText: { ...font(type.headline), color: c.accent },
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
}));
