/**
 * TV Modern look (design system §7.22): the drawing of the Home billboard.
 * The rules (which item shows, the focus rest, the preview, the text fade)
 * stay in `billboard.tsx`; this file draws only, plus the small pure rules
 * of the Modern billboard (box sizes, the facts line), which are tested.
 *
 * The backdrop runs full bleed: from the screen's left edge (under the rail)
 * and top edge, across the whole width, for 75 % of the height. Two fades,
 * each only as large as the strip it fades (a TV GPU fills few pixels a
 * second), keep the text readable: one from the left, one at the bottom.
 * The text block starts on the page edge (rail + gutter). The facts are
 * plain text: no boxed rating, no outline.
 */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { type useAnimatedStyle } from 'react-native-reanimated';

import type { BaseItemDto } from '@/api/types';
import { episodeLabel, formatDuration, remainingLabel } from '@/lib/format';
import { dark, scriptStyle, tvFont, tvm, u, withAlpha } from '@/theme';

/** TV is always dark. */
const C = dark;
const S = tvm.size;

/** The billboard box (the space above the Home rows) for a window height. */
export function modernBillboardHeight(windowHeight: number): number {
  return Math.round(windowHeight * S.billboardFactor);
}

/** The backdrop box: the whole width, from the top, `billboardArtFactor` of the height. */
export function modernArtBox(windowWidth: number, windowHeight: number): { width: number; height: number } {
  return { width: windowWidth, height: Math.round(windowHeight * S.billboardArtFactor) };
}

/**
 * The backdrop size to ask the server for: the box in pixels, capped at
 * 1920 x 1080 (Lite mode: 1280 x 720, so a TV stick decodes a small image).
 * The cap keeps the box's shape.
 */
export function modernArtRequest(box: { width: number; height: number }, pixelRatio: number, lite: boolean): { width: number; height: number } {
  const maxW = lite ? 1280 : 1920;
  const maxH = lite ? 720 : 1080;
  const w = box.width * pixelRatio;
  const h = box.height * pixelRatio;
  const k = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** The eyebrow over an episode's title (its series name): "S1 · E5 · THE LONG NIGHT". Null for other items. */
export function billboardEyebrow(item: BaseItemDto): string | null {
  if (item.Type !== 'Episode') return null;
  const text = [episodeLabel(item), item.Name].filter(Boolean).join(' · ');
  return text ? text.toUpperCase() : null;
}

/**
 * The facts line: the age rating first (drawn apart, in white), then the
 * year, the genres, the time (left, else the length) and the community
 * rating. Each fact is isolated in its own text direction, so an Arabic
 * genre does not reorder the others.
 */
export function billboardFacts(item: BaseItemDto): { rating: string | null; facts: string[] } {
  const time = remainingLabel(item) ?? (item.Type === 'Series' ? null : formatDuration(item.RunTimeTicks));
  const facts = [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.Genres?.slice(0, 2).join(', ') || null,
    time,
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null,
  ];
  const isolate = (p: string) => `⁨${p}⁩`;
  return { rating: item.OfficialRating ? isolate(item.OfficialRating) : null, facts: facts.filter((p): p is string => !!p).map(isolate) };
}

/** The logo box: at most 600 x 200 u, left aligned. */
export const MODERN_LOGO = { width: u(600), height: u(200) };

/** The title as text, when the item has no logo: `hero`, white, two lines. */
export function ModernTitleText({ title }: { title: string }) {
  return (
    <Text style={[styles.title, scriptStyle(title, styles.title, true)]} numberOfLines={2} accessibilityRole="header">
      {title}
    </Text>
  );
}

export function ModernBillboard({
  item,
  height,
  art,
  artBox,
  title,
  fade,
}: {
  item: BaseItemDto;
  height: number;
  /** The backdrop (and the preview over it), sized to fill `artBox`. */
  art: ReactNode;
  artBox: { width: number; height: number };
  /** The logo or `ModernTitleText`. */
  title: ReactNode;
  /** The text block's fade-in (an opacity on the UI thread). */
  fade: ReturnType<typeof useAnimatedStyle>;
}) {
  const eyebrow = billboardEyebrow(item);
  const { rating, facts } = billboardFacts(item);
  const fadeTop = u(324);
  return (
    <View style={[styles.root, { height }]} accessibilityLiveRegion="polite">
      {/* No key: the old backdrop stays until the new one has loaded, then cross-fades. */}
      <View style={[styles.art, artBox]}>{art}</View>
      <LinearGradient
        colors={[withAlpha(C.bg, 0.94), withAlpha(C.bg, 0.7), withAlpha(C.bg, 0)]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fade, { width: Math.min(u(1306), artBox.width), height: artBox.height }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[withAlpha(C.bg, 0), withAlpha(C.bg, 0.85), C.bg]}
        locations={[0, 0.7, 1]}
        style={[styles.fade, { top: fadeTop, width: artBox.width, height: Math.max(0, artBox.height - fadeTop) }]}
        pointerEvents="none"
      />
      {/*
        The text fades in on a view that stays mounted (no layout animation: it costs frames on a TV
        stick). The overview keeps its two lines while the full item loads, so nothing jumps.
      */}
      <Animated.View style={[styles.text, fade]}>
        {eyebrow ? (
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        {title}
        {rating || facts.length ? (
          <Text style={styles.facts} numberOfLines={1}>
            {rating ? <Text style={styles.rating}>{rating}</Text> : null}
            {facts.map((f, i) => (
              <Text key={i}>
                {rating || i > 0 ? <Text style={styles.dot}>{'  ·  '}</Text> : null}
                {f}
              </Text>
            ))}
          </Text>
        ) : null}
        <Text style={[styles.overview, item.Overview ? scriptStyle(item.Overview, styles.overview, true) : null]} numberOfLines={2}>
          {item.Overview ?? ''}
        </Text>
      </Animated.View>
    </View>
  );
}

const body = tvFont(tvm.type.body);

const styles = StyleSheet.create({
  // Visible: the art runs on below the box, under the rows (the Home rows draw over it).
  root: { overflow: 'visible' },
  art: { position: 'absolute', left: 0, top: 0 },
  fade: { position: 'absolute', left: 0, top: 0 },
  // The page edge is rail + gutter (184 u); the block ends 2 u above the box.
  text: { position: 'absolute', left: u(S.rail + S.gutter), width: u(S.heroTextWidth), bottom: u(2) },
  eyebrow: { ...tvFont(tvm.type.eyebrow), color: C.accent, textTransform: 'uppercase', marginBottom: u(10) },
  title: { ...tvFont(tvm.type.hero), color: C.text },
  facts: { ...tvFont(tvm.type.meta, { tabular: true }), color: tvm.color.onArt, marginTop: u(14) },
  rating: { color: C.text, fontWeight: '700' },
  dot: { color: withAlpha(C.text, 0.5) },
  overview: { ...body, color: tvm.color.onArt, marginTop: u(14), maxWidth: u(820), minHeight: (body.lineHeight ?? 0) * 2 },
});
