import { useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { TogetherSheetHost } from '@/features/together/together-sheet';
import { useOffline, useOnlineStore } from '@/lib/online';
import { nearbySupported } from '@/together/nearby';
import { openTogetherSheet } from '@/together/store';
import { useOfflineEntries } from './use-offline-entries';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, spacing, type, useLayout, useStyles, useTheme } from '@/theme';
import { openTabRoot } from '@/features/extensions/tab-nav';

/**
 * The offline banner (design system §7.13), at the top of a tab's content
 * under the navigation bar. Dismissible; it comes back on the next change
 * to offline. With `entries` (Home), it also links to Downloads and to a
 * nearby session (see entries.ts).
 */
export function OfflineBanner({ flush, entries: withEntries }: { flush?: boolean; entries?: boolean } = {}) {
  const offline = useOffline();
  const entries = useOfflineEntries();
  const count = useOnlineStore((st) => st.offlineCount);
  const [dismissedAt, setDismissedAt] = useState(-1);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const showDownloads = withEntries && entries.downloads;
  const showJoin = withEntries && entries.joinNearby;
  // The sheet host stays mounted while the sheet is open, even if the banner hides.
  // Home (`entries`) always has it where nearby exists: a join link opens the sheet there.
  const host = showJoin || (withEntries && nearbySupported) ? <TogetherSheetHost where="join" /> : null;
  if (!offline || dismissedAt === count) return host;
  return (
    <View style={[s.wrap, { marginHorizontal: flush ? 0 : l.gutter }]}>
      <View style={s.row} accessibilityRole="alert" accessibilityLabel="Offline. Showing downloaded and cached items.">
        <Icon name="wifi.exclamationmark" size={scaled(iconSize.sm)} color={c.text2} />
        <Text style={s.text}>Offline. Showing downloaded and cached items.</Text>
        <Touchable onPress={() => setDismissedAt(count)} radius={12} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this message">
          <Icon name="xmark" size={scaled(iconSize.xs)} color={c.text2} weight="semibold" />
        </Touchable>
      </View>
      {showDownloads || showJoin ? (
        <View style={s.links}>
          {showDownloads ? (
            <Touchable onPress={() => openTabRoot('downloads')} radius={8} hitSlop={6} accessibilityRole="button">
              <Text style={s.link}>{`Downloads · ${entries.count}`}</Text>
            </Touchable>
          ) : null}
          {showJoin ? (
            <Touchable onPress={() => openTogetherSheet('join', null)} radius={8} hitSlop={6} accessibilityRole="button">
              <Text style={s.link}>Join a nearby session</Text>
            </Touchable>
          ) : null}
        </View>
      ) : null}
      {host}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: {
    gap: spacing.sm,
    backgroundColor: c.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  links: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.lg, paddingLeft: scaled(iconSize.sm) + spacing.sm },
  text: { ...font(type.footnote), color: c.text, flex: 1 },
  link: { ...font(type.footnote), fontWeight: '600' as const, color: c.accent },
}));
