import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PlateIcon, TvFocusPlate, TvPlateText } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, dark, font, iconSize, radius, scaled, sizes, spacing, tvFocusBleed, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

import { Icon, type IconName } from './icon';
import { Touchable } from './touchable';

const MODERN = isTV && isTvModern;

export interface ChipProps {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

/**
 * A filter chip (design system §7.17): 32 pt pill, `surface2`; selected is a `text` fill with `bg` text.
 * TV Modern (§7.22) has no chip shape: a chip draws as a toolbar item (`ModernChip`).
 */
export const Chip: (props: ChipProps) => ReactElement = MODERN ? ModernChip : ClassicChip;

function ClassicChip({ label, icon, selected, onPress, accessibilityLabel }: ChipProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const fg = selected ? c.bg : c.text;
  return (
    <Touchable
      kind="button"
      radius={radius.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [s.chip, { backgroundColor: selected ? c.text : pressed ? c.surface3 : c.surface2 }]}>
      {icon ? <Icon name={icon} size={scaled(iconSize.sm - 3)} color={fg} weight="semibold" /> : null}
      <Text style={[s.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

const makeStyles = createStyles((_: AppTheme) => ({
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs + 2,
    height: scaled(sizes.chipHeight),
    paddingHorizontal: scaled(spacing.md),
    borderRadius: radius.pill,
  },
  label: { ...font(type.subheadline), fontWeight: '500' as const },
}));

/**
 * TV: room in a horizontal chip row (a clipping ScrollView) for the focus
 * scale and ring of a chip: above, below and between the chips. Null elsewhere.
 * Modern: a chip is a toolbar item with its plate inside its box and no
 * scale, so the row needs no room, only the toolbar gap.
 */
export function chipRowTV(): { paddingVertical: number; gap: number } | null {
  if (!isTV) return null;
  if (MODERN) return { paddingVertical: 0, gap: u(tvm.size.toolbarGap) };
  return { paddingVertical: tvFocusBleed(scaled(sizes.chipHeight)), gap: spacing.xl };
}

// ---------------------------------------------------------------------------
// TV Modern look: a text control with the focus plate (no fill at rest, no outline).
// ---------------------------------------------------------------------------

const C = dark;
const GLYPH = u(24);

/**
 * A chip as a toolbar item: an optional glyph and the label. `selected` true
 * is a filter that is on (a check glyph and weight 700); `selected` false is
 * one that is off (quiet, weight 500); no `selected` is a plain command
 * ("Name", "Ascending") in white. The plate shows with the focus; no scale.
 */
function ModernChip({ label, icon, selected, onPress, accessibilityLabel }: ChipProps) {
  const off = selected === false;
  const glyph: IconName | undefined = selected ? 'checkmark' : icon;
  return (
    <Touchable
      kind="plain"
      ring={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}>
      <View style={m.item}>
        <TvFocusPlate />
        {glyph ? <PlateIcon name={glyph} size={GLYPH} rest={off ? C.text2 : C.text} /> : null}
        <TvPlateText style={[m.label, selected && m.on, off && m.off]} rest={off ? C.text2 : C.text}>
          {label}
        </TvPlateText>
      </View>
    </Touchable>
  );
}

const m = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: u(14), height: u(tvm.size.toolbarItemHeight), paddingHorizontal: u(tvm.size.toolbarPadX) },
  label: { ...tvFont(tvm.type.toolbar) },
  on: { fontWeight: '700' },
  off: { fontWeight: '500' },
});
