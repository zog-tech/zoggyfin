/**
 * Web pager: a horizontal scroll view with paging (touch swipe and
 * trackpad), with the same tab strip as native.
 */
import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

export function TabPager({ tabs, renderPage, initialIndex = 0, onIndexChange, select: request }: TabPagerProps) {
  const scrollRef = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));
  const position = useSharedValue(initialIndex);
  const indexRef = useRef(initialIndex);

  const select = (i: number) => {
    if (i === index) return;
    indexRef.current = i;
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
    onIndexChange?.(i);
  };

  // A selection from outside (a panel's openPage with a tab).
  const requestSeq = request?.seq;
  useEffect(() => {
    if (!request || request.index === indexRef.current || request.index < 0 || request.index >= tabs.length) return;
    select(request.index);
    scrollRef.current?.scrollTo({ x: request.index * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== width) setWidth(w);
  };

  // After the pages have their width: show the current page (the first
  // scroll, and again after a resize). The scroll event then sets `position`.
  useEffect(() => {
    if (width <= 0) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
      position.set(indexRef.current);
    }, 0);
    return () => clearTimeout(id);
  }, [width, position]);

  const onPage = (page: number) => select(page);
  const onScroll = useAnimatedScrollHandler((e) => {
    if (width <= 0) return;
    const p = e.contentOffset.x / width;
    position.set(p);
    const page = Math.round(p);
    if (page !== index) scheduleOnRN(onPage, page);
  });

  return (
    <View style={styles.flex}>
      <TabStrip
        tabs={tabs}
        index={index}
        position={position}
        onPress={(i) => {
          select(i);
          scrollRef.current?.scrollTo({ x: i * width, animated: true });
        }}
      />
      <View style={styles.flex} onLayout={onLayout}>
        <Animated.ScrollView
          ref={scrollRef as never}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          style={styles.flex}>
          {tabs.map((t, i) => (
            <View key={t.key} style={{ width, flex: 1 }}>
              {width > 0 && visited.has(i) ? renderPage(t, i) : null}
            </View>
          ))}
        </Animated.ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
