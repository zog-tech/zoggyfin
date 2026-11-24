/**
 * TV Modern look (design system §7.22): the page header of the browse and
 * system pages (a library grid, a genre, Music, Settings) and the one-line
 * text toolbar under it.
 *
 * The title sits at the page edge, `safe.y + 20 u` from the top, with 28 u
 * to the first control. The toolbar is one line that never wraps: when its
 * items do not fit, it scrolls sideways with the focus (a horizontal
 * ScrollView brings the focused item into view). It shifts left by an
 * item's side padding, so the first word starts on the page edge and the
 * focus plate reaches into the gutter. Modern only: Classic pages keep
 * their own layout and never render these.
 */
import { type ComponentRef, type ReactNode, type Ref } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { dark, tvFont, tvm, u } from '@/theme';

const TITLE_TOP = u(20);
/** The room between the page title and the first control. */
export const TV_TITLE_GAP = u(28);
/** The room between the toolbar and the content under it. */
export const TV_TOOLBAR_GAP = u(28);
/** The side padding of a toolbar item: the toolbar shifts left by it. */
export const TV_TOOLBAR_SHIFT = u(tvm.size.toolbarPadX);

/**
 * The page title (`pageTitle`, white). The tab content already starts under
 * the top of the safe area (`TvContent`), so 20 u more puts the title at
 * `safe.y + 20 u`. `top` replaces the 20 u.
 */
export function TvPageTitle({ title, top = TITLE_TOP }: { title: string; top?: number }) {
  return (
    <Text style={[styles.title, { marginTop: top }]} numberOfLines={1} accessibilityRole="header">
      {title}
    </Text>
  );
}

/**
 * A one-line row of toolbar items (or tabs). `inset` is the left edge of
 * the page content inside the scroll view (the gutter of the page): the
 * row starts at it minus the item padding and scrolls to the right edge.
 */
export function TvToolbarRow({
  children,
  inset,
  tabs,
  ref,
}: {
  children: ReactNode;
  inset: number;
  /** A row of tabs: room under it for the Ember underline, which hangs under the tab box (the scroll view clips). */
  tabs?: boolean;
  ref?: Ref<ComponentRef<typeof ScrollView>>;
}) {
  return (
    <View style={[styles.wrap, { marginHorizontal: -inset }]}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={[styles.row, tabs && styles.tabRow, { paddingLeft: inset - TV_TOOLBAR_SHIFT, paddingRight: inset }]}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...tvFont(tvm.type.pageTitle), color: dark.text, marginBottom: TV_TITLE_GAP },
  wrap: { flexGrow: 0 },
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: u(tvm.size.toolbarGap) },
  tabRow: { paddingBottom: u(tvm.size.underlineGap + tvm.size.underline) },
});
