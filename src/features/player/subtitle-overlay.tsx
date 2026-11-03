import { memo, useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { applyEngineSubtitleStyle } from '@/player/engine-subtitle-style';
import { cuesAt } from '@/player/vtt';
import { usePlayerStore } from '@/player/store';
import { subtitleBottom, subtitleLineGap, subtitleTextStyle, type SubtitleAppearance } from '@/settings/subtitle-style';
import { useSubtitleAppearance } from '@/settings/subtitles';
import { TYPE_SCALE } from '@/theme';

import { spacing } from './tokens';

/**
 * Draws the selected text subtitle with the saved appearance. Lifts above the
 * controls when they show. Also passes the appearance to the browser and
 * libmpv, which draw the subtitles inside a stream.
 */
export const SubtitleOverlay = memo(function SubtitleOverlay({ bottom }: { bottom: number }) {
  const appearance = useSubtitleAppearance();
  const { height } = useWindowDimensions();
  const cues = usePlayerStore((s) => s.cues);
  const position = usePlayerStore((s) => s.position);
  useEffect(() => applyEngineSubtitleStyle(appearance), [appearance]);
  if (!cues?.length) return null;
  const lines = cuesAt(cues, position);
  if (!lines.length) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: subtitleBottom(appearance, bottom, height) }]} accessibilityLiveRegion="polite">
      <SubtitleLines lines={lines} appearance={appearance} typeScale={TYPE_SCALE} />
    </View>
  );
});

/** Subtitle lines in the given appearance. Settings uses it for the preview. */
export function SubtitleLines({ lines, appearance, typeScale, scale = 1 }: { lines: readonly string[]; appearance: SubtitleAppearance; typeScale: number; scale?: number }) {
  const line = subtitleTextStyle(appearance, typeScale, scale);
  return (
    <View style={[styles.lines, { gap: subtitleLineGap(typeScale * scale) }]}>
      {lines.map((l, i) => (
        <Text key={`${i}-${l}`} style={line}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.xxxl, right: spacing.xxxl, alignItems: 'center' },
  lines: { alignItems: 'center' },
});
