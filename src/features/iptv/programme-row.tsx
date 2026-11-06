/**
 * A programme in the "On now" part of a Live TV search: the channel logo,
 * the programme title, the channel, provider and times, and a thin progress
 * bar while it runs ("Starts at 20:45" before). A tap plays the first stream.
 * When several streams carry the programme (HD, FHD, backup), a trailing
 * "+N streams" button opens a sheet of the others. Both are their own
 * buttons, so on TV the row and the streams button are reached with the D-pad.
 */
import { memo, useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { OptionSheet } from '@/components/option-sheet';
import { Touchable } from '@/components/touchable';
import { type Channel, type ProgrammeHit, progressOf } from '@/iptv';
import { clock, timeRange } from '@/lib/programme-time';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles } from '@/theme';

import { ChannelLogo } from './channel-logo';

const channelLabel = (ch: Channel) => (ch.number !== undefined ? `${ch.number} ${ch.name}` : ch.name);

export const ProgrammeRow = memo(function ProgrammeRow({
  hit,
  providerName,
  now,
  onPlay,
}: {
  hit: ProgrammeHit;
  /** The provider's name, in "All providers"; null for one provider. */
  providerName: string | null;
  now: number;
  onPlay: (hit: ProgrammeHit, channel: Channel) => void;
}) {
  const s = useStyles(makeStyles);
  const [choosing, setChoosing] = useState(false);
  const first = hit.channels[0];
  const others = hit.channels.slice(1);
  const meta = [first.name, providerName, timeRange(hit.start, hit.stop)].filter(Boolean).join(' · ');
  const when = hit.onNow ? `On now, ${timeRange(hit.start, hit.stop)}` : `Starts at ${clock(hit.start)}`;
  return (
    <View style={s.wrap}>
      <Touchable
        kind="row"
        radius={radius.md}
        containerStyle={s.flex}
        onPress={() => onPlay(hit, first)}
        accessibilityRole="button"
        accessibilityLabel={[hit.title, channelLabel(first), providerName ? `from ${providerName}` : null, when].filter(Boolean).join('. ')}
        accessibilityHint={isTV ? undefined : 'Plays the channel.'}
        style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowPressed]}>
        <ChannelLogo uri={first.logo} name={first.name} size={scaled(isTV ? 36 : 40)} />
        <View style={s.body}>
          <Text style={s.title} numberOfLines={2}>
            {hit.title}
          </Text>
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
          {hit.onNow ? (
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.round(progressOf(hit, now) * 100)}%` }]} />
            </View>
          ) : (
            <Text style={s.starts} numberOfLines={1}>
              Starts at {clock(hit.start)}
            </Text>
          )}
        </View>
      </Touchable>
      {others.length ? (
        <>
          <Button
            title={`+${others.length} ${others.length === 1 ? 'stream' : 'streams'}`}
            variant="smallTonal"
            onPress={() => setChoosing(true)}
            accessibilityLabel={`Other streams of ${hit.title}`}
          />
          <OptionSheet
            visible={choosing}
            title="Other streams"
            options={others.map((ch) => ({ value: ch.id, label: channelLabel(ch) }))}
            selected={[]}
            onSelect={(id) => {
              const ch = others.find((x) => x.id === id);
              if (ch) onPlay(hit, ch);
            }}
            onClose={() => setChoosing(false)}
          />
        </>
      ) : null}
    </View>
  );
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md - 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderCurve: 'continuous' as const,
  },
  rowPressed: { backgroundColor: c.surface2 },
  body: { flex: 1, minWidth: 0, gap: sizes.tileMetaGap },
  title: { ...font(type.headline), color: c.text },
  meta: { ...font(type.subheadline), color: c.text2, fontVariant: ['tabular-nums' as const] },
  starts: { ...font(type.caption1), color: c.text3, fontVariant: ['tabular-nums' as const] },
  track: { width: scaled(72), height: sizes.resumeBar, borderRadius: sizes.resumeBar, backgroundColor: c.surface3, overflow: 'hidden' as const, marginTop: spacing.xxs },
  fill: { height: sizes.resumeBar, backgroundColor: c.accent },
}));
