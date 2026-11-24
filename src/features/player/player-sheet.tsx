import { type ComponentRef, type ReactNode, useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import { Sheet } from '@/components/sheet';
import { afterSheets } from '@/components/sheet-turns';
import { isTV } from '@/platform/tv';
import { darkTheme, font, mediaColors, scaled, ThemeContext } from '@/theme';

import { c, iconSize, radius, spacing, textStyle, type } from './tokens';

export interface SheetRow {
  key: string;
  label: string;
  detail?: string | null;
  /** An icon before the label (a menu of actions). Options with a checkmark have none. */
  icon?: IconName;
  /** Red: the row stops or removes something. */
  destructive?: boolean;
  selected: boolean;
  onPress: () => void;
}

/** A fact shown above the options (the stream that plays): not focusable. */
export interface SheetInfo {
  key: string;
  label: string;
  detail?: string | null;
}

export interface SheetSection {
  /** Shown above the rows. Empty: no heading (the sheet title says it). */
  title: string;
  rows: SheetRow[];
  empty?: string;
}

/**
 * The player's option sheet (Audio & Subtitles, Quality & Speed, the music
 * player's More menu). It is the shared `Sheet`, always dark. Picking a row
 * closes the sheet. TV: the selected row takes the first focus, the focused
 * row is filled and marked, and the list scrolls to keep it in the middle.
 * Back closes the sheet (the Modal's onRequestClose).
 */
export function PlayerSheet({
  visible,
  title,
  subtitle,
  art,
  sections,
  info,
  aside,
  onFocusKey,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** A second line under the title (the artist of the song). */
  subtitle?: string | null;
  /** A small picture before the title (the song's art). */
  art?: ReactNode;
  sections: SheetSection[];
  /** Shown above the list and never scrolled away: TV focus cannot reach rows that only show facts. */
  info?: SheetInfo[];
  /** Shown above the list and never scrolled away (the channel list's preview of the focused channel). */
  aside?: ReactNode;
  /** TV: a row took the focus. */
  onFocusKey?: (key: string) => void;
  onClose: () => void;
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const content = useRef<ComponentRef<typeof View> | null>(null);
  const [listHeight, setListHeight] = useState(0);
  // TV: keep the focused row in view (the middle of the list).
  const reveal = useCallback(
    (row: ComponentRef<typeof View> | null) => {
      if (!row || !content.current) return;
      row.measureLayout(
        content.current,
        (_x, y, _w, h) => scroll.current?.scrollTo({ y: Math.max(0, y - (listHeight - h) / 2), animated: true }),
        () => undefined,
      );
    },
    [listHeight],
  );
  // The first selected row takes the focus.
  const firstSelected = sections.flatMap((x) => x.rows).find((r) => r.selected)?.key ?? sections[0]?.rows[0]?.key;
  return (
    <ThemeContext.Provider value={darkTheme}>
      <Sheet visible={visible} title={title} subtitle={subtitle} art={art} onClose={onClose}>
        {info?.length ? (
          <View style={[styles.card, styles.above]}>
            {info.map((r, i) => (
              <InfoRow key={r.key} row={r} last={i === info.length - 1} />
            ))}
          </View>
        ) : null}
        {aside ? <View style={styles.above}>{aside}</View> : null}
        <ScrollView ref={scroll} style={styles.list} onLayout={(e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height)}>
          <View ref={content} style={styles.listInner}>
            {sections.map((s) => (
              <View key={s.title} style={styles.section}>
                {s.title ? <Text style={styles.sectionTitle}>{s.title}</Text> : null}
                <View style={styles.card}>
                  {s.rows.length === 0 ? <Text style={styles.empty}>{s.empty ?? 'None'}</Text> : null}
                  {s.rows.map((r, i) => (
                    <OptionRow
                      key={r.key}
                      row={r}
                      last={i === s.rows.length - 1}
                      preferredFocus={isTV && visible && r.key === firstSelected}
                      onFocusRow={
                        isTV
                          ? (v) => {
                              reveal(v);
                              onFocusKey?.(r.key);
                            }
                          : undefined
                      }
                      onPick={() => {
                        onClose();
                        // After the sheet has gone: a row can open a dialog or the next sheet.
                        if (!r.selected) afterSheets(r.onPress);
                      }}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </Sheet>
    </ThemeContext.Provider>
  );
}

function InfoRow({ row: r, last }: { row: SheetInfo; last: boolean }) {
  return (
    <View style={[styles.row, isTV && styles.rowTV, !last && styles.rowBorder]} accessible>
      <View style={styles.rowText}>
        <Text style={[styles.label, isTV && styles.labelTV]} numberOfLines={2}>
          {r.label}
        </Text>
        {r.detail ? (
          <Text style={[styles.detail, isTV && styles.detailTV]} numberOfLines={1}>
            {r.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function OptionRow({
  row: r,
  last,
  preferredFocus,
  onFocusRow,
  onPick,
}: {
  row: SheetRow;
  last: boolean;
  preferredFocus: boolean;
  onFocusRow?: (view: ComponentRef<typeof View> | null) => void;
  onPick: () => void;
}) {
  const ref = useRef<ComponentRef<typeof View> | null>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="radio"
      // The label alone: an icon in the row must not be read out.
      accessibilityLabel={r.detail ? `${r.label}, ${r.detail}` : r.label}
      accessibilityState={{ checked: r.selected }}
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocusRow?.(ref.current);
      }}
      onBlur={() => setFocused(false)}
      onPress={onPick}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        isTV && styles.rowTV,
        !last && styles.rowBorder,
        (pressed || hovered) && styles.rowActive,
        isTV && focused && styles.rowFocusTV,
      ]}>
      {r.icon ? <Icon name={r.icon} size={isTV ? scaled(iconSize.md) : iconSize.md} color={r.destructive ? c.danger : c.text2} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.label, isTV && styles.labelTV, r.selected && styles.labelOn, r.destructive && styles.labelDanger]} numberOfLines={2}>
          {r.label}
        </Text>
        {r.detail ? (
          <Text style={[styles.detail, isTV && styles.detailTV]} numberOfLines={1}>
            {r.detail}
          </Text>
        ) : null}
      </View>
      {r.selected ? <Icon name="checkmark" size={isTV ? scaled(iconSize.md) : iconSize.sm} color={c.accent} weight="semibold" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rowTV: { minHeight: scaled(56) },
  // TV: the shared row focus (design system §7.19): the fill only.
  rowFocusTV: { backgroundColor: mediaColors.tvRowFocus },
  labelTV: font(type.body),
  detailTV: font(type.footnote),
  // No grow, so a short sheet stays short; the list still shrinks to the panel's maximum height.
  list: { flexGrow: 0 },
  listInner: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { ...textStyle(type.footnote), fontWeight: '600', color: c.text2, marginLeft: spacing.lg },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  above: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowActive: { backgroundColor: c.surface3 },
  rowText: { flex: 1, gap: spacing.xxs },
  label: { ...textStyle(type.body), color: c.text },
  labelOn: { color: c.accent, fontWeight: '600' },
  labelDanger: { color: c.danger },
  detail: { ...textStyle(type.footnote), color: c.text2 },
  empty: { ...textStyle(type.callout), color: c.text3, padding: spacing.lg },
});
