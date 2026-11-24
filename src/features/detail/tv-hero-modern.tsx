/**
 * TV Modern look (design system §7.22, spec §2.6): the top of an item page.
 *
 * - `TvMediaHero` (movies, shows, episodes): full bleed. The backdrop runs
 *   under the rail to the screen's left edge, with a fade on the left and at
 *   the bottom; the text and the actions start at the page edge (rail +
 *   gutter). The hero is a little shorter than the screen, so the first row
 *   shows under it.
 * - `TvArtHero` (albums, playlists, artists, people): the art on the left,
 *   the text and the actions beside it. Not full bleed.
 * - `TvActionRow`: the primary action (the Ember rectangle) and then flat
 *   text actions, in ONE row. The row never wraps: the actions that do not
 *   fit go behind More (`fitTvActions`). The label widths are measured in a
 *   hidden layer of plain text (no focusable views), so the row decides once
 *   the widths are known and never shows a second line.
 *
 * Only Modern renders these; Classic keeps `TvHero` in `detail-scaffold.tsx`.
 * Focus marks stay on the UI thread (`TvButton`); no state follows the focus.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import type { IconName } from '@/components/icon';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { useItemActions } from '@/features/actions/use-item-actions';
import { TvScrollView } from '@/features/tv/page-scroll';
import { TV_RAIL_INSET, useTvFullBleed } from '@/features/tv/screen-inset';
import { TvButton } from '@/features/tv/tv-button';
import { isTV } from '@/platform/tv';
import { actionSections } from '@/registry/item-actions';
import { type AppTheme, createStyles, scaled, iconSize, scriptStyle, tvFont, tvm, u, useLayout, useStyles, useTheme, withAlpha } from '@/theme';

import { fitTvActions } from './hero-layout';

/** A text action of the row. `spare`: it is also in the item's More sheet, so it leaves the row first. */
export interface TvAction {
  key?: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  a11y?: string;
  spare?: boolean;
}

export interface TvPrimaryAction {
  label: string;
  icon: IconName;
  progress: number | null;
  onPress: () => void;
}

/** The hero ends this far above the screen's bottom, so the first row's title and the top of its tiles show. */
const PEEK = 258;
/** The actions end this far above the hero's bottom. */
const ACTIONS_BOTTOM = 42;
/** Between the primary action and the first text action (spec §2.3). */
const PRIMARY_GAP = 24;
/** Between the glyph and the label of an action (as in `TvButton`). */
const INNER_GAP = 14;

/** Modern: this page draws under the rail. A component, so a page can ask for it only in one branch. */
function TvFullBleed(): null {
  useTvFullBleed();
  return null;
}

/** Facts on one line: the age rating first in white, the others quieter, each isolated in its own text direction. */
function TvFacts({ facts, rated, color }: { facts: readonly string[]; rated: string | null; color: string }) {
  const s = useStyles(makeStyles);
  const rest = facts.filter((f) => f !== rated);
  if (!rated && !rest.length) return null;
  return (
    <Text style={[s.facts, { color }]} numberOfLines={1}>
      {rated ? <Text style={s.rated}>{`⁨${rated}⁩`}</Text> : null}
      {rest.map((f, i) => (
        <Fragment key={`${i}-${f}`}>
          {i > 0 || rated ? <Text style={s.dot}>{'  ·  '}</Text> : null}
          {`⁨${f}⁩`}
        </Fragment>
      ))}
    </Text>
  );
}

/** Movies, shows and episodes: the full-bleed hero with the text and one row of actions at the page edge. */
export function TvMediaHero({
  item,
  eyebrow,
  facts,
  title,
  primary,
  actions,
  onMore,
}: {
  item: BaseItemDto;
  eyebrow?: string | null;
  facts: string[];
  title: ReactNode;
  primary: TvPrimaryAction | null;
  actions: TvAction[];
  onMore: (hidden: TvAction[]) => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const w = l.width;
  const height = l.height - u(PEEK);
  const edge = TV_RAIL_INSET + l.gutter;
  // The bottom fade starts at 432 u of a 1080 screen and ends in the page colour at the hero's bottom.
  const fadeTop = u(432);
  return (
    // The first row's header sits 24 u under the hero: the row's own top margin (the section gap) is taken back.
    <View style={{ height, marginBottom: -Math.max(0, l.sectionGap - u(tvm.size.rowTitleGap)) }}>
      <TvFullBleed />
      <View style={[styles.abs, { width: w, height }]}>
        <ItemImage item={item} variant="backdrop" width={w} aspectRatio={w / height} rounded={0} hideArtTitle hairline={false} />
      </View>
      {/* Each fade covers only the strip it fades (a TV GPU fills few pixels a second). */}
      <LinearGradient
        colors={[withAlpha(c.bg, 0.94), withAlpha(c.bg, 0.7), withAlpha(c.bg, 0)]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.abs, { width: Math.min(w, u(1306)), height }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[withAlpha(c.bg, 0), withAlpha(c.bg, 0.85), c.bg]}
        locations={[0, 0.7, 1]}
        style={[styles.abs, { top: fadeTop, width: w, height: Math.max(0, height - fadeTop) }]}
        pointerEvents="none"
      />
      <View style={[styles.block, { left: edge, right: l.gutter, bottom: u(ACTIONS_BOTTOM) }]}>
        <View style={[s.text, { maxWidth: u(860) }]}>
          {eyebrow ? (
            <Text style={[s.eyebrow, scriptStyle(eyebrow, s.eyebrow, true)]} numberOfLines={1}>
              {eyebrow}
            </Text>
          ) : null}
          {title}
          <TvFacts facts={facts} rated={item.OfficialRating ?? null} color={tvm.color.onArt} />
          {item.Overview ? (
            <Text style={[s.overview, scriptStyle(item.Overview, s.overview, true)]} numberOfLines={3}>
              {item.Overview}
            </Text>
          ) : null}
        </View>
        <View style={s.actionsBelow}>
          <TvActionRow primary={primary} actions={actions} onMore={onMore} />
        </View>
      </View>
    </View>
  );
}

/** Albums, playlists, artists and people: the art on the left, the text and one row of actions beside it. */
export function TvArtHero({
  item,
  circle,
  eyebrow,
  subtitle,
  facts,
  primary,
  actions,
  onMore,
}: {
  item: BaseItemDto;
  circle: boolean;
  /** A line above the title. */
  eyebrow?: string | null;
  /** A line under the title (the album artist, which is also an action). */
  subtitle?: string | null;
  facts: string[];
  primary: TvPrimaryAction | null;
  actions: TvAction[];
  onMore: (hidden: TvAction[]) => void;
}) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const side = u(420);
  const name = item.Name ?? '';
  return (
    <View style={[s.artRow, { paddingHorizontal: l.gutter, paddingTop: l.safe.y + u(32), paddingBottom: u(24), gap: l.gutter }]}>
      <ItemImage item={item} variant="square" width={side} aspectRatio={1} rounded={circle ? side / 2 : u(tvm.size.tileRadius)} circle={circle} />
      <View style={[s.flex, s.text]}>
        {eyebrow ? (
          <Text style={[s.eyebrow, scriptStyle(eyebrow, s.eyebrow, true)]} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={[s.pageTitle, scriptStyle(name, s.pageTitle, true)]} numberOfLines={2} accessibilityRole="header">
          {name}
        </Text>
        {subtitle ? (
          <Text style={[s.subtitle, scriptStyle(subtitle, s.subtitle, true)]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <TvFacts facts={facts} rated={item.OfficialRating ?? null} color={s.quiet.color} />
        {item.Overview ? (
          <Text style={[s.overview, s.overviewPage, scriptStyle(item.Overview, s.overview, true)]} numberOfLines={2}>
            {item.Overview}
          </Text>
        ) : null}
        <View style={s.actionsGap}>
          <TvActionRow primary={primary} actions={actions} onMore={onMore} />
        </View>
      </View>
    </View>
  );
}

const MORE: Omit<TvAction, 'onPress'> = { key: 'more', icon: 'ellipsis', label: 'More' };

/** The width of an action's box around a label of width `text` (the paddings and the glyph of `TvButton`). */
function boxWidth(text: number, primary: boolean): number {
  const pad = u(primary ? tvm.size.primaryPadX : tvm.size.actionPadX);
  return Math.ceil(text) + pad * 2 + u(tvm.size.actionIcon) + u(INNER_GAP);
}

/**
 * The primary action, the text actions that fit, and More, on one line. More
 * gets the actions that left the row (`onMore`). The first focus is the
 * primary action, else the first text action.
 */
export function TvActionRow({ primary, actions, onMore }: { primary: TvPrimaryAction | null; actions: TvAction[]; onMore: (hidden: TvAction[]) => void }) {
  const s = useStyles(makeStyles);
  // Label widths by label, measured once in the hidden layer below.
  const [label, setLabel] = useState<Record<string, number>>({});
  const [rowWidth, setRowWidth] = useState(0);
  const measure = (text: string) => (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setLabel((m) => (m[text] === w ? m : { ...m, [text]: w }));
  };
  const known = (text: string) => label[text] ?? null;
  const gap = u(tvm.size.actionGap);

  const primaryText = primary ? known(primary.label) : 0;
  const moreText = known(MORE.label);
  // With no primary action the row shifts left by a text action's padding, so the first label sits on the page edge.
  const lead = primary ? (primaryText === null ? null : boxWidth(primaryText, true) + u(PRIMARY_GAP) - gap) : -u(tvm.size.actionPadX);
  const room = lead === null || moreText === null || rowWidth <= 0 ? 0 : rowWidth - lead - boxWidth(moreText, false);
  const widths = actions.map((a) => {
    const t = known(a.label);
    return t === null ? null : boxWidth(t, false);
  });
  const fit = fitTvActions(
    widths,
    actions.map((a) => !!a.spare),
    room,
    gap,
  );
  const hidden = fit.hidden.map((i) => actions[i] as TvAction);
  const shown = fit.shown.map((i) => actions[i] as TvAction);
  const all = [...new Set([...(primary ? [primary.label] : []), ...actions.map((a) => a.label), MORE.label])];

  return (
    <View style={[s.row, !primary && s.rowShift]} onLayout={(e) => setRowWidth(Math.floor(e.nativeEvent.layout.width))}>
      {primary ? (
        <View style={s.primaryBox}>
          <TvButton variant="primary" label={primary.label} icon={primary.icon} progress={primary.progress} onPress={primary.onPress} firstFocus />
        </View>
      ) : null}
      {shown.map((a, i) => (
        <TvButton
          key={a.key ?? a.label}
          label={a.label}
          icon={a.icon}
          active={a.active}
          accessibilityLabel={a.a11y}
          onPress={a.onPress}
          firstFocus={!primary && i === 0}
        />
      ))}
      <TvButton label={MORE.label} icon={MORE.icon} accessibilityLabel={hidden.length ? 'More actions' : undefined} onPress={() => onMore(hidden)} firstFocus={!primary && !shown.length} />
      {/* The label widths, in the heaviest weight a label takes (700), so the fit never runs short. Not focusable, not read. */}
      <View style={s.measureClip} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={s.measureRow}>
          {all.map((t) => (
            <Text key={t} style={s.measureText} onLayout={measure(t)}>
              {t}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * More, when actions that are not in the item sheet (Reorder, Shuffle,
 * Trailer, Start over) left the row: those actions first, then the item's
 * own actions (the item sheet's rows), in one sheet. One sheet, not two in a
 * chain: a second sheet that opened while the first closed lost the focus.
 * Render it outside the page list, like the other sheets (`DetailScaffold`).
 */
export function TvOverflowSheet({ item, actions, onClose }: { item: BaseItemDto; actions: TvAction[] | null; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { actions: itemActions, run, titleOf } = useItemActions(actions ? item : undefined);
  const list = actions ?? [];
  const row = (key: string, label: string, icon: IconName, onPress: () => void, first: boolean, last: boolean, danger?: boolean) => (
    <SheetRow
      key={key}
      last={last}
      accessibilityLabel={label}
      preferredFocus={isTV && first}
      onPress={() => {
        onClose();
        onPress();
      }}>
      <Icon name={icon} size={scaled(iconSize.md)} color={danger ? c.danger : c.text} />
      <Text style={[s.rowText, danger && { color: c.danger }]}>{label}</Text>
    </SheetRow>
  );
  return (
    <Sheet visible={!!actions} title={item.Name} onClose={onClose}>
      <TvScrollView style={s.sheetList} contentContainerStyle={s.sheetBody}>
        <View style={s.group}>{list.map((a, i) => row(a.key ?? a.label, a.label, a.icon, a.onPress, i === 0, i === list.length - 1))}</View>
        {actionSections(itemActions).map((sec) => (
          <View key={sec.key} style={s.group}>
            {sec.actions.map((a, i) => row(a.id, titleOf(a), a.icon, () => void run(a), false, i === sec.actions.length - 1, a.destructive))}
          </View>
        ))}
      </TvScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', top: 0, left: 0 },
  block: { position: 'absolute' },
});

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  flex: { flex: 1, minWidth: 0 },
  text: { gap: u(14) },
  artRow: { flexDirection: 'row' as const, alignItems: 'flex-end' as const },
  eyebrow: { ...tvFont(tvm.type.eyebrow), color: tvm.color.onArt, textTransform: 'uppercase' as const },
  pageTitle: { ...tvFont(tvm.type.pageTitle), color: t.c.text },
  subtitle: { ...tvFont(tvm.type.rowTitle), fontWeight: '500' as const, color: t.c.text2 },
  facts: { ...tvFont(tvm.type.meta, { tabular: true }) },
  rated: { color: t.c.text, fontWeight: '700' as const },
  dot: { color: withAlpha(t.c.text, 0.5) },
  quiet: { color: t.c.text2 },
  overview: { ...tvFont(tvm.type.body), color: tvm.color.onArt },
  overviewPage: { color: t.c.text2 },
  // The text block ends 32 u above the actions; inside the text column its own gap (14 u) is part of it.
  actionsBelow: { marginTop: u(32) },
  actionsGap: { marginTop: u(32) - u(14) },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: u(tvm.size.actionGap), alignSelf: 'stretch' as const },
  rowShift: { marginLeft: -u(tvm.size.actionPadX) },
  primaryBox: { marginRight: u(PRIMARY_GAP) - u(tvm.size.actionGap) },
  // A clip of no size: the wide row inside measures each label at its own width and never widens the page.
  measureClip: { position: 'absolute' as const, top: 0, left: 0, width: 0, height: 0, overflow: 'hidden' as const, opacity: 0 },
  measureRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, width: 8000 },
  measureText: { ...tvFont(tvm.type.action), fontWeight: '700' as const },
  // As the item sheet: no grow, so a short sheet stays short; it scrolls inside the panel when long.
  sheetList: { flexGrow: 0 },
  sheetBody: { gap: u(16) },
}));
