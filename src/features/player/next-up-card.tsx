import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { BaseItemDto } from '@/api/types';
import { ItemImage } from '@/components/item-image';
import { Touchable } from '@/components/touchable';
import { episodeLabel } from '@/lib/format';
import { type CountdownClock, countdownClock, countdownLeft, endCountdownLeft, NEXT_UP_COUNTDOWN_SECONDS, setCountdownRunning } from '@/player/segments';
import { usePlayerStore } from '@/player/store';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { tvFont, tvm, u } from '@/theme';

import { Glass } from './glass';
import { PlayerAction } from './round-button';
import { c, motion, playerTvModern, radius, spacing, textStyle, type } from './tokens';

/**
 * TV Modern look (spec 2.8): "Play now" is the primary action and "Cancel" a
 * text action (no pill); sizes in TV units; no layout animation on TV.
 */
const MODERN = isTV && isTvModern;
const CARD = playerTvModern.card;

const RING = MODERN ? u(CARD.ring) : 36;
const STROKE = MODERN ? u(CARD.stroke) : 3;

/** How often the countdown updates (ms). The ring moves linearly between updates. */
const TICK_MS = 250;

/**
 * A ring that fills clockwise from the top as `progress` goes from 0 to 1
 * (two clipped halves, transforms only). It follows the countdown, so it
 * holds while the countdown holds.
 */
function CountdownRing({ progress }: { progress: number }) {
  const p = useSharedValue(progress);
  useEffect(() => {
    p.set(withTiming(progress, { duration: TICK_MS, easing: Easing.linear }));
  }, [p, progress]);
  const right = useAnimatedStyle(() => ({ transform: [{ rotate: `${-135 + Math.min(180, p.get() * 360)}deg` }] }));
  const left = useAnimatedStyle(() => ({ transform: [{ rotate: `${-135 + Math.max(0, Math.min(180, p.get() * 360 - 180))}deg` }] }));
  return (
    <View style={styles.ring}>
      <View style={[styles.circle, styles.track]} />
      <View style={[styles.half, { left: RING / 2 }]}>
        <Animated.View style={[styles.circle, styles.arcRight, { left: -RING / 2 }, right]} />
      </View>
      <View style={[styles.half, { left: 0 }]}>
        <Animated.View style={[styles.circle, styles.arcLeft, left]} />
      </View>
    </View>
  );
}

/** `end` mode: the time left in the video, in steps of the tick (so a position tick re-renders only the card, and not often). */
function useEndLeft(endsAt: number | undefined): number | null {
  return usePlayerStore((st) => (endsAt === undefined ? null : Math.ceil(endCountdownLeft(st.position, endsAt) * (1000 / TICK_MS)) / (1000 / TICK_MS)));
}

/**
 * The next-episode card (design-system §7.8): the next episode's thumb and a
 * 10 s countdown ring, with "Play Now" and "Cancel". When the countdown ends,
 * `onPlay` runs. The countdown holds while the video is `paused`.
 * With `endsAt` (the video's length, `end` mode) the ring shows the time left
 * in the video and the card never plays by itself: the session starts the
 * next title when the video ends. TV: "Play Now" takes the focus while the controls are
 * hidden (`preferredFocus`); Right reaches "Cancel".
 */
export function NextUpCard({
  next,
  onPlay,
  onCancel,
  autoplay,
  paused,
  endsAt,
  preferredFocus,
  onFocusChange,
}: {
  next: BaseItemDto;
  onPlay: () => void;
  onCancel: () => void;
  autoplay: boolean;
  paused: boolean;
  endsAt?: number;
  preferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [counted, setRemaining] = useState(NEXT_UP_COUNTDOWN_SECONDS);
  const endLeft = useEndLeft(endsAt);
  const atEnd = endLeft !== null;
  const remaining = endLeft ?? counted;
  const clock = useRef<CountdownClock | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    if (!autoplay || atEnd) return;
    const now = Date.now();
    clock.current = setCountdownRunning(clock.current ?? countdownClock(now, false), !paused, now);
    if (paused) return;
    const id = setInterval(() => {
      const c = clock.current;
      if (!c) return;
      const rest = countdownLeft(c, Date.now());
      setRemaining(rest);
      if (rest <= 0 && !fired.current) {
        fired.current = true;
        clearInterval(id);
        onPlay();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [autoplay, atEnd, paused, onPlay]);
  const left = Math.ceil(remaining);

  const label = [episodeLabel(next), next.Name].filter(Boolean).join(' · ');
  const ring = autoplay ? (
    <View style={styles.ringWrap} accessible={false}>
      <CountdownRing progress={1 - remaining / NEXT_UP_COUNTDOWN_SECONDS} />
      <Text style={styles.ringText}>{left}</Text>
    </View>
  ) : null;
  if (MODERN)
    return (
      <Glass variant="regular" style={styles.card}>
        <ItemImage item={next} variant="landscape" width={u(CARD.image)} aspectRatio={16 / 9} rounded={u(tvm.size.plateRadius)} hideArtTitle />
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Up Next</Text>
          <Text style={styles.title} numberOfLines={2}>
            {label || 'Next episode'}
          </Text>
          <View style={styles.actions}>
            <PlayerAction
              variant="primary"
              label="Play Now"
              accessibilityLabel={autoplay ? `Play now. Starts in ${left} seconds` : 'Play now'}
              onPress={onPlay}
              preferredFocus={preferredFocus}
              onFocusChange={onFocusChange}
            />
            <PlayerAction label="Cancel" onPress={onCancel} onFocusChange={onFocusChange} />
          </View>
        </View>
        {ring}
      </Glass>
    );
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
      <Glass variant="regular" style={styles.card}>
        <ItemImage item={next} variant="landscape" width={128} aspectRatio={16 / 9} rounded={radius.sm} hideArtTitle />
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Up Next</Text>
          <Text style={styles.title} numberOfLines={2}>
            {label || 'Next episode'}
          </Text>
          <View style={styles.actions}>
            <Touchable
              kind="button"
              radius={radius.pill}
              onPress={onPlay}
              hasTVPreferredFocus={preferredFocus}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              accessibilityRole="button"
              accessibilityLabel={autoplay ? `Play now. Starts in ${left} seconds` : 'Play now'}
              style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
              <Text style={styles.playText}>Play Now</Text>
            </Touchable>
            <Touchable
              kind="button"
              radius={radius.sm}
              onPress={onCancel}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Touchable>
          </View>
        </View>
        {autoplay ? (
          <View style={styles.ringWrap} accessible={false}>
            <CountdownRing progress={1 - remaining / NEXT_UP_COUNTDOWN_SECONDS} />
            <Text style={styles.ringText}>{left}</Text>
          </View>
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const classicStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    maxWidth: 440,
  },
  body: { flexShrink: 1, gap: spacing.xs },
  eyebrow: { ...textStyle(type.caption2), color: c.textOnMediaSecondary, textTransform: 'uppercase' },
  title: { ...textStyle(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  playText: { ...textStyle(type.subheadline), fontWeight: '600', color: '#111114' },
  cancel: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
  cancelText: { ...textStyle(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  pressed: { opacity: 0.75 },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringText: { ...textStyle(type.mono), color: c.textOnMedia, position: 'absolute', fontVariant: ['tabular-nums'] },
  ring: { width: RING, height: RING, position: 'absolute' },
  half: { position: 'absolute', top: 0, width: RING / 2, height: RING, overflow: 'hidden' },
  circle: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: STROKE },
  track: { borderColor: 'rgba(255,255,255,0.28)' },
  arcRight: { borderColor: 'transparent', borderTopColor: c.accent, borderRightColor: c.accent },
  arcLeft: { borderColor: 'transparent', borderBottomColor: c.accent, borderLeftColor: c.accent },
});

/** Modern TV: the keys that differ from Classic. */
const modernStyles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: u(CARD.gap), padding: u(CARD.pad), borderRadius: u(CARD.radius), overflow: 'hidden', maxWidth: u(CARD.width) },
  body: { flexShrink: 1, gap: u(8) },
  eyebrow: { ...tvFont(tvm.type.eyebrow), color: tvm.color.onArt, textTransform: 'uppercase' },
  title: { ...tvFont(tvm.type.rowTitle), color: c.textOnMedia },
  // The text of "Play Now" starts on the body's edge; 24 u to "Cancel" (spec 2.3).
  actions: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: u(24), marginTop: u(8) },
  ringText: { ...tvFont(tvm.type.meta, { tabular: true }), color: c.textOnMedia, position: 'absolute' },
});

const styles = MODERN ? { ...classicStyles, ...modernStyles } : classicStyles;
