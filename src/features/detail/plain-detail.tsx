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
 * TV: Play takes the first focus; with no Play, the first round action. The
 * D-pad order is Play, the round actions, then the content below.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { type IconName, isIconName } from '@/components/icon-names';
import { PlainArt, type PlainKind } from '@/components/plain-art';
import { Overview, RoundAction } from '@/features/detail/detail-scaffold';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
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

export interface PlainDetailProps {
  kind: PlainKind;
  id: string;
  title: string;
  eyebrow?: string | null;
  poster: string | null;
  backdrop: string | null;
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
export function PlainDetailHeader({ kind, id, title, eyebrow, poster, backdrop, lines, overview, credits, primary, actions, status }: PlainDetailProps) {
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

  const actionsRow = (
    <View style={[s.actions, !twoColumn && s.actionsCenter]}>
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
    </View>
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

  const hero = backdrop ? (
    <View style={[s.hero, { height: heroH }]}>
      <PlainArt uri={backdrop} name={title} id={id} kind={kind} width={l.contentWidth} aspectRatio={l.contentWidth / heroH} rounded={0} showTitle={false} />
      <LinearGradient colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0), c.bg]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
    </View>
  ) : null;

  let header: ReactNode;
  if (twoColumn) {
    const leftWidth = Math.round((pageWidth - l.gutter * 2) * 0.32);
    // TV: the poster is at most 45 % of the screen height, so Play shows whole when the page opens.
    const posterWidth = Math.min(leftWidth, 260, isTV ? Math.round(l.height * 0.45 * (2 / 3)) : Infinity);
    header = (
      <View>
        {hero}
        <View style={[s.columns, { width: pageWidth, paddingHorizontal: l.gutter, marginTop: hero ? -heroH * 0.5 : isTV ? spacing.xxl : spacing.huge }]}>
          <View style={[s.left, { width: leftWidth }]}>
            <View style={s.raised}>
              <PlainArt uri={poster} name={title} id={id} kind={kind} width={posterWidth} aspectRatio={2 / 3} />
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
    const posterWidth = Math.round(Math.min(l.contentWidth * 0.42, scaled(180)));
    header = (
      <View>
        {hero}
        <View style={[s.body, { paddingHorizontal: l.gutter, marginTop: hero ? -scaled(90) : spacing.lg }]}>
          <View style={[s.raised, s.selfCenter]}>
            <PlainArt uri={poster} name={title} id={id} kind={kind} width={posterWidth} aspectRatio={2 / 3} />
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
  actions: { flexDirection: 'row' as const, alignSelf: 'stretch' as const, gap: spacing.xl, marginTop: spacing.xs },
  actionsCenter: { justifyContent: 'center' as const },
}));
