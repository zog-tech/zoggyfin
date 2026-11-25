import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { features } from '@/platform/tv';

import { VolumeButton, VolumeSlider as AppVolumeSlider } from '../player/volume-control';
import { c, iconSize, player, spacing } from '../player/tokens';

/**
 * Web and the Mac app: the browser cannot reach the system volume, so this is
 * the app's own volume (`player/volume.ts`), shared with video. The low
 * speaker mutes and unmutes; the high speaker only marks the end. Nothing
 * in the web TV preview.
 */
export function VolumeSlider() {
  if (!features.inAppVolume) return null;
  return (
    <View style={styles.row}>
      <VolumeButton icon="speaker.fill" color={c.textOnMediaSecondary} glyph={iconSize.sm} size={32} />
      <AppVolumeSlider colors={{ tint: c.textOnMedia, track: player.trackColor }} style={styles.slider} />
      <View style={styles.end} accessible={false}>
        <Icon name="speaker.wave.3.fill" size={iconSize.sm} color={c.textOnMediaSecondary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44 },
  slider: { flex: 1 },
  end: { width: 32, alignItems: 'center' },
});
