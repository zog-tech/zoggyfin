/**
 * A swipeable pager with a tab strip that follows the swipe (native:
 * react-native-pager-view). Web uses tab-pager.web.tsx.
 *
 * The scroll position goes to a Reanimated shared value on the UI thread.
 *
 * TV has no swipe, and the native pager breaks the focus there: it keeps the
 * other pages in the window off screen, and Down from the tab strip went to
 * them (or past the page). TV shows only the selected page, in a plain view.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEventData, type PagerViewProps } from 'react-native-pager-view';
import Animated, { useEvent, useSharedValue, withTiming } from 'react-native-reanimated';

import { isTV } from '@/platform/tv';
import { motion } from '@/theme';

import { createPagerLock, PagerLockContext } from './pager-lock';
import { TabStrip } from './tab-strip';
import type { TabPagerProps } from './tab-pager-types';

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

export function TabPager(props: TabPagerProps) {
  return isTV ? <TvTabPager {...props} /> : <NativeTabPager {...props} />;
}

/** TV: the strip and the selected page only. The indicator slides to the new tab. */
function TvTabPager({ tabs, renderPage, initialIndex = 0, onIndexChange, select: request }: TabPagerProps) {
  const [index, setIndex] = useState(initialIndex);
  const position = useSharedValue(initialIndex);
  // A selection from outside: adjust the index while rendering, then move the indicator.
  const [seenSeq, setSeenSeq] = useState(request?.seq);
  if (request && request.seq !== seenSeq) {
    setSeenSeq(request.seq);
    if (request.index >= 0 && request.index < tabs.length && request.index !== index) setIndex(request.index);
  }
  // Only after a selection from outside; a press animates the indicator itself.
  useEffect(() => {
    if (seenSeq !== undefined) position.set(withTiming(index, { duration: motion.duration.base }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenSeq]);
  const tab = tabs[index];
  return (
    <View style={styles.flex}>
      <TabStrip
        tabs={tabs}
        index={index}
        position={position}
        onPress={(i) => {
          if (i === index) return;
          position.set(withTiming(i, { duration: motion.duration.base }));
          setIndex(i);
          onIndexChange?.(i);
        }}
      />
      <View key={tab?.key} style={styles.flex}>
        {tab ? renderPage(tab, index) : null}
      </View>
    </View>
  );
}

function NativeTabPager({ tabs, renderPage, initialIndex = 0, onIndexChange, select: request }: TabPagerProps) {
  const pagerRef = useRef<PagerView>(null);
  const [index, setIndex] = useState(initialIndex);
  const [visited, setVisited] = useState(() => new Set([initialIndex]));
  const position = useSharedValue(initialIndex);
  // A finger on a swipeable row stops the paging, so the row's swipe never turns the page (pager-lock.ts).
  const [lock] = useState(createPagerLock);
  useEffect(() => lock.attach((on) => pagerRef.current?.setScrollEnabled(on)), [lock]);

  const onPageScroll = useEvent<PagerViewOnPageScrollEventData>(
    (e) => {
      'worklet';
      position.set(e.position + e.offset);
    },
    ['onPageScroll'],
  );

  const select = (i: number) => {
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
    onIndexChange?.(i);
  };

  // A selection from outside (a panel's openPage with a tab): the pager reports it through onPageSelected.
  const requestSeq = request?.seq;
  useEffect(() => {
    if (!request || request.index < 0 || request.index >= tabs.length) return;
    pagerRef.current?.setPageWithoutAnimation(request.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq]);

  return (
    <View style={styles.flex}>
      <TabStrip tabs={tabs} index={index} position={position} onPress={(i) => pagerRef.current?.setPage(i)} />
      <AnimatedPagerView
        ref={pagerRef}
        style={styles.flex}
        initialPage={initialIndex}
        // Reanimated's processed handler runs on the UI thread; its type differs from the prop's.
        onPageScroll={onPageScroll as unknown as PagerViewProps['onPageScroll']}
        onPageSelected={(e: { nativeEvent: { position: number } }) => select(e.nativeEvent.position)}>
        {tabs.map((t, i) => (
          <View key={t.key} style={styles.flex} collapsable={false}>
            {visited.has(i) ? <PagerLockContext.Provider value={lock}>{renderPage(t, i)}</PagerLockContext.Provider> : null}
          </View>
        ))}
      </AnimatedPagerView>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
