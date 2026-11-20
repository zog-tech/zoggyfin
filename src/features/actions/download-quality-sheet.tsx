/**
 * The "Download quality" sheet: Download on a single film, episode or video
 * asks for the quality of that one download. Each row shows the size (the
 * original) or an estimate (a smaller copy). Picking a row starts the
 * download; closing the sheet starts nothing. The rules for the rows are in
 * `downloads/quality-choice.ts`; the open state in `download-quality-store.ts`.
 *
 * Containers and audio never open it: they use the "Download quality"
 * setting, as before.
 */
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { downloadQualityChoices, downloads } from '@/downloads';
import { TvScrollView } from '@/features/tv/page-scroll';
import { usePlaybackSettings } from '@/settings/playback';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { closeDownloadQuality, takeDownloadQualityItem, useDownloadQualitySheet } from './download-quality-store';

export function DownloadQualityHost() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const item = useDownloadQualitySheet((st) => st.item);
  const setting = usePlaybackSettings((st) => st.downloadQuality);
  // Keep the last item while the sheet slides away, so its rows do not empty.
  const [shown, setShown] = useState<BaseItemDto | null>(item);
  if (item && item !== shown) setShown(item);
  const { choices, selected } = useMemo(() => downloadQualityChoices(shown ?? {}, setting), [shown, setting]);

  return (
    <Sheet visible={!!item} title="Download quality" onClose={closeDownloadQuality} doneLabel="Cancel">
      <TvScrollView style={s.list} contentContainerStyle={s.content}>
        <View style={s.group}>
          {choices.map((o, i) => {
            const on = o.value === selected;
            return (
              <SheetRow
                key={o.value}
                last={i === choices.length - 1}
                accessibilityRole="button"
                accessibilityLabel={o.detail ? `${o.label}, ${o.detail}` : o.label}
                onPress={() => {
                  const it = takeDownloadQualityItem();
                  if (it) void downloads.download(it, { quality: o.value });
                }}>
                <View style={s.text}>
                  <Text style={[s.rowText, on && s.rowOn]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {o.detail ? (
                    <Text style={s.detail} numberOfLines={1}>
                      {o.detail}
                    </Text>
                  ) : null}
                </View>
                {on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
              </SheetRow>
            );
          })}
        </View>
        <Text style={s.footer}>
          The server makes the smaller copies. If the connection drops, a smaller copy starts again from the beginning. The original continues where it stopped.
        </Text>
      </TvScrollView>
    </Sheet>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  list: { flexGrow: 0 },
  content: { paddingBottom: spacing.sm },
  text: { flex: 1, paddingVertical: spacing.sm },
  rowOn: { color: t.c.accent },
  detail: { ...font(type.footnote), color: t.c.text2 },
  footer: { ...font(type.footnote), color: t.c.text2, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
}));
