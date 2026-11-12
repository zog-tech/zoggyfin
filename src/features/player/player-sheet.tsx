import { type ComponentRef, type ReactNode, useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { MODAL_ORIENTATIONS } from '@/components/sheet-layout';
import { isTV } from '@/platform/tv';
import { font, mediaColors, scaled } from '@/theme';

import { c, iconSize, radius, spacing, textStyle, type } from './tokens';

export interface SheetRow {
  key: string;
  label: string;
  detail?: string | null;
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
  title: string;
  rows: SheetRow[];
  empty?: string;
}

/**
 * The player's option sheet (Audio & Subtitles, Quality & Speed). Always
 * dark. Picking a row closes the sheet. TV: the selected row takes the first
 * focus, the focused row is filled and marked, and the list scrolls to keep
 * it in the middle. Back closes the sheet (the Modal's onRequestClose).
 */
export function PlayerSheet({
  visible,
  title,
  sections,
  info,
  aside,
  onFocusKey,
  onClose,
}: {
  visible: boolean;
  title: string;
  sections: SheetSection[];
  /** Shown above the list and never scrolled away: TV focus cannot reach rows that only show facts. */
  info?: SheetInfo[];
  /** Shown above the list and never scrolled away (the channel list's preview of the focused channel). */
  aside?: ReactNode;
  /** TV: a row took the focus. */
  onFocusKey?: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={MODAL_ORIENTATIONS}>
      <Pressable style={styles.backdrop} onPress={onClose} focusable={!isTV} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, isTV && styles.sheetTV, { paddingBottom: insets.bottom + spacing.md }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={[styles.title, isTV && styles.titleTV]} accessibilityRole="header">
            {title}
          </Text>
          {/* TV: Back closes the sheet; a Done stop would only be in the way. */}
          {isTV ? null : (
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          )}
        </View>
        {info?.length ? (
          <View style={[styles.card, styles.infoCard]}>
            {info.map((r, i) => (
              <InfoRow key={r.key} row={r} last={i === info.length - 1} />
            ))}
          </View>
        ) : null}
        {aside ? <View style={styles.aside}>{aside}</View> : null}
        <ScrollView
          ref={scroll}
          style={styles.list}
          onLayout={(e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height)}
          contentContainerStyle={styles.listContent}>
          <View ref={content} style={styles.listInner}>
          {sections.map((s) => (
            <View key={s.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
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
                      if (!r.selected) r.onPress();
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
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
      <View style={styles.rowText}>
        <Text style={[styles.label, isTV && styles.labelTV, r.selected && styles.labelOn]} numberOfLines={2}>
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
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    maxHeight: '75%',
    backgroundColor: c.surface2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: 'continuous',
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  title: { ...textStyle(type.headline), color: c.text },
  // TV: a wider, taller sheet in the middle with 10-foot text.
  sheetTV: { maxWidth: 760, maxHeight: '85%', bottom: undefined, top: '7.5%', borderRadius: radius.xl },
  titleTV: font(type.title2),
  rowTV: { minHeight: scaled(56) },
  // TV: the shared row focus (design system §7.19): the fill only.
  rowFocusTV: { backgroundColor: mediaColors.tvRowFocus },
  labelTV: font(type.body),
  detailTV: font(type.footnote),
  listInner: { gap: spacing.lg },
  done: { ...textStyle(type.headline), color: c.accent },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { ...textStyle(type.footnote), color: c.text2, marginLeft: spacing.sm, textTransform: 'uppercase' },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  infoCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  aside: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowActive: { backgroundColor: c.surface3 },
  rowText: { flex: 1, gap: spacing.xxs },
  label: { ...textStyle(type.body), color: c.text },
  labelOn: { color: c.accent, fontWeight: '600' },
  detail: { ...textStyle(type.footnote), color: c.text2 },
  empty: { ...textStyle(type.callout), color: c.text3, padding: spacing.lg },
});
