/**
 * The length of a video on its art ("12:34"), at the bottom right, in the
 * tile badge style (design system §7.3). It sits above a progress bar when
 * the art has one. Plain view: it reads no focus state (TV rules, §2.8a).
 * The caller puts `lengthLabel()` into its accessibility label.
 */
import { Text, View } from 'react-native';

import { formatClockSeconds } from '@/lib/format';
import { createStyles, font, mediaColors, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

export function LengthPill({ seconds, aboveProgress = false }: { seconds: number | null | undefined; aboveProgress?: boolean }) {
  const s = useStyles(makeStyles);
  const text = formatClockSeconds(seconds);
  if (!text) return null;
  return (
    <View style={[s.pill, aboveProgress && s.aboveProgress]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text style={s.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const makeStyles = createStyles(() => ({
  pill: {
    position: 'absolute' as const,
    right: scaled(sizes.badgeInset),
    bottom: scaled(sizes.badgeInset),
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
    backgroundColor: mediaColors.badgeFill,
  },
  aboveProgress: { bottom: scaled(sizes.progressInset + sizes.progress) + spacing.xs },
  text: { ...font(type.caption2, { tabular: true }), fontWeight: '600' as const, color: mediaColors.white },
}));
