/**
 * TV Home billboard: the focused item, large, at the top of the screen (like
 * the streaming apps on TV). Tiles in the Home rows report their focus here
 * only once the focus has rested on them (`FOCUS_REST_MS`, focus-settle), so
 * a fast move along a row writes nothing, re-renders nothing and loads no
 * item or backdrop. The art keeps its 16:9 shape from the top: its
 * lower part runs on under the first row and fades into the page, so the
 * billboard's short box never crops the top of a backdrop.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { create } from 'zustand';

import { useItem, useResume } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { useImageServer } from '@/api/use-api';
import { useSessionStore } from '@/auth/session-store';
import { ItemImage } from '@/components/item-image';
import { buildImageUrl, imageSource } from '@/images/image-url';
import { resolveImage } from '@/images/resolve-image';
import { episodeLabel, formatDuration } from '@/lib/format';
import {
  type AppTheme,
  createStyles,
  font,
  motion,
  scaled,
  scriptStyle,
  sizes,
  spacing,
  tv,
  type,
  useLayout,
  useStyles,
  useTheme,
  withAlpha,
} from '@/theme';

import { tvFocusRest } from './focus-settle';

interface BillboardState {
  item: BaseItemDto | null;
}

const useBillboardStore = create<BillboardState>(() => ({ item: null }));

// Another account (or none): a focus task still waiting belongs to the old account's
// screens and API, and the billboard item to its library. Drop both.
useSessionStore.subscribe((now, before) => {
  if (now.session === before.session) return;
  tvFocusRest.cancel();
  useBillboardStore.setState({ item: null });
});

/**
 * The focus rests on a Home tile: show its item on the billboard. Call it
 * from the focus settle (features/tv/focus-settle), never on each focus.
 */
export function showOnBillboard(item: BaseItemDto): void {
  if (useBillboardStore.getState().item?.Id !== item.Id) useBillboardStore.setState({ item });
}

/** The billboard height for a window height. */
export function billboardHeight(windowHeight: number): number {
  return Math.round(windowHeight * tv.billboardFactor);
}

/** The metadata line: year, rating, length, genres (an episode: its number and name). */
function metaLine(item: BaseItemDto): string {
  if (item.Type === 'Episode') return [episodeLabel(item), item.Name].filter(Boolean).join(' · ');
  const parts = [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.OfficialRating ?? null,
    item.Type === 'Series' ? null : formatDuration(item.RunTimeTicks),
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null,
    item.Genres?.slice(0, 3).join(', ') || null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function Billboard() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const focused = useBillboardStore((st) => st.item);
  // Before any tile has the focus: the first item to continue.
  const first = useResume('Video').data?.[0] ?? null;
  // The store changes only after the focus rests (the tiles settle), so no pause here.
  const shown = focused ?? first;
  // The tiles carry no overview: the full item fills it in.
  const full = useItem(shown?.Id ?? undefined);
  const item = full.data?.Id === shown?.Id ? (full.data ?? shown) : shown;
  const height = billboardHeight(l.height);
  const width = l.contentWidth;
  const artW = Math.round(width * 0.72);
  const artH = Math.round((artW * 9) / 16);
  const server = useImageServer();
  // One backdrop at the size it shows (capped), so a focus move loads a small image.
  const scale = Math.min(PixelRatio.get(), 1.5);
  const art = item ? resolveImage(item, 'backdrop', { width: Math.round(artW * scale), height: Math.round(artH * scale) }, server) : null;
  // A movie or show with no wide art falls back to its tall poster: show all of it at the edge, not a slice.
  const tall = art?.kind === 'remote' && item?.Type !== 'Episode' && (art.source === 'Primary' || art.source === 'SeriesPrimary');

  if (!item) return <View style={{ height }} />;
  const title = (item.Type === 'Episode' ? item.SeriesName : null) ?? item.Name ?? '';
  const meta = metaLine(item);
  return (
    <View style={[s.root, { height }]} accessibilityLiveRegion="polite">
      {/* No key: the old backdrop stays until the new one has loaded, then cross-fades. */}
      <View style={[s.art, { width: artW, height: artH }]}>
        {art?.kind === 'remote' ? (
          <Image
            source={imageSource(art.uri, server)}
            style={StyleSheet.absoluteFill}
            contentFit={tall ? 'contain' : 'cover'}
            contentPosition={tall ? 'right top' : 'top'}
            transition={motion.duration.base}
            cachePolicy="memory-disk"
            priority="high"
          />
        ) : (
          <ItemImage item={item} variant="backdrop" width={artW} aspectRatio={16 / 9} rounded={0} hideArtTitle hairline={false} />
        )}
      </View>
      <View style={[s.fade, { height: artH }]} pointerEvents="none">
        {/* The art fades into the page on the left and at the bottom. */}
        <LinearGradient
          colors={[c.bg, withAlpha(c.bg, 0.85), withAlpha(c.bg, 0)]}
          locations={[0.28, 0.45, 0.75]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {/* The billboard ends at about 60% of the art: the rest fades out under the first row. */}
        <LinearGradient
          colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0.6), c.bg]}
          locations={[0.42, 0.62, 0.92]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <Animated.View key={item.Id} entering={FadeIn.duration(motion.duration.fast)} style={[s.text, { left: l.gutter, width: width * 0.46, bottom: spacing.md }]}>
        <Title item={item} title={title} />
        {meta ? (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {item.Overview ? (
          <Text style={[s.overview, scriptStyle(item.Overview, s.overview, true)]} numberOfLines={2}>
            {item.Overview}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** The server logo when there is one, else the title as text. */
function Title({ item, title }: { item: BaseItemDto; title: string }) {
  const s = useStyles(makeStyles);
  const server = useImageServer();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = item.ImageTags?.Logo
    ? { id: item.Id ?? '', tag: item.ImageTags.Logo }
    : item.ParentLogoItemId && item.ParentLogoImageTag
      ? { id: item.ParentLogoItemId, tag: item.ParentLogoImageTag }
      : null;
  const uri =
    logo && server
      ? buildImageUrl(server, { itemId: logo.id, type: 'Logo', tag: logo.tag, width: scaled(sizes.logoMaxWidth) * PixelRatio.get() })
      : null;
  if (uri && failed !== uri) {
    return (
      <View style={s.logoBox} accessible accessibilityRole="header" accessibilityLabel={title}>
        <Image source={imageSource(uri, server)} style={s.logo} contentFit="contain" contentPosition="left" onError={() => setFailed(uri)} />
      </View>
    );
  }
  return (
    <Text style={[s.title, scriptStyle(title, s.title, true)]} numberOfLines={2} accessibilityRole="header">
      {title}
    </Text>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  // Visible: the art runs on below the billboard, under the rows (the Home ScrollView draws over it).
  root: { overflow: 'visible' as const },
  art: { position: 'absolute' as const, top: 0, right: 0 },
  fade: { position: 'absolute' as const, top: 0, left: 0, right: 0 },
  text: { position: 'absolute' as const, gap: spacing.xs },
  title: { ...font(type.title1), color: c.text },
  logoBox: { width: scaled(sizes.logoMaxWidth), height: scaled(sizes.logoMaxHeight * 0.8) },
  logo: { width: '100%' as const, height: '100%' as const },
  meta: { ...font(type.headline), color: c.text2 },
  overview: { ...font(type.callout), color: c.text },
}));

/** True inside the TV Home rows: their tiles show only art and report focus to the billboard. */
export const BillboardRows = createContext(false);
