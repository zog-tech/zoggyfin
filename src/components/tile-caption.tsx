/**
 * The caption under a tile's art: a title and one line of metadata (design
 * system §7.3). On TV the focused tile's caption turns into a light strip
 * with dark text at once, joined to the art (design system §7.19), like the
 * streaming apps' lit cards. The strip and the text colours follow the
 * Touchable's focus mark on the UI thread, so a focus move does no React
 * render of the tile. Phones, iPad, the Mac app and the web show the plain
 * caption.
 *
 * TV Modern look (design system §7.22): no strip. The art gets the white
 * ring (`TvArtRing`, the same ring as an art-only tile) and the caption text
 * turns from soft white to white. One focus language for every tile.
 */
import { useContext } from 'react';
import { type StyleProp, Text, type TextStyle, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { type AppTheme, createStyles, font, scaled, scriptStyle, sizes, spacing, tvCaption, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

import { TouchFocusMark } from './touchable';

const MODERN = isTV && isTvModern;

/** TV: the caption's inset in its strip (sides and bottom). Modern has no strip. */
export const TV_CAPTION_PAD = isTV && !MODERN ? scaled(spacing.sm) : 0;

/** The corner radius of a tile's art: one radius for every tile in the TV Modern look, else the tile's own. */
export function tvTileRadius(classic: number): number {
  return MODERN ? u(tvm.size.tileRadius) : classic;
}

/** TV Modern: the gap between the art and the caption, and between the title and the metadata. */
const MODERN_TITLE_GAP = u(12);
const MODERN_META_GAP = u(2);

/** TV Modern: the height of a caption under the art (title lines and one metadata line). 0 elsewhere. */
export function tvModernCaptionHeight(lines = 1): number {
  if (!MODERN) return 0;
  return MODERN_TITLE_GAP + u(tvm.type.tileTitle.lineHeight) * lines + MODERN_META_GAP + u(tvm.type.tileMeta.lineHeight);
}

/**
 * TV Modern: the focus ring around the art of a captioned tile (the
 * Touchable of such a tile keeps `ring={false}`, so the ring does not go
 * round the caption). It shows by opacity from the focus mark, on the UI
 * thread. Put it over the art box: it fills its parent, or the top
 * `artHeight` of it. Null in Classic and off TV.
 */
export function TvArtRing({ radius, artHeight }: { radius: number; artHeight?: number }) {
  const mark = useContext(TouchFocusMark);
  if (!MODERN || !mark) return null;
  return <Ring mark={mark} radius={radius} artHeight={artHeight} />;
}

function Ring({ mark, radius, artHeight }: { mark: SharedValue<number>; radius: number; artHeight?: number }) {
  const shown = useAnimatedStyle(() => ({ opacity: mark.get() }));
  const out = u(tvm.size.ringGap) + u(tvm.size.ringWidth);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: -out,
          left: -out,
          right: -out,
          ...(artHeight === undefined ? { bottom: -out } : { height: artHeight + out * 2 }),
          borderRadius: radius + out,
          borderWidth: u(tvm.size.ringWidth),
          borderColor: tvm.color.ring,
        },
        shown,
      ]}
    />
  );
}

/**
 * TV: the light strip of a focused tile. Put it first in the tile, so it sits
 * under the art: it starts `radius` above the art's bottom edge, so the art's
 * rounded bottom corners sit on the strip and the two read as one card.
 */
export function TileFocusFill({ artHeight, radius }: { artHeight: number; radius: number }) {
  const mark = useContext(TouchFocusMark);
  if (!isTV || !mark || MODERN) return null;
  return <Fill mark={mark} top={artHeight - radius} radius={radius} />;
}

function Fill({ mark, top, radius }: { mark: SharedValue<number>; top: number; radius: number }) {
  const shown = useAnimatedStyle(() => ({ opacity: mark.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, right: 0, bottom: 0, top, backgroundColor: tvCaption.focusFill, borderBottomLeftRadius: radius, borderBottomRightRadius: radius },
        shown,
      ]}
    />
  );
}

export interface TileCaptionProps {
  title: string;
  /** The metadata line; null for none. */
  sub?: string | null;
  /** Keep the metadata line's height when there is none (rows with a fixed height). */
  keepSubLine?: boolean;
  /** Title lines (2 with large text). */
  lines?: number;
}

export function TileCaption({ title, sub, keepSubLine = false, lines = 1 }: TileCaptionProps) {
  const s = useStyles(makeStyles);
  const mark = useContext(TouchFocusMark);
  const subText = sub || (keepSubLine ? ' ' : null);
  if (MODERN && mark) {
    return (
      <>
        <CaptionText mark={mark} kind="title" style={[s.modernTitle, scriptStyle(title, s.modernTitle)]} lines={lines} text={title} />
        {subText ? <CaptionText mark={mark} kind="meta" style={[s.modernMeta, scriptStyle(subText, s.modernMeta)]} lines={1} text={subText} /> : null}
      </>
    );
  }
  if (isTV && mark) {
    return (
      <View style={s.tvStrip}>
        <CaptionText mark={mark} kind="title" style={[s.title, scriptStyle(title, s.title)]} lines={lines} text={title} />
        {subText ? <CaptionText mark={mark} kind="meta" style={[s.meta, scriptStyle(subText, s.meta)]} lines={1} text={subText} /> : null}
      </View>
    );
  }
  return (
    <>
      <Text style={[s.title, scriptStyle(title, s.title)]} numberOfLines={lines}>
        {title}
      </Text>
      {subText ? (
        <Text style={[s.meta, scriptStyle(subText, s.meta)]} numberOfLines={1}>
          {subText}
        </Text>
      ) : null}
    </>
  );
}

/** TV: a caption line whose colour flips with the focus mark, with no animation. */
function CaptionText({ mark, kind, style, lines, text }: { mark: SharedValue<number>; kind: 'title' | 'meta'; style: StyleProp<TextStyle>; lines: number; text: string }) {
  const { c } = useTheme();
  // Classic: the text turns dark on the lit strip. Modern: soft white turns white, the metadata text3 turns text2.
  const rest = MODERN ? (kind === 'title' ? tvm.color.captionRest : c.text3) : kind === 'title' ? c.text : c.text2;
  const lit = MODERN ? (kind === 'title' ? c.text : c.text2) : kind === 'title' ? tvCaption.focusText : tvCaption.focusText2;
  const colour = useAnimatedStyle(() => ({ color: mark.get() > 0.5 ? lit : rest }));
  return (
    <Animated.Text style={[style, colour]} numberOfLines={lines}>
      {text}
    </Animated.Text>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  title: { ...font(type.tileTitle), color: c.text, marginTop: scaled(sizes.tileTitleGap) },
  meta: { ...font(type.caption1), color: c.text2, marginTop: sizes.tileMetaGap },
  tvStrip: { paddingHorizontal: TV_CAPTION_PAD, paddingBottom: TV_CAPTION_PAD },
  modernTitle: { ...tvFont(tvm.type.tileTitle), color: tvm.color.captionRest, marginTop: MODERN_TITLE_GAP },
  modernMeta: { ...tvFont(tvm.type.tileMeta), color: c.text3, marginTop: MODERN_META_GAP },
}));
