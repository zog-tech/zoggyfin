/**
 * A live channel's card in the player: number, logo, name and group, what
 * runs now with its times, a progress bar and the time left, and what comes
 * next. The zap banner, the controls ("now playing") and the channel list
 * preview show it.
 *
 * It reads the guide only. It never opens a stream to preview a channel:
 * providers often allow one connection, so a preview would stop the channel
 * that plays.
 *
 * TV Modern look (§7.22): no boxed badge, so LIVE is Ember text.
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { initials } from '@/features/iptv/channel-logo';
import { progressOf } from '@/iptv';
import { clock, timeLeft, timeRange } from '@/lib/programme-time';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import type { LiveChannelRef, LiveNowNext, LiveSource } from '@/player';
import { font, mediaColors, scaled, sizes, tv, withAlpha } from '@/theme';

import { c, radius, spacing, type } from './tokens';

const NONE: LiveNowNext = { now: null, next: null };
const MODERN = isTV && isTvModern;

/** Now and next on a channel, read again from time to time (the guide can arrive later). */
function useLiveNowNext(source: LiveSource, channelId: string): { nn: LiveNowNext; at: number } {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    // Soon after a change (an on-demand guide request), then every 15 s.
    const first = setTimeout(() => setAt(Date.now()), 1500);
    const t = setInterval(() => setAt(Date.now()), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [channelId]);
  // `at` re-reads the guide on each tick.
  const nn = source.nowNext ? source.nowNext(channelId) : NONE;
  return { nn, at };
}

export function LiveChannelCard({
  channel,
  source,
  tag,
  live,
  focused,
  style,
}: {
  channel: LiveChannelRef;
  source: LiveSource;
  /** A short note at the top right ("Playing", "Select to watch"). */
  tag?: string | null;
  /** Shows the LIVE badge (the channel that plays). */
  live?: boolean;
  /** TV: the card has the focus (white ring). */
  focused?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { nn, at } = useLiveNowNext(source, channel.id);
  const logo = scaled(isTV ? 40 : 36);
  const [failed, setFailed] = useState<string | null>(null);
  const uri = channel.logo && /^https?:\/\//i.test(channel.logo) && failed !== channel.logo ? channel.logo : null;
  const progress = nn.now ? progressOf(nn.now, at) : null;
  const label = [
    channel.number != null ? `Channel ${channel.number}` : null,
    channel.name,
    nn.now ? `Now: ${nn.now.title}, ${timeLeft(nn.now.stop, at)}` : null,
    nn.next ? `Next at ${clock(nn.next.start)}: ${nn.next.title}` : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={[styles.card, focused && styles.focused, style]} accessible accessibilityLabel={label}>
      <View style={styles.head}>
        {channel.number != null ? <Text style={styles.number}>{channel.number}</Text> : null}
        <View style={[styles.plate, { width: logo * 1.4, height: logo }]}>
          {uri ? (
            <Image source={{ uri }} style={{ width: logo * 1.3, height: logo * 0.9 }} contentFit="contain" recyclingKey={uri} cachePolicy="disk" onError={() => setFailed(uri)} />
          ) : (
            <Text style={[styles.letters, { fontSize: Math.round(logo * 0.34) }]}>{initials(channel.name)}</Text>
          )}
        </View>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={1}>
            {channel.name}
          </Text>
          {channel.group ? (
            <Text style={styles.group} numberOfLines={1}>
              {channel.group}
            </Text>
          ) : null}
        </View>
        {live && MODERN ? (
          <Text style={styles.liveWord}>LIVE</Text>
        ) : live ? (
          <View style={styles.liveBadge}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : null}
        {tag ? <Text style={styles.tag}>{tag}</Text> : null}
      </View>

      {nn.now ? (
        <View style={styles.block}>
          <Text style={styles.line} numberOfLines={1}>
            <Text style={styles.label}>NOW </Text>
            <Text style={styles.time}>{timeRange(nn.now.start, nn.now.stop)}  </Text>
            <Text style={styles.title}>{nn.now.title}</Text>
          </Text>
          <View style={styles.progressLine}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} />
            </View>
            <Text style={styles.time}>{timeLeft(nn.now.stop, at)}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.noGuide}>No guide for this channel.</Text>
      )}
      {nn.next ? (
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>NEXT </Text>
          <Text style={styles.time}>{clock(nn.next.start)}  </Text>
          <Text style={styles.nextTitle}>{nn.next.title}</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(c.surface, 0.92),
    borderWidth: isTV ? tv.focusRingWidth : 0,
    borderColor: 'transparent',
  },
  focused: { borderColor: mediaColors.white },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  number: { ...font(type.title3, { tabular: true }), color: c.text2 },
  plate: { borderRadius: radius.sm, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  letters: { fontWeight: '700', color: c.text2 },
  nameBlock: { flex: 1, minWidth: 0 },
  name: { ...font(type.headline), color: c.text },
  group: { ...font(type.footnote), color: c.text2 },
  liveBadge: { backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  liveText: { ...font(type.caption1), fontWeight: '700', color: c.onAccent, letterSpacing: 0.6 },
  liveWord: { ...font(type.caption1), fontWeight: '700', color: c.accent, letterSpacing: 0.6 },
  tag: { ...font(type.caption1), color: c.text2 },
  block: { gap: spacing.xs },
  line: { ...font(type.subheadline), color: c.text },
  label: { ...font(type.caption1), fontWeight: '700', letterSpacing: 0.6, color: c.accent },
  time: { ...font(type.caption1, { tabular: true }), color: c.text2 },
  title: { ...font(type.subheadline), fontWeight: '600', color: c.text },
  nextTitle: { ...font(type.subheadline), color: c.text },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { flex: 1, height: sizes.resumeBar, borderRadius: sizes.resumeBar, backgroundColor: c.surface3, overflow: 'hidden' },
  fill: { height: sizes.resumeBar, backgroundColor: c.accent },
  noGuide: { ...font(type.subheadline), color: c.text3 },
});
