/**
 * The Live TV tile of the Library grid (iPhone, iPad, Android): Live TV
 * sits with the server's libraries as one more source, not as a banner
 * above them. It has art of its own (the accent gradient, a TV glyph and a
 * "Live" badge), since no server image exists for it. The rules of where it
 * shows are in placement.ts.
 */
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { useMergedLists, useProviders } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, mediaColors, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { liveTvHref, liveTvTab } from './nav';
import { LIVE_TV_TILE_ID, libraryTileSubtitle, showLibraryTile, withLiveTvTile } from './placement';

const ENV = { os: Platform.OS, tab: liveTvTab, tv: isTV };

/** The Library grid's items with the Live TV tile, and the tile renderer for `ItemGrid`. */
export function useLiveTvTile(views: readonly BaseItemDto[]) {
  const providers = useProviders();
  const show = showLibraryTile(ENV, providers.length);
  const { favourites } = useMergedLists(show);
  const subtitle = libraryTileSubtitle(
    providers.map((p) => p.name),
    favourites.length,
  );
  const items = useMemo(() => withLiveTvTile(views, show), [views, show]);
  const renderTile = useCallback(
    (item: BaseItemDto, tile: { width: number; preferredFocus: boolean }) =>
      item.Id === LIVE_TV_TILE_ID ? <LiveTvTile width={tile.width} subtitle={subtitle} preferredFocus={tile.preferredFocus} /> : null,
    [subtitle],
  );
  return { items, renderTile };
}

function LiveTvTile({ width, subtitle, preferredFocus }: { width: number; subtitle: string; preferredFocus: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const height = (width * 9) / 16;
  return (
    <Touchable
      kind="tile"
      radius={radius.md}
      firstFocus={preferredFocus}
      onPress={() => router.push(liveTvHref('(library)'))}
      accessibilityRole="button"
      accessibilityLabel={`Live TV, ${subtitle}`}
      containerStyle={{ width }}>
      <View style={[s.art, { width, height }]} accessibilityIgnoresInvertColors>
        <LinearGradient colors={[c.accent, c.accentPressed]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* In a View: on the web a bare svg would paint under the absolute gradient. */}
        <View>
          <Icon name="tv" size={Math.round(width * 0.2)} color={mediaColors.white} />
        </View>
        <View style={s.badge}>
          <Text style={s.badgeText}>Live</Text>
        </View>
      </View>
      <Text style={s.title} numberOfLines={1}>
        Live TV
      </Text>
      <Text style={s.meta} numberOfLines={1}>
        {subtitle}
      </Text>
    </Touchable>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  art: {
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.accent,
  },
  badge: {
    position: 'absolute' as const,
    top: sizes.badgeInset,
    left: sizes.badgeInset,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.sm,
    height: scaled(sizes.badge),
    borderRadius: radius.pill,
    backgroundColor: mediaColors.badgeFill,
  },
  badgeText: { ...font(type.caption2), color: mediaColors.white },
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
}));
