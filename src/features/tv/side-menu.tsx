/**
 * The TV navigation: a side menu at the leading edge instead of the tab bar.
 * Closed, it is a slim rail of icons under a menu glyph. When the focus
 * comes into it (Left at the leading edge of the content), it opens over the
 * content with the labels. Right or Back closes it and gives the focus back
 * to the content. The tab stacks are the same as on phones.
 *
 * The open panel slides and fades in over the content (transform and opacity on
 * the UI thread). Nothing animates a size, so the content never lays out again
 * while the menu moves, and the content is not dimmed (like the streaming apps).
 */
import { type Href, router, usePathname } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger, useTabTrigger } from 'expo-router/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { type ComponentRef, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/icon';
import { tvKeyFromEvent } from '@/player/tv-keys';
import { isNativeTV, isTVPreview } from '@/platform/tv';
import { type AppTheme, createStyles, font, motion, radius, spacing, tv, tvSafeInset, tvScale, type, useLayout, useStyles, useTheme, webPressable, withAlpha } from '@/theme';

import { focusActivePage, type FocusTarget, focusView, isMenuFocused, noteRemoteKey, restoreContentFocus, setContentGuide, setMenuFocused, TvFocusGuide, tvPages } from './focus';
import { useTvBack } from './use-tv-back';
import { useTvRemote } from './use-tv-remote';
import { installWebSpatialNav } from './web-spatial-nav';

interface Destination {
  /** The tab name; null for a page that is not a tab (Settings). */
  name: string | null;
  href: Href;
  label: string;
  icon: IconName;
}

/** The menu, top to bottom. Downloads, watch together and extension panels are not on TV. */
const DESTINATIONS: Destination[] = [
  { name: 'home', href: '/', label: 'Home', icon: 'house' },
  { name: 'search', href: '/search', label: 'Search', icon: 'magnifyingglass' },
  { name: 'library', href: '/libraries', label: 'Library', icon: 'square.stack' },
  { name: 'music', href: '/music', label: 'Music', icon: 'music.note' },
  { name: 'live', href: '/(tabs)/(live)/live-tv', label: 'Live TV', icon: 'tv' },
  { name: null, href: '/settings', label: 'Settings', icon: 'gearshape' },
];

const STANDARD = Easing.bezier(...motion.easing.standard);

/** The TV window never changes size, so the menu sizes are fixed. */
const K = tvScale(Dimensions.get('window').width);
const ICON = Math.round(tv.railIcon * K);
/** The overscan-safe inset: the items and their focus fill start inside it. */
const SAFE = tvSafeInset(Dimensions.get('window').width);
/** The gap between an item's focus fill and the rail's trailing edge. */
const ITEM_END = spacing.sm;
/** The icon's inset in its item, so the icon sits centred in the closed item. */
const iconInset = (railWidth: number) => Math.round((railWidth - SAFE.x - ITEM_END - ICON) / 2);

/** The (tabs) layout on TV: the tab content after the rail, and the side menu over it. */
export function TvTabsLayout() {
  const l = useLayout();
  const rail = Math.round(tv.railWidth * tvScale(l.width));
  const home = usePathname() === '/';
  const content = useRef<ComponentRef<typeof View> | null>(null);
  // The visible page of the tab stacks (Android TV). A focus that comes into the
  // content goes there, never to a page under it that is still in the window.
  const [page, setPage] = useState<FocusTarget | null>(null);
  useEffect(() => {
    setContentGuide(content.current);
    const sync = () => setPage(tvPages.active()?.guide.current ?? null);
    const off = tvPages.subscribe(sync);
    // The first page registers before this effect runs.
    sync();
    return () => {
      off();
      setContentGuide(null);
    };
  }, []);
  // Every remote key, so a page can tell a move into the side menu from a focus Android put there.
  useTvRemote(isNativeTV, (e) => {
    const k = tvKeyFromEvent(e);
    if (k) noteRemoteKey(k.key);
  });
  return (
    <Tabs style={styles.flex}>
      {/* First in the tree, so the content (not the menu) takes the first focus. */}
      {/*
        The pages start inside the overscan-safe area at the top and the bottom (theme/layout
        `tv.safeY`). Home is the exception at the top: its billboard art runs to the top edge, and
        its text and rows start well below the safe line.
      */}
      <TvFocusGuide ref={content} autoFocus destinations={[page]} style={[styles.flex, { paddingLeft: rail, paddingTop: home ? 0 : l.safe.y, paddingBottom: l.safe.y }]}>
        <TabSlot />
      </TvFocusGuide>
      <SideMenu content={content} />
      <TabList style={styles.hidden}>
        {DESTINATIONS.filter((d) => d.name).map((d) => (
          <TabTrigger key={d.name} name={d.name ?? ''} href={d.href} />
        ))}
      </TabList>
    </Tabs>
  );
}

/** Sends the focus back to the content: the visible page (its last focused control), or the content guide. */
function focusContent(content: RefObject<FocusTarget | null>): void {
  if (!isNativeTV) restoreContentFocus();
  else if (!focusActivePage()) focusView(content.current);
}

function SideMenu({ content }: { content: RefObject<FocusTarget | null> }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const reduced = useReducedMotion();
  const pathname = usePathname();
  const railW = Math.round(tv.railWidth * tvScale(l.width));
  const menuW = Math.round(tv.menuWidth * tvScale(l.width));
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The selected item: the focus lands on it when it comes into the menu.
  const [active, setActive] = useState<FocusTarget | null>(null);
  const root = useRef<FocusTarget | null>(null);
  const settings = pathname === '/settings';

  const onItemFocus = useCallback(() => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
    setMenuFocused(true);
    setOpen(true);
  }, []);
  // The focus moves from item to item as a blur then a focus: close only when no item takes it.
  const onItemBlur = useCallback(() => {
    setMenuFocused(false);
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), 60);
  }, []);
  useEffect(() => () => {
    if (closing.current) clearTimeout(closing.current);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    focusContent(content);
  }, [content]);

  // Back closes the open menu (and stays in the app).
  useTvBack(open, close);
  // Native TV: so does Right. Android's focus search does not find the content
  // from the open menu, which lies over the content's first column.
  // The menu can hold the focus closed too (Android put it there): Right leaves it the same way.
  useTvRemote(isNativeTV, (e) => {
    if ((open || isMenuFocused()) && tvKeyFromEvent(e)?.key === 'right') close();
  });

  // Web preview: the arrow keys move the focus; Right out of the menu goes back to the content.
  useEffect(() => {
    if (!isTVPreview) return;
    const remove = installWebSpatialNav();
    const onKey = (e: KeyboardEvent) => {
      const el = root.current as unknown as HTMLElement | null;
      if (e.key !== 'ArrowRight' || !el || !el.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      remove();
      document.removeEventListener('keydown', onKey, true);
    };
  }, [close]);

  // 0 closed, 1 open. The panel and the labels follow it on the UI thread.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming(open ? 1 : 0, { duration: reduced ? 0 : motion.duration.fast, easing: STANDARD }));
  }, [open, reduced, progress]);
  const panel = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: (progress.get() - 1) * (menuW - railW) }],
  }));

  return (
    <TvFocusGuide
      ref={root}
      destinations={[active]}
      style={[s.rail, { width: railW }]}
      accessibilityRole="menu"
      accessibilityLabel="Menu">
      {/* The closed rail: a dark edge, so the icons read over the content. */}
      <LinearGradient
        colors={[withAlpha(c.bg, 0.96), withAlpha(c.bg, 0)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Open, the panel is solid: the labels never sit on the content's text. It slides in from under the rail. */}
      <Animated.View pointerEvents="none" style={[s.panel, s.panelBg, { width: menuW }, panel]} />
      {/* The items change width once when the menu opens or closes; the panel above does the motion. */}
      <View style={[s.panel, { width: open ? menuW : railW }]}>
        <View style={[s.menuGlyph, { paddingLeft: SAFE.x + iconInset(railW) }]} accessible={false}>
          <Icon name="line.horizontal.3" size={ICON} color={open ? c.text : c.text2} />
        </View>
        <View style={s.items}>
          {DESTINATIONS.map((d) => (
            <MenuItem
              key={d.label}
              destination={d}
              open={open}
              settings={settings}
              railWidth={railW}
              progress={progress}
              onSelected={setActive}
              onFocus={onItemFocus}
              onBlur={onItemBlur}
              onDone={close}
            />
          ))}
        </View>
      </View>
    </TvFocusGuide>
  );
}

function MenuItem({
  destination,
  open,
  settings,
  railWidth,
  progress,
  onSelected,
  onFocus,
  onBlur,
  onDone,
}: {
  destination: Destination;
  open: boolean;
  /** Settings is open (it is a page in the Home stack, not a tab). */
  settings: boolean;
  railWidth: number;
  /** The menu's open progress (0 to 1): the labels fade in with the panel. */
  progress: SharedValue<number>;
  onSelected: (view: FocusTarget | null) => void;
  onFocus: () => void;
  onBlur: () => void;
  onDone: () => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  // Settings is not a tab: its trigger lookup is unused.
  const tab = useTabTrigger({ name: destination.name ?? 'home' });
  const selected = destination.name ? !settings && !!tab.trigger?.isFocused : settings;
  const view = useRef<FocusTarget | null>(null);
  const labelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  useEffect(() => {
    if (selected) onSelected(view.current);
  }, [selected, onSelected]);

  const go = () => {
    // A tab opens at its first page, like the streaming apps. switchTab resets only
    // a tab it switches to, so the open tab (Home under Settings, a tab on an item
    // page) goes back to its first page through its stack.
    if (destination.name && tab.trigger?.isFocused) {
      if (router.canDismiss()) router.dismissTo(destination.href);
    } else if (destination.name) tab.switchTab(destination.name, { resetOnFocus: true });
    else router.navigate('/(tabs)/(home)/settings');
    // Let the new screen mount, then give it the focus.
    setTimeout(onDone, 80);
  };

  const fg = focused ? c.bg : selected ? c.text : c.text2;
  return (
    <Pressable
      ref={view}
      onPress={go}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      accessibilityRole="menuitem"
      accessibilityLabel={destination.label}
      accessibilityState={{ selected }}
      style={[s.item, webPressable]}>
      <View style={[s.itemInner, { paddingLeft: iconInset(railWidth) }, focused && s.itemFocused]}>
        {selected && !focused ? <View style={s.selectedBar} /> : null}
        <Icon name={destination.icon} size={ICON} color={fg} weight={selected ? 'semibold' : 'regular'} />
        {open ? (
          <Animated.Text style={[s.label, { color: fg }, selected && s.labelSelected, labelStyle]} numberOfLines={1}>
            {destination.label}
          </Animated.Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
    rail: { position: 'absolute' as const, left: 0, top: 0, bottom: 0, overflow: 'visible' as const },
    panel: { position: 'absolute' as const, left: 0, top: 0, bottom: 0, overflow: 'hidden' as const },
    panelBg: { backgroundColor: withAlpha(c.bg, 0.97) },
    menuGlyph: { paddingTop: SAFE.y + spacing.sm, paddingBottom: spacing.xl },
    items: { flex: 1, justifyContent: 'center' as const, gap: spacing.xs, paddingBottom: spacing.huge },
    item: { paddingLeft: SAFE.x, paddingRight: ITEM_END },
    itemInner: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.lg,
      minHeight: Math.round(tv.railItemHeight * K),
      paddingRight: spacing.lg,
      borderRadius: radius.md,
    },
    itemFocused: { backgroundColor: c.text },
    selectedBar: { position: 'absolute' as const, left: 0, top: '25%' as const, bottom: '25%' as const, width: 3, borderRadius: 2, backgroundColor: c.accent },
    label: { ...font(type.title3), flexShrink: 1 },
    labelSelected: { fontWeight: '700' as const },
}));
