/**
 * The long press menu of an extension entry with media (right click on the
 * web and in the Mac app): Play, Play from the beginning, Open and
 * Download. The rows come from `entryMenu` (`detail-view.ts`); a row runs
 * through `runEntryMenu` (`open-entry.ts`).
 */
import { type ReactNode, useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import type { FeedEntry } from '@/extensions/feeds';
import { getExtension } from '@/extensions/store';
import { TvScrollView } from '@/features/tv/page-scroll';
import { features, isTV } from '@/platform/tv';
import { createStyles, type AppTheme, iconSize, scaled, spacing, useStyles, useTheme } from '@/theme';

import { canDownload, entryMenu, type EntryMenuItem } from './detail-view';
import { useExtGroup } from './nav';
import { runEntryMenu } from './open-entry';

/** The menu rows of an entry now (the grants can change while a page is open). */
function menuOf(extId: string, entry: FeedEntry): EntryMenuItem[] {
  const ext = getExtension(extId);
  if (!ext) return [];
  return entryMenu(entry, { canDownload: canDownload(ext, features.downloads) });
}

/** True when a long press on the entry opens a menu. */
export function entryHasMenu(entry: FeedEntry): boolean {
  return !!entry.media;
}

/** `open(entry)` shows the menu of an entry; render `sheet` once in the section. */
export function useEntryMenu(extId: string): { open: (entry: FeedEntry) => void; sheet: ReactNode } {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const group = useExtGroup();
  const [shown, setShown] = useState<{ entry: FeedEntry; rows: EntryMenuItem[] } | null>(null);
  const open = useCallback(
    (entry: FeedEntry) => {
      const rows = menuOf(extId, entry);
      if (rows.length) setShown({ entry, rows });
    },
    [extId],
  );
  const close = useCallback(() => setShown(null), []);
  const sheet = (
    <Sheet visible={!!shown} title={shown?.entry.title ?? null} onClose={close}>
      <TvScrollView style={s.list} contentContainerStyle={s.content}>
        {shown ? (
          <View style={s.group}>
            {shown.rows.map((row, i) => (
              <SheetRow
                key={row.id}
                last={i === shown.rows.length - 1}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                preferredFocus={isTV && i === 0}
                onPress={() => {
                  const entry = shown.entry;
                  close();
                  runEntryMenu(extId, entry, row.id, group);
                }}>
                <Icon name={row.icon} size={scaled(iconSize.sm)} color={c.text} />
                <Text style={s.rowText} numberOfLines={1}>
                  {row.label}
                </Text>
              </SheetRow>
            ))}
          </View>
        ) : null}
      </TvScrollView>
    </Sheet>
  );
  return { open, sheet };
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  list: { flexGrow: 0 },
  content: { paddingBottom: spacing.sm },
}));
