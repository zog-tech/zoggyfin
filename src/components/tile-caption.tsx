/**
 * The caption under a tile's art: a title and one line of metadata (design
 * system §7.3). On TV the focused tile's caption turns into a light strip
 * with dark text at once, joined to the art (design system §7.19), like the
 * streaming apps' lit cards. The strip and the text colours follow the
 * Touchable's focus mark on the UI thread, so a focus move does no React
 * render of the tile. Phones, iPad, the Mac app and the web show the plain
 * caption.
 */
import { useContext } from 'react';
import { type StyleProp, Text, type TextStyle, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { isTV } from '@/platform/tv';
import { type AppTheme, createStyles, font, scaled, scriptStyle, sizes, spacing, tvCaption, type, useStyles, useTheme } from '@/theme';

import { TouchFocusMark } from './touchable';

/** TV: the caption's inset in its strip (sides and bottom). */
export const TV_CAPTION_PAD = isTV ? scaled(spacing.sm) : 0;

/**
 * TV: the light strip of a focused tile. Put it first in the tile, so it sits
 * under the art: it starts `radius` above the art's bottom edge, so the art's
 * rounded bottom corners sit on the strip and the two read as one card.
 */
export function TileFocusFill({ artHeight, radius }: { artHeight: number; radius: number }) {
  const mark = useContext(TouchFocusMark);
  if (!isTV || !mark) return null;
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
  const rest = kind === 'title' ? c.text : c.text2;
  const lit = kind === 'title' ? tvCaption.focusText : tvCaption.focusText2;
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
}));
