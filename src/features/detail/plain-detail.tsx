/**
 * The page layout of a title that is not a Jellyfin item (an IPTV film or
 * series, an extension entry), in the look of the item page
 * (`features/detail/detail-scaffold.tsx`, design system §7.6): the backdrop
 * fading into the page, the poster, the eyebrow, the title, the lines, Play
 * or Resume with its bar, round actions (any icon name of
 * `components/icon-names.ts`; an unknown name draws the default icon), the
 * overview (collapsible) and more content below. Wide windows and TV put the
 * poster and the actions in a left column. It takes plain data only (no
 * Jellyfin item, no item actions).
 *
 * The picture follows `shape`: a poster is 2:3 (the default); a thumb is the
 * whole 16:9 picture, wide; a square is 1:1. A wide or square picture is
 * never cropped to 2:3, and it replaces the backdrop hero when the backdrop
 * is the same picture. The round actions sit in one row: centred while they
 * fit, else the row scrolls from the left gutter with no scroll bar.
 *
 * TV: Play takes the first focus; with no Play, the first round action. The
 * D-pad order is Play, the round actions, then the content below.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { type IconName, isIconName } from '@/components/icon-names';
import { PlainArt, type PlainKind } from '@/components/plain-art';
import { Overview, RoundAction } from '@/features/detail/detail-scaffold';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import type { Shape } from '@/extensions/schema/common';
import { createStyles, type AppTheme, font, radius, scaled, scriptStyle, sizes, spacing, type, useLayout, useStyles, useTheme, withAlpha } from '@/theme';

/** The icon of a round action whose icon name the app does not know. */
export const DEFAULT_ROUND_ICON: IconName = 'square.grid.2x2';

export interface PlainAction {
  /** A stable key; the label when left out. */
  key?: string;
  /** Any icon name; an unknown name draws `DEFAULT_ROUND_ICON`. */
  icon: string;
  label: string;
  /** An on/off button: true while on (the accent icon). */
  active?: boolean;
  onPress: () => void;
}

/** The shape of the picture on the page. */
export type PlainShape = Shape;

/** The aspect ratio (width over height) of each picture shape. */
export const SHAPE_ASPECT: Record<PlainShape, number> = { poster: 2 / 3, thumb: 16 / 9, square: 1 };

export interface PlainDetailProps {
  kind: PlainKind;
  id: string;
  title: string;
  eyebrow?: string | null;
  poster: string | null;
  backdrop: string | null;
  /** The shape of `poster`: `poster` (2:3, the default), `thumb` (16:9) or `square`. */
  shape?: PlainShape;
  /** Short facts, shown on one line with " · " between them. */
  lines: string[];
  overview?: string | null;
  /** "Cast: …", "Director: …". */
  credits?: string[];
  /** Play or Resume; null while there is nothing to play yet. */
  primary: { label: string; onPress: () => void; progress: number | null; disabled?: boolean } | null;
  actions: PlainAction[];
  /** A line under the actions: loading, or why the details did not load. */
  status?: ReactNode;
}

/** The page: the header, then `children` (seasons and episodes, more sections) in one scroll view. */
export function PlainDetail({ children, ...props }: PlainDetailProps & { children?: ReactNode }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const pageWidth = Math.min(l.contentWidth, 1280);
  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <TvScrollView style={s.page} contentContainerStyle={{ paddingBottom: spacing.huge * 2 }}>
        <PlainDetailHeader {...props} />
        <View style={[s.selfCenter, { width: pageWidth }]}>{children}</View>
      </TvScrollView>
    </>
  );
}

/**
 * The header alone: for a page whose content below is its own scrolling
 * list (an extension entry whose last section is a grid or a list), which
 * takes the header as its list header.
 */
export function PlainDetailHeader({ kind, id, title, eyebrow, poster, backdrop, shape = 'poster', lines, overview, credits, primary, actions, status }: PlainDetailProps) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const twoColumn = l.contentWidth >= 900 || l.tv;
  const pageWidth = Math.min(l.contentWidth, 1280);
  const heroH = Math.round(Math.min(l.height * (twoColumn ? 0.55 : 0.42), l.contentWidth * 0.6));

  const play = primary ? (
    <View>
      <Button title={primary.label} icon="play.fill" onPress={primary.onPress} disabled={primary.disabled} preferredFocus={isTV} />
      {primary.progress !== null ? (
        <View style={s.resumeTrack} accessibilityLabel={`${Math.round(primary.progress * 100)} percent watched`}>
          <View style={[s.resumeFill, { width: `${Math.round(primary.progress * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  ) : null;

  // The picture: a poster stays 2:3. A wide or square picture shows whole (the poster, else the backdrop),
  // and the backdrop hero is left out when it would be the same picture again.
  const aspect = SHAPE_ASPECT[shape];
  const picture = shape === 'poster' ? poster : (poster ?? backdrop);
  const heroUri = shape === 'poster' || (twoColumn && backdrop && backdrop !== picture) ? backdrop : null;

  // One row. On a phone it bleeds to the screen edges and pads by the gutter, so the first action starts at the gutter.
  const rowInset = twoColumn ? spacing.sm : l.gutter;
  const actionsRow = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[s.actionsScroll, { marginHorizontal: -rowInset }]}
      contentContainerStyle={[s.actions, { paddingHorizontal: rowInset }, !twoColumn && s.actionsCenter, isTV && s.actionsTV]}>
      {actions.map((a, i) => (
        <RoundAction
          key={a.key ?? a.label}
          icon={isIconName(a.icon) ? a.icon : DEFAULT_ROUND_ICON}
          label={a.label}
          active={a.active}
          onPress={a.onPress}
          firstFocus={isTV && !primary && i === 0}
        />
      ))}
    </ScrollView>
  );

  const text = (
    <View style={s.textBlock}>
      {eyebrow ? <Text style={[s.eyebrow, !twoColumn && s.center]}>{eyebrow}</Text> : null}
      <Text style={[s.title, scriptStyle(title, s.title, twoColumn), !twoColumn && s.center]} numberOfLines={3} accessibilityRole="header">
        {title}
      </Text>
      {lines.length ? <Text style={[s.meta, !twoColumn && s.center]}>{lines.join(' · ')}</Text> : null}
      {twoColumn ? null : play}
      {twoColumn ? null : actionsRow}
      {status}
      {overview ? <Overview text={overview} centered={false} /> : null}
      {(credits ?? []).map((line) => (
        <Text key={line} style={s.credit} numberOfLines={3}>
          {line}
        </Text>
      ))}
    </View>
  );

  const hero = heroUri ? (
    <View style={[s.hero, { height: heroH }]}>
      <PlainArt uri={heroUri} name={title} id={id} kind={kind} width={l.contentWidth} aspectRatio={l.contentWidth / heroH} rounded={0} showTitle={false} />
      <LinearGradient colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0), c.bg]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
    </View>
  ) : null;

  let header: ReactNode;
  if (twoColumn) {
    const leftWidth = Math.round((pageWidth - l.gutter * 2) * 0.32);
    // TV: the poster is at most 45 % of the screen height, so Play shows whole when the page opens.
    const posterWidth = Math.min(leftWidth, shape === 'poster' ? 260 : shape === 'thumb' ? 360 : 300, isTV ? Math.round(l.height * 0.45 * aspect) : Infinity);
    header = (
      <View>
        {hero}
        <View style={[s.columns, { width: pageWidth, paddingHorizontal: l.gutter, marginTop: hero ? -heroH * 0.5 : isTV ? spacing.xxl : spacing.huge }]}>
          <View style={[s.left, { width: leftWidth }]}>
            <View style={s.raised}>
              <PlainArt uri={picture} name={title} id={id} kind={kind} width={posterWidth} aspectRatio={aspect} />
            </View>
            <View style={{ width: Math.min(leftWidth, 280), gap: spacing.lg }}>
              {play}
              {actionsRow}
            </View>
          </View>
          <View style={[s.right, { maxWidth: sizes.readableWidth }]}>{text}</View>
        </View>
      </View>
    );
  } else {
    // A poster is a small centred box; a thumb fills the content width; a square is a centred box.
    const posterWidth =
      shape === 'thumb' ? Math.round(Math.min(l.contentWidth - l.gutter * 2, sizes.readableWidth)) : Math.round(Math.min(l.contentWidth * (shape === 'square' ? 0.6 : 0.42), scaled(shape === 'square' ? 260 : 180)));
    header = (
      <View>
        {hero}
        <View style={[s.body, { paddingHorizontal: l.gutter, marginTop: hero ? -scaled(90) : spacing.lg }]}>
          <View style={[s.raised, s.selfCenter]}>
            <PlainArt uri={picture} name={title} id={id} kind={kind} width={posterWidth} aspectRatio={aspect} />
          </View>
          {text}
        </View>
      </View>
    );
  }

  return header;
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bg },
  hero: { overflow: 'hidden' as const },
  columns: { alignSelf: 'center' as const, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.xxxl },
  left: { alignItems: 'center' as const, gap: spacing.xl },
  right: { flex: 1, paddingTop: spacing.xl },
  body: { gap: spacing.lg },
  raised: { ...shadow('raised'), borderRadius: radius.md },
  selfCenter: { alignSelf: 'center' as const },
  textBlock: { gap: spacing.md, width: '100%' as const },
  center: { textAlign: 'center' as const },
  eyebrow: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text2 },
  title: { ...font(type.title1), color: c.text },
  meta: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  credit: { ...font(type.footnote), color: c.text2 },
  resumeTrack: { height: sizes.resumeBar, borderRadius: 2, backgroundColor: c.surface3, marginTop: spacing.md, marginHorizontal: spacing.xxxl, overflow: 'hidden' as const },
  resumeFill: { height: '100%' as const, backgroundColor: c.accent },
  // The scroll view takes the row's height only; the content grows to the view's width, so it centres while it fits.
  actionsScroll: { flexGrow: 0, marginTop: spacing.xs },
  actions: { flexGrow: 1, gap: spacing.xl },
  actionsCenter: { justifyContent: 'center' as const },
  // TV: room above and below for the focus scale and ring.
  actionsTV: { paddingVertical: spacing.md },
}));
