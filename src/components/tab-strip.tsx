import { type ComponentRef, type ReactElement, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, ScrollView, View } from 'react-native';
import Animated, { Extrapolation, interpolate, interpolateColor, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { TvTab } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, scaled, sizes, tv, type, useLayout, useStyles, useTheme } from '@/theme';

import type { PagerTab } from './tab-pager-types';
import { Touchable } from './touchable';
import { TvToolbarRow } from './tv-page-header';

interface Layout {
  x: number;
  width: number;
}

export interface TabStripProps {
  tabs: PagerTab[];
  index: number;
  position: SharedValue<number>;
  onPress: (index: number) => void;
}

/**
 * The tab strip over a pager (design system §7.7). `position` is the pager's
 * live position (page index plus fraction), so the 3 pt `accent` bar and the
 * label colours follow the finger on the UI thread, with no React render.
 * TV Modern (§7.22): text tabs (`TvTab`) in one line with the Ember
 * underline under the current one and the focus plate; no hairline.
 */
export const TabStrip: (props: TabStripProps) => ReactElement = isTV && isTvModern ? ModernTabStrip : ClassicTabStrip;

/** TV Modern: the tabs move only on a press, so the current tab is plain props (no swipe to follow). */
function ModernTabStrip({ tabs, index, onPress }: TabStripProps) {
  const l = useLayout();
  return (
    <View style={{ paddingHorizontal: l.gutter }} accessibilityRole="tablist">
      <TvToolbarRow inset={l.gutter} tabs>
        {tabs.map((t, i) => (
          <TvTab key={t.key} label={t.title} selected={i === index} onPress={() => onPress(i)} />
        ))}
      </TvToolbarRow>
    </View>
  );
}

function ClassicTabStrip({ tabs, index, position, onPress }: TabStripProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const [layouts, setLayouts] = useState<(Layout | undefined)[]>([]);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const ready = layouts.length === tabs.length && layouts.every(Boolean);

  useEffect(() => {
    const t = layouts[index];
    if (t) scrollRef.current?.scrollTo({ x: Math.max(0, t.x - l.gutter * 2), animated: true });
  }, [index, layouts, l.gutter]);

  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => {
      const next = [...prev];
      next[i] = { x, width };
      return next;
    });
  };

  const inputRange = tabs.map((_, i) => i);
  const xs = layouts.map((t) => t?.x ?? 0);
  const widths = layouts.map((t) => t?.width ?? 0);
  const showIndicator = ready && tabs.length > 1;
  // An absolute, childless bar: its width can animate without a layout pass for anything else.
  const indicator = useAnimatedStyle(() => {
    if (!showIndicator) return { opacity: 0 };
    const p = position.get();
    return {
      opacity: 1,
      width: interpolate(p, inputRange, widths, Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(p, inputRange, xs, Extrapolation.CLAMP) }],
    };
  });

  return (
    <View style={s.wrap} accessibilityRole="tablist">
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // TV: room above and below for the focus ring.
        contentContainerStyle={{ paddingHorizontal: l.gutter, paddingVertical: isTV ? tv.focusRingWidth + tv.focusRingGap + 2 : 0 }}>
        <View style={s.inner}>
          {tabs.map((t, i) => (
            <Touchable
              key={t.key}
              onLayout={onLayout(i)}
              onPress={() => onPress(i)}
              radius={6}
              accessibilityRole="tab"
              accessibilityLabel={t.title}
              accessibilityState={{ selected: i === index }}
              style={s.tab}>
              <Label title={t.title} index={i} position={position} from={c.text2} to={c.text} />
            </Touchable>
          ))}
          {tabs.length > 1 ? <Animated.View style={[s.indicator, indicator]} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Label({ title, index, position, from, to }: { title: string; index: number; position: SharedValue<number>; from: string; to: string }) {
  const s = useStyles(makeStyles);
  const color = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(position.get() - index));
    return { color: interpolateColor(d, [0, 1], [to, from]) };
  });
  return <Animated.Text style={[s.label, color]}>{title}</Animated.Text>;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  inner: { flexDirection: 'row' as const, gap: scaled(sizes.pagerGap) },
  tab: { height: scaled(sizes.pagerStripHeight), justifyContent: 'center' as const },
  label: { ...font(type.subheadline), fontWeight: '600' as const },
  indicator: {
    position: 'absolute' as const,
    left: 0,
    bottom: 0,
    height: sizes.pagerIndicator,
    borderRadius: sizes.pagerIndicator / 2,
    backgroundColor: c.accent,
  },
}));
