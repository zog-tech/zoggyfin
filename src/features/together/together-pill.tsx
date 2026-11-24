/**
 * The "Together" indicator in the video and music players: who is in the
 * session and whether the group waits. Tapping it opens the session sheet.
 * `TogetherChip` is the compact form for the mini player.
 * TV Modern look (design system §7.22): no pill and no glass; the indicator
 * is flat text with a glyph, and the focus plate shows behind it.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { Glass } from '@/features/player/glass';
import { c, radius, spacing, textStyle, type } from '@/features/player/tokens';
import { PlateIcon, TvFocusPlate, TvPlateText } from '@/features/tv/tv-button';
import { openFullPlayer } from '@/player';
import { playerState } from '@/player/store';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, tvFont, tvm, u, useStyles, useTheme } from '@/theme';
import { openTogetherSheet, type TogetherState, useTogetherStore } from '@/together/store';
import { groupCount } from '@/together/syncplay-logic';

const MODERN = isTV && isTvModern;

/** The pill text for a state, or null when no session runs. */
export function togetherLabel(s: TogetherState): string | null {
  if (s.syncplay.group) {
    const n = groupCount(s.syncplay.group);
    if (s.waiting) return 'Together · Waiting for everyone';
    return n === null ? 'Together' : `Together · ${n} ${n === 1 ? 'person' : 'people'}`;
  }
  if (s.mode !== 'nearby') return null;
  switch (s.phase.name) {
    case 'hosting': {
      const n = s.members.length + 1;
      if (s.requests.length) return `Together · ${s.requests.length} want to join`;
      if (s.members.some((m) => m.away)) return 'Together · Reconnecting…';
      return s.waiting ? 'Together · Waiting for everyone' : `Together · ${n} ${n === 1 ? 'person' : 'people'}`;
    }
    case 'syncing':
      return 'Together · Connecting';
    case 'joined':
      return s.waiting ? 'Together · Waiting for everyone' : `Together · with ${s.hostName ?? 'the host'}`;
    case 'reconnecting':
      return s.phase.waitingForHost ? 'Together · Waiting for the host' : 'Together · Reconnecting…';
    case 'ended':
      return 'Together · Ended';
    default:
      return null;
  }
}

export function TogetherPill({
  top,
  left,
  right,
  onPress,
}: {
  top: number;
  left?: number;
  right?: number;
  onPress: () => void;
}) {
  const label = useTogetherStore(togetherLabel);
  if (!label) return null;
  if (MODERN) {
    return (
      <Touchable kind="plain" ring={false} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. Open the session.`} containerStyle={[styles.wrap, { top, left, right }]}>
        <View style={modern.row}>
          <TvFocusPlate />
          <PlateIcon name="person.2.fill" size={u(24)} rest={c.textOnMedia} />
          <TvPlateText style={modern.text} rest={c.textOnMedia}>
            {label}
          </TvPlateText>
        </View>
      </Touchable>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. Open the session.`} style={[styles.wrap, { top, left, right }]}>
      <Glass style={styles.pill}>
        <Icon name="person.2.fill" size={14} color={c.textOnMedia} />
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </Glass>
    </Pressable>
  );
}

/** The short chip text: "Reconnecting…", "Waiting" or "Together". */
function shortLabel(label: string): string {
  if (label.endsWith('Reconnecting…')) return 'Reconnecting…';
  if (label.includes('Waiting')) return 'Waiting';
  return 'Together';
}

/** Mini player: opens the full player and the session sheet on it. */
function openFromMini(): void {
  const audio = playerState().now?.kind === 'audio';
  openFullPlayer();
  setTimeout(() => openTogetherSheet(audio ? 'music' : 'player', null), 350);
}

/** The compact session chip for the mini player. `iconOnly` for the inline accessory. */
export function TogetherChip({ iconOnly = false }: { iconOnly?: boolean }) {
  const label = useTogetherStore(togetherLabel);
  const s = useStyles(makeChipStyles);
  const { c: tc } = useTheme();
  if (!label) return null;
  return (
    <Pressable
      onPress={openFromMini}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open the session.`}
      style={({ pressed }) => [s.chip, iconOnly && s.iconOnly, pressed && { backgroundColor: tc.surface3 }]}>
      <Icon name="person.2.fill" size={13} color={tc.accent} />
      {iconOnly ? null : (
        <Text style={s.text} numberOfLines={1}>
          {shortLabel(label)}
        </Text>
      )}
    </Pressable>
  );
}

const modern = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: u(12), height: u(tvm.size.toolbarItemHeight), paddingHorizontal: u(tvm.size.toolbarPadX) },
  text: { ...tvFont(tvm.type.toolbar), fontWeight: '600' },
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    minHeight: 32,
  },
  text: { ...textStyle(type.footnote), fontWeight: '600', color: c.textOnMedia },
});

const makeChipStyles = createStyles(({ c: tc }: AppTheme) => ({
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    height: 28,
    maxWidth: 120,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: tc.surface2,
  },
  iconOnly: { width: 28, paddingHorizontal: 0, justifyContent: 'center' as const },
  text: { ...font(type.caption1), fontWeight: '600' as const, color: tc.text },
}));
