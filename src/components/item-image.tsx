import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useImageServer } from '@/api/use-api';
import type { BaseItemDto } from '@/api/types';
import { Icon } from '@/components/icon';
import { useLocalImage } from '@/downloads';
import { isTV } from '@/platform/tv';
import { generatedArt, initials } from '@/images/generated-art';
import { imageSource } from '@/images/image-url';
import { type ImageVariant, type ResolvedImage, resolveImage } from '@/images/resolve-image';
import { createStyles, type AppTheme, font, mediaColors, motion, radius, scaled, scriptStyle, type, useStyles } from '@/theme';
import { useLite } from '@/platform/use-lite';

export interface ItemImageProps {
  item: BaseItemDto;
  variant: ImageVariant;
  /** Width in points. */
  width: number;
  /**
   * The width (points) to ask the server for, when it should not follow
   * `width`. A view whose size changes with the window (the Now Playing art
   * on a rotation) keeps one image URL, so the image stays in the cache and
   * does not load again at the new size.
   */
  requestWidth?: number;
  /** Width / height. */
  aspectRatio: number;
  rounded?: number;
  /** Hide the title on generated art (when the title is already shown next to the image). */
  hideArtTitle?: boolean;
  style?: ViewStyle;
  /** A circle, for people and artists. */
  circle?: boolean;
  /** The inner 0.5 pt hairline (tiles). Default true. */
  hairline?: boolean;
}

/**
 * The one image component for items. It always shows something: a server
 * image with a BlurHash while it loads, or generated art (design system §7.5)
 * when there is no image or the image fails to load.
 */
export const ItemImage = memo(function ItemImage({
  item,
  variant,
  width,
  requestWidth,
  aspectRatio,
  rounded = radius.md,
  hideArtTitle,
  style,
  circle,
  hairline = true,
}: ItemImageProps) {
  const s = useStyles(makeStyles);
  const server = useImageServer();
  const height = width / aspectRatio;
  const scale = PixelRatio.get();
  // Lite mode: 2 bytes a pixel (RGB 565), half the bitmap and GPU memory of each tile (platform/lite.ts).
  const decodeFormat = useLite() ? 'rgb' : 'argb';
  // A downloaded item has its pictures on the device: no network, and they work offline.
  const local = useLocalImage(item.Id, variant);
  const askWidth = requestWidth ?? width;
  const askHeight = askWidth / aspectRatio;
  const resolved = useMemo<ResolvedImage>(() => {
    const remote = resolveImage(item, variant, { width: askWidth * scale, height: askHeight * scale }, server);
    if (!local) return remote;
    return { kind: 'remote', uri: local, source: 'Download', blurhash: remote.kind === 'remote' ? remote.blurhash : undefined };
  }, [item, variant, askWidth, askHeight, scale, server, local]);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const borderRadius = circle ? width / 2 : rounded;
  const box: ViewStyle = { width, height, borderRadius, borderCurve: 'continuous' };

  const shown: ResolvedImage =
    resolved.kind === 'remote' && resolved.uri === failedUri
      ? {
          kind: 'generated',
          ...generatedArt(item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name, item.Type, item.CollectionType, item.Id ?? ''),
        }
      : resolved;

  // TV: no hairline. It is barely visible on the dark page, and every view of a tile costs render-thread time per frame.
  const line = hairline && !isTV ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.hairline, { borderRadius }]} /> : null;

  if (shown.kind === 'generated') {
    return (
      <View style={[s.box, box, style]} accessibilityIgnoresInvertColors>
        <GeneratedArtView
          art={shown}
          width={width}
          height={height}
          circle={!!circle}
          showTitle={!hideArtTitle}
          showIcon={variant !== 'backdrop'}
          name={item.Name}
        />
        {line}
      </View>
    );
  }

  const crop = shown.crop;
  return (
    <View style={[s.box, box, style]} accessibilityIgnoresInvertColors>
      <Image
        source={imageSource(shown.uri, server)}
        placeholder={shown.blurhash ? { blurhash: shown.blurhash } : undefined}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={motion.duration.fast}
        recyclingKey={item.Id ?? shown.uri}
        decodeFormat={decodeFormat}
        cachePolicy="memory-disk"
        onError={() => setFailedUri(shown.uri)}
        style={
          crop
            ? { width: width * crop.columns, height: height * crop.rows, position: 'absolute', left: 0, top: 0 }
            : StyleSheet.absoluteFill
        }
      />
      {line}
    </View>
  );
});

/** Generated art (§7.5): the gradient with a glow, the type glyph and the title, or initials on circles. */
export function GeneratedArtView({
  art,
  width,
  height,
  circle,
  showTitle,
  showIcon,
  name,
}: {
  art: ReturnType<typeof generatedArt>;
  width: number;
  height: number;
  circle: boolean;
  showTitle: boolean;
  showIcon: boolean;
  name?: string | null;
}) {
  const s = useStyles(makeStyles);
  const background: ViewStyle = { backgroundImage: art.art.css, backgroundColor: art.art.from };
  if (circle) {
    return (
      <View style={[StyleSheet.absoluteFill, s.center, background]}>
        <Text style={[s.initials, { fontSize: Math.max(13, Math.min(type.title2.fontSize * 1.6, width * 0.3)) }]} numberOfLines={1}>
          {initials(name ?? art.title)}
        </Text>
      </View>
    );
  }
  const wide = width / height > 1.2;
  const big = width >= 112;
  const titleStyle = big ? s.titleBig : s.titleSmall;
  const glyph = Math.round(width * (wide ? 0.18 : 0.34));
  const showText = showTitle && Math.min(width, height) >= 56;
  return (
    <View style={[StyleSheet.absoluteFill, background]}>
      {showIcon ? (
        <View style={[s.glyph, { top: height * 0.38 - glyph / 2 }]}>
          <Icon name={art.icon} size={glyph} color={mediaColors.artGlyph} />
        </View>
      ) : null}
      {showText ? (
        <Text
          style={[s.title, titleStyle, scriptStyle(art.title, titleStyle, true)]}
          numberOfLines={wide ? 2 : 3}>
          {art.title}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = createStyles(({ c, scheme }: AppTheme) => ({
  box: { overflow: 'hidden' as const, backgroundColor: c.surface2 },
  hairline: {
    borderWidth: 0.5,
    borderColor: scheme === 'light' ? mediaColors.tileHairlineLight : mediaColors.tileHairlineDark,
  },
  center: { alignItems: 'center' as const, justifyContent: 'center' as const },
  glyph: { position: 'absolute' as const, left: 0, right: 0, alignItems: 'center' as const },
  title: {
    position: 'absolute' as const,
    left: scaled(10),
    right: scaled(10),
    bottom: scaled(10),
    color: mediaColors.artText,
  },
  titleBig: { ...font(type.headline), fontSize: scaled(15), lineHeight: scaled(19), letterSpacing: -0.2 },
  titleSmall: { ...font(type.headline), fontSize: scaled(13), lineHeight: scaled(17), letterSpacing: -0.1 },
  initials: { ...font(type.title2), color: mediaColors.artText },
}));
