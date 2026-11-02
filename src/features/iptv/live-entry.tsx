/**
 * The way into Live TV where it is not a tab (iPhone, iPad, Android): a row
 * at the top of the Library tab. See nav.ts for why.
 *
 * On iOS the row shows only after a provider is added in Settings. The App
 * Store build is a Jellyfin client first, and the app ships no channels of
 * its own, so an empty Live TV row at the top of the Library only confuses.
 */
import { router } from 'expo-router';
import { Platform, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { useProviders } from '@/iptv';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { liveTvHref, liveTvTab } from './nav';

export function LiveTvEntry() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const providers = useProviders();
  if (liveTvTab || isTV) return null;
  if (Platform.OS === 'ios' && !providers.length) return null;
  const detail = providers.length
    ? providers.map((p) => p.name).join(', ')
    : 'Add an IPTV provider to watch live channels';
  return (
    <Touchable
      kind="row"
      radius={radius.lg}
      onPress={() => router.push(liveTvHref('(library)'))}
      accessibilityRole="button"
      accessibilityLabel={`Live TV. ${detail}`}
      containerStyle={s.wrap}
      style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.pressed]}>
      <View style={s.icon}>
        <Icon name="tv" size={scaled(iconSize.md)} color={c.accent} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>Live TV</Text>
        <Text style={s.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
    </Touchable>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { marginBottom: spacing.lg },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.rowMedia),
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
    borderCurve: 'continuous' as const,
  },
  pressed: { backgroundColor: c.surface2 },
  icon: { width: scaled(36), height: scaled(36), borderRadius: radius.md, backgroundColor: c.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  body: { flex: 1, minWidth: 0 },
  title: { ...font(type.headline), color: c.text },
  detail: { ...font(type.footnote), color: c.text2 },
}));
