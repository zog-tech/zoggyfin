import { type ComponentRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { type FillWord, fillDirection, fillWords, wordProgress } from '@/player/audio/lyric-fill';
import { activeLine, type LyricLine, type Lyrics } from '@/player/audio/lyrics';
import { audioSession } from '@/player/audio/session';
import { type PlayerState, usePlayerStore } from '@/player/store';
import { font, hasArabic, scriptStyle, type } from '@/theme';

import { c, spacing } from '../player/tokens';

/** The current line sits this far from the top of the panel. */
const ANCHOR = 1 / 3;
/** A manual scroll stops the follow for this long. */
const FOLLOW_PAUSE_MS = 4000;
/** Scroll events for this long after our own scrollTo are not the user's. */
const OWN_SCROLL_MS = 700;
/** The clock runs on by itself for at most this long between two position updates. */
const CLOCK_RUN = 2;

/**
 * Lyrics over the blurred art (design system §7.9). Synced lyrics follow the
 * song: the sung line fills word by word (karaoke), lines already sung stay
 * lit, later lines are dim; tapping a line seeks to it. The current line
 * scrolls to a third from the top. A manual scroll stops the follow for 4 s.
 * Plain lyrics just scroll. Arabic lyrics align right and fill from the right.
 *
 * Only a line change renders the list again. The fill runs on the UI thread
 * from a clock (a shared value) that the player position sets and that runs
 * on linearly between the updates. With reduced motion the whole line lights
 * at once and the scroll does not animate.
 */
export function LyricsPanel({ lyrics }: { lyrics: Lyrics }) {
  const current = usePlayerStore((s) => activeLine(lyrics, s.position));
  const reduced = useReducedMotion();
  const clock = usePositionClock();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<number[]>([]);
  const [height, setHeight] = useState(0);
  const userScrollAt = useRef(0);
  const ownScrollAt = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rtl = useMemo(() => lyrics.lines.some((l) => hasArabic(l.text)), [lyrics]);
  const words = useMemo(() => (lyrics.synced ? lyrics.lines.map((_, i) => fillWords(lyrics.lines, i)) : []), [lyrics]);

  const follow = useCallback(
    (force = false) => {
      if (!lyrics.synced || !height) return;
      if (!force && Date.now() - userScrollAt.current < FOLLOW_PAUSE_MS) return;
      const y = current < 0 ? 0 : offsets.current[current];
      if (y === undefined) return;
      ownScrollAt.current = Date.now();
      scroll.current?.scrollTo({ y: Math.max(0, y - height * ANCHOR), animated: !reduced });
    },
    [current, height, lyrics.synced, reduced],
  );

  useEffect(() => {
    follow();
  }, [follow]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  // Our own scrollTo also sends scroll events; only the others are the user's.
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  const onUserScroll = useCallback(() => {
    userScrollAt.current = Date.now();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => followRef.current(), FOLLOW_PAUSE_MS + 50);
  }, []);

  const onLine = useCallback((i: number, e: LayoutChangeEvent) => {
    offsets.current[i] = e.nativeEvent.layout.y;
  }, []);

  const seek = useCallback((start: number) => {
    userScrollAt.current = 0;
    audioSession().seekTo(start);
  }, []);

  return (
    <View style={styles.root} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingBottom: height * 0.6 }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScrollBeginDrag={onUserScroll}
        onScroll={() => {
          if (Date.now() - ownScrollAt.current > OWN_SCROLL_MS) onUserScroll();
        }}>
        {lyrics.lines.map((line, i) =>
          lyrics.synced && line.start !== null ? (
            <SyncedLine
              key={i}
              index={i}
              line={line}
              words={words[i] ?? []}
              state={i < current ? 'past' : i === current ? 'active' : 'future'}
              fill={!reduced}
              alignRight={rtl}
              clock={clock}
              onLine={onLine}
              onSeek={seek}
            />
          ) : (
            <View key={i} onLayout={(e) => onLine(i, e)} style={styles.lineBox}>
              <Text style={[styles.plain, rtl && styles.rtl, scriptStyle(line.text, styles.plain, true)]}>{line.text || '♪'}</Text>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The player position as a UI-thread clock: each position update (about
 * every 500 ms) sets it, and while the song plays it runs on linearly at
 * the playback rate, for at most `CLOCK_RUN` seconds. No React render.
 */
function usePositionClock(): SharedValue<number> {
  const clock = useSharedValue(usePlayerStore.getState().position);
  useEffect(() => {
    const sync = (st: PlayerState) => {
      cancelAnimation(clock);
      if (st.playing && st.status !== 'buffering' && st.status !== 'loading') {
        const rate = st.rate > 0 ? st.rate : 1;
        clock.value = withSequence(
          withTiming(st.position, { duration: 0 }),
          withTiming(st.position + CLOCK_RUN, { duration: (CLOCK_RUN / rate) * 1000, easing: Easing.linear }),
        );
      } else {
        clock.value = st.position;
      }
    };
    sync(usePlayerStore.getState());
    return usePlayerStore.subscribe((st, prev) => {
      if (st.position !== prev.position || st.playing !== prev.playing || st.rate !== prev.rate || st.status !== prev.status) sync(st);
    });
  }, [clock]);
  return clock;
}

type LineState = 'past' | 'active' | 'future';

interface SyncedLineProps {
  index: number;
  line: LyricLine;
  words: FillWord[];
  state: LineState;
  fill: boolean;
  alignRight: boolean;
  clock: SharedValue<number>;
  onLine: (i: number, e: LayoutChangeEvent) => void;
  onSeek: (start: number) => void;
}

/**
 * One synced line as a row of words, in every state, so the line keeps the
 * same layout when it becomes the sung line. The sung line lays a lit copy
 * of each word over the dim one and widens its clip as the word is sung.
 */
const SyncedLine = memo(function SyncedLine({ index, line, words, state, fill, alignRight, clock, onLine, onSeek }: SyncedLineProps) {
  const dir = fillDirection(line.text);
  const base = state === 'future' || (state === 'active' && fill) ? styles.line : styles.lineLit;
  const script = scriptStyle(line.text, styles.line, true);
  const wordStyle: TextStyle[] = [base, ...(script ? [script] : [])];
  const litStyle: TextStyle[] = [styles.lineLit, ...(script ? [script] : [])];
  const start = line.start ?? 0;
  return (
    <Pressable
      onLayout={(e) => onLine(index, e)}
      style={styles.lineBox}
      onPress={() => onSeek(start)}
      accessibilityRole="button"
      accessibilityLabel={line.text || undefined}
      accessibilityHint="Plays from this line">
      <View
        style={[
          styles.words,
          dir === 'rtl' ? styles.wordsRtl : null,
          // Row-reverse puts its start on the right.
          alignRight === (dir === 'rtl') ? styles.alignStart : styles.alignEnd,
        ]}>
        {words.map((w, j) =>
          state === 'active' && fill ? (
            <FillingWord key={j} word={w} dir={dir} clock={clock} dimStyle={wordStyle} litStyle={litStyle} />
          ) : (
            <Text key={j} style={wordStyle}>
              {w.text}
            </Text>
          ),
        )}
      </View>
    </Pressable>
  );
});

function FillingWord({
  word,
  dir,
  clock,
  dimStyle,
  litStyle,
}: {
  word: FillWord;
  dir: 'ltr' | 'rtl';
  clock: SharedValue<number>;
  dimStyle: TextStyle[];
  litStyle: TextStyle[];
}) {
  const [width, setWidth] = useState(0);
  const { start, end } = word;
  const clip = useAnimatedStyle(() => ({ width: width * wordProgress(start, end, clock.value) }));
  const side = dir === 'rtl' ? styles.right : styles.left;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text style={dimStyle}>{word.text}</Text>
      <Animated.View style={[styles.clip, side, clip]} pointerEvents="none">
        {/* One pixel more than the word, so the lit copy never wraps or cuts its last letter. */}
        <Text style={[...litStyle, styles.litCopy, side, { width: width + 1 }]}>{word.text}</Text>
      </Animated.View>
    </View>
  );
}

const lineText = font(type.title2);
const wordGap = Math.round((lineText.fontSize ?? 22) * 0.28);

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: spacing.md, paddingTop: spacing.lg },
  lineBox: { paddingVertical: spacing.xs },
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: wordGap },
  wordsRtl: { flexDirection: 'row-reverse' },
  alignStart: { justifyContent: 'flex-start' },
  alignEnd: { justifyContent: 'flex-end' },
  line: { ...lineText, color: 'rgba(255,255,255,0.45)' },
  lineLit: { ...lineText, color: c.textOnMedia },
  plain: { ...font(type.title3), color: c.textOnMediaSecondary },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  clip: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  left: { left: 0 },
  right: { right: 0 },
  litCopy: { position: 'absolute', top: 0 },
});
