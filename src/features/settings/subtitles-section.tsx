/**
 * Settings, Subtitles: text size, colour, background and position, with a
 * live preview line drawn by the same code as the player (`SubtitleLines`).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { type Option, OptionSheet } from '@/components/option-sheet';
import { SubtitleLines } from '@/features/player/subtitle-overlay';
import { player } from '@/features/player/tokens';
import { isDesktop } from '@/platform/desktop';
import {
  optionLabel,
  SUBTITLE_BACKGROUND_OPTIONS,
  SUBTITLE_COLOR_OPTIONS,
  SUBTITLE_POSITION_OPTIONS,
  SUBTITLE_SIZE_OPTIONS,
  subtitleBottom,
  type SubtitleAppearance,
} from '@/settings/subtitle-style';
import { useSubtitleAppearance, useSubtitleSettings } from '@/settings/subtitles';
import { scaled, spacing, TYPE_SCALE } from '@/theme';

import { Group, SettingsRow } from './rows';

type Field = keyof SubtitleAppearance;

const FIELDS: Record<Field, { title: string; options: readonly { value: string; label: string }[] }> = {
  size: { title: 'Text size', options: SUBTITLE_SIZE_OPTIONS },
  color: { title: 'Text colour', options: SUBTITLE_COLOR_OPTIONS },
  background: { title: 'Background', options: SUBTITLE_BACKGROUND_OPTIONS },
  position: { title: 'Position', options: SUBTITLE_POSITION_OPTIONS },
};

/** What this platform cannot style (see `subtitle-style.ts` and `engine-subtitle-style`). */
const FOOTER = isDesktop
  ? 'Styled subtitles (ASS) keep their own colours, background and position. Their size still follows the setting.'
  : Platform.OS === 'web'
    ? 'In Firefox, subtitles inside a Live TV stream or an IPTV film keep their position.'
    : 'Subtitles inside a Live TV stream or an IPTV film use the caption settings of this device, not these settings.';

const PREVIEW_HEIGHT = 132;
const PREVIEW_BOTTOM = 14;

export function SubtitlesSection() {
  const appearance = useSubtitleAppearance();
  const update = useSubtitleSettings((s) => s.update);
  const [field, setField] = useState<Field | null>(null);
  const sheet = field ? FIELDS[field] : null;
  const height = scaled(PREVIEW_HEIGHT);
  const label = (f: Field) => optionLabel(FIELDS[f].options, appearance[f]);
  return (
    <Group title="Subtitles" footer={FOOTER}>
      <View style={[styles.preview, { height }]} accessible accessibilityLabel="Subtitle preview">
        <LinearGradient colors={player.subtitlePreview} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.previewLine, { bottom: subtitleBottom(appearance, scaled(PREVIEW_BOTTOM), height) }]}>
          <SubtitleLines lines={['This is how subtitles look.']} appearance={appearance} typeScale={TYPE_SCALE} />
        </View>
      </View>
      <SettingsRow icon="textformat.size" label="Text size" value={label('size')} onPress={() => setField('size')} />
      <SettingsRow icon="paintpalette" label="Text colour" value={label('color')} onPress={() => setField('color')} />
      <SettingsRow icon="captions.bubble" label="Background" value={label('background')} onPress={() => setField('background')} />
      <SettingsRow icon="arrow.up" label="Position" value={label('position')} onPress={() => setField('position')} last />
      <OptionSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        options={(sheet?.options ?? []) as Option<string>[]}
        selected={field ? [appearance[field]] : []}
        onSelect={(v) => {
          if (field) update({ [field]: v } as Partial<SubtitleAppearance>);
        }}
        onClose={() => setField(null)}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  preview: { overflow: 'hidden' },
  previewLine: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
});
