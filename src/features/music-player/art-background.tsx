import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useImageServer } from '@/api/use-api';
import type { BaseItemDto } from '@/api/types';
import { imageSource } from '@/images/image-url';
import { resolveImage } from '@/images/resolve-image';
import { useLite } from '@/platform/use-lite';

/**
 * The full-player background (design system §3): the artwork blurred
 * (radius 60) and dimmed 45 %, cross-faded in 400 ms when the track
 * changes. It is computed once per image, not per frame. Items without art
 * use their generated-art gradient.
 */
export const ArtBackground = memo(function ArtBackground({ item }: { item: BaseItemDto }) {
  const server = useImageServer();
  const reduced = useReducedMotion();
  // Lite mode: RGB 565, half the memory of the blurred art (platform/lite.ts).
  const lite = useLite();
  const img = useMemo(() => resolveImage(item, 'square', { width: 200, height: 200 }, server), [item, server]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {img.kind === 'remote' ? (
        <Image
          source={imageSource(img.uri, server)}
          placeholder={img.blurhash ? { blurhash: img.blurhash } : undefined}
          style={styles.blur}
          contentFit="cover"
          blurRadius={60}
          decodeFormat={lite ? 'rgb' : 'argb'}
          transition={reduced ? 0 : 400}
          cachePolicy="memory-disk"
        />
      ) : (
        <LinearGradient colors={[img.art.from, img.art.to]} start={img.art.start} end={img.art.end} style={StyleSheet.absoluteFill} />
      )}
      <View style={styles.dim} />
    </View>
  );
});

const styles = StyleSheet.create({
  blur: { ...StyleSheet.absoluteFill, transform: [{ scale: 1.3 }] },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
});
