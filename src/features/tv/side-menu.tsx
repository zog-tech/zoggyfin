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
 * The items are clipped at the panel's moving edge (a clip that slides with the
 * panel, and the items slid back the same distance), so the focus fill and the
 * labels never show outside the panel. On close they keep the open layout
 * until the panel is gone.
 */
import { type Href, router, usePathname } from 'expo-router';
import { TabList, Tabs, type TabsDescriptor, TabSlot, type TabsSlotRenderOptions, TabTrigger, useTabTrigger } from 'expo-router/ui';
import { Screen } from 'react-native-screens';
import { TvVisibility } from '@/native/tv-visibility';

import { useTvChrome } from './chrome-store';
import { LinearGradient } from 'expo-linear-gradient';
import { type ComponentRef, memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { openFullPlayer } from '@/player';
import { usePlayerStore } from '@/player/store';
import { pageHref, pagePathname } from '@/features/extensions/nav';
import { usePagePlacement } from '@/features/extensions/use-placement';
import { tvKeyFromEvent } from '@/player/tv-keys';
import { isNativeTV, isTVPreview } from '@/platform/tv';
import { type AppTheme, createStyles, font, motion, radius, spacing, tv, tvSafeInset, tvScale, type, useLayout, useStyles, useTheme, webPressable, withAlpha } from '@/theme';

import { focusActivePage, type FocusTarget, focusView, isMenuFocused, noteRemoteKey, restoreContentFocus, setContentGuide, setMenuFocused, TvFocusGuide, tvPages } from './focus';
import { useTvBack } from './use-tv-back';
import { useTvRemote } from './use-tv-remote';
import { installWebSpatialNav } from './web-spatial-nav';

interface Destination {
  key: string;
  /** The tab name; null for a page that is not a tab (Settings, an extension page). */
  name: string | null;
  href: Href;
  /** A page that is not a tab: its pathname, which marks it as selected. */
  path?: string;
  label: string;
  icon: IconName;
}

/** The menu, top to bottom. Downloads, watch together and extension panels are not on TV. */
const DESTINATIONS: Destination[] = [
  { key: 'home', name: 'home', href: '/', label: 'Home', icon: 'house' },
  { key: 'search', name: 'search', href: '/search', label: 'Search', icon: 'magnifyingglass' },
  { key: 'library', name: 'library', href: '/libraries', label: 'Library', icon: 'square.stack' },
  { key: 'music', name: 'music', href: '/music', label: 'Music', icon: 'music.note' },
  { key: 'live', name: 'live', href: '/(tabs)/(live)/live-tv', label: 'Live TV', icon: 'tv' },
];

/** Settings is a page in the Home stack, not a tab. */
const SETTINGS: Destination = { key: 'settings', name: null, href: '/(tabs)/(home)/settings', path: '/settings', label: 'Settings', icon: 'gearshape' };

/**
 * The menu with the extension pages that ask for a place (features/extensions/placement.ts)
 * before Settings. They are pages in the Library stack, not tabs, so the tab list does not change.
 */
function useDestinations(): Destination[] {
  const pages = usePagePlacement().tvMenu;
  return useMemo(
    () => [
      ...DESTINATIONS,
      ...pages.map(
        (p): Destination => ({
          key: `ext:${p.extId}:${p.pageId}`,
          name: null,
          href: pageHref('(library)', p.extId, p.pageId),
          path: pagePathname(p.extId, p.pageId),
          label: p.title,
          icon: p.icon,
        }),
      ),
      SETTINGS,
    ],
    [pages],
  );
}

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

/**
 * The (tabs) layout on TV: the tab content after the rail, and the side menu over it. It reads no
 * route state itself (the parts that follow the page are in `TvContent` and `SideMenu`), so a
 * navigation does not render the tab navigator again from here: that cost about 270 ms on a TV
 * stick, twice per tab switch.
 */
export function TvTabsLayout() {
  const content = useRef<ComponentRef<typeof View> | null>(null);
  // Every remote key, so a page can tell a move into the side menu from a focus Android put there.
  useTvRemote(isNativeTV, (e) => {
    const k = tvKeyFromEvent(e);
    if (k) noteRemoteKey(k.key);
  });
  return (
    <Tabs style={styles.flex}>
      {/* First in the tree, so the content (not the menu) takes the first focus. */}
      <TvContent content={content} />
      <SideMenu content={content} />
      <TabList style={styles.hidden}>
        {DESTINATIONS.map((d) => (
          <TabTrigger key={d.name} name={d.name ?? ''} href={d.href} />
        ))}
      </TabList>
    </Tabs>
  );
}

/** The tab content after the rail. It follows the page (its top inset, the visible page for the focus). */
function TvContent({ content }: { content: RefObject<ComponentRef<typeof View> | null> }) {
  const l = useLayout();
  const rail = Math.round(tv.railWidth * tvScale(l.width));
  const pathname = usePathname();
  // Home and item pages draw their art from the screen's top edge; their text keeps clear of the inset.
  const fullBleed = pathname === '/' || /\/item\//.test(pathname);
  // The visible page of the tab stacks (Android TV). A focus that comes into the
  // content goes there, never to a page under it that is still in the window.
  const [page, setPage] = useState<FocusTarget | null>(null);
  const shownTab = useTvChrome((st) => st.shownTab);
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
  }, [content]);
  return (
    /*
      The pages start inside the overscan-safe area at the top (theme/layout `tv.safeY`), except
      Home and item pages, whose art runs to the top edge. At the bottom every page runs on to the
      edge (the next row peeks in, as in the streaming apps); scroll views pad their own end.
    */
    <TvFocusGuide ref={content} autoFocus destinations={[page]} style={[styles.flex, { paddingLeft: rail, paddingTop: fullBleed ? 0 : l.safe.y, paddingBottom: 0 }]}>
      <TabSlot detachInactiveScreens={!TvVisibility} renderFn={(d, o) => renderTvTab(d, o, shownTab)} />
    </TvFocusGuide>
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
  const destinations = useDestinations();
  // A page that is not a tab is open (Settings, an extension page): it is the selected item, not its stack's tab.
  const pageOpen = destinations.some((d) => !d.name && d.path === pathname);

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

  // The items keep the open layout (labels, full width) from the open until the close animation ends.
  const [wide, setWide] = useState(false);
  if (open && !wide) setWide(true);
  // 0 closed, 1 open. The panel, the items' clip and the labels follow it on the UI thread.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(open ? 1 : 0, { duration: reduced ? 0 : motion.duration.fast, easing: STANDARD }, (done) => {
        // A close that ran to its end (an open in the middle cancels it).
        if (done && !open) scheduleOnRN(setWide, false);
      }),
    );
  }, [open, reduced, progress]);
  useEffect(() => {
    useTvChrome.setState({ menuOpen: open });
  }, [open]);
  const slide = menuW - railW;
  const panel = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateX: (progress.get() - 1) * slide }],
  }));
  const dim = useAnimatedStyle(() => ({ opacity: progress.get() }));
  // The clip's trailing edge is the panel's; the items inside stay still.
  const clip = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * slide }] }));
  const unclip = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - progress.get()) * slide }] }));

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
      {/* Open, the page behind dims (as in the streaming apps), so the eye goes to the menu. It fades with the panel. */}
      <Animated.View pointerEvents="none" style={[s.panel, { width: l.width }, dim]}>
        <LinearGradient
          colors={[withAlpha(c.bg, 0.92), withAlpha(c.bg, 0.55)]}
          locations={[menuW / Math.max(1, l.width), 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {/* Open, the panel is solid: the labels never sit on the content's text. It slides in from under the rail. */}
      <Animated.View pointerEvents="none" style={[s.panel, s.panelBg, { width: menuW }, panel]} />
      {/*
        The items change width once when the menu opens (and once the close ends); the clip around
        them slides with the panel, so they show only where the panel is.
      */}
      <Animated.View style={[s.panel, { width: menuW }, clip]}>
        <Animated.View style={[s.panel, { width: wide ? menuW : railW }, unclip]}>
          <View style={[s.menuGlyph, { paddingLeft: SAFE.x + iconInset(railW) }]} accessible={false}>
            <Icon name="line.horizontal.3" size={ICON} color={open ? c.text : c.text2} />
          </View>
          <View style={s.items}>
            <NowPlayingItem open={wide} railWidth={railW} progress={progress} onFocus={onItemFocus} onBlur={onItemBlur} />
            {destinations.map((d) => (
              <MenuItem
                key={d.key}
                destination={d}
                open={wide}
                pageOpen={pageOpen}
                pathname={pathname}
                railWidth={railW}
                progress={progress}
                onSelected={setActive}
                onFocus={onItemFocus}
                onBlur={onItemBlur}
                onDone={close}
              />
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </TvFocusGuide>
  );
}

function MenuItem({
  destination,
  open,
  pageOpen,
  pathname,
  railWidth,
  progress,
  onSelected,
  onFocus,
  onBlur,
  onDone,
}: {
  destination: Destination;
  open: boolean;
  /** A page that is not a tab is open (Settings, an extension page). */
  pageOpen: boolean;
  pathname: string;
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
  // A page that is not a tab: its trigger lookup is unused.
  const tab = useTabTrigger({ name: destination.name ?? 'home' });
  const selected = destination.name ? !pageOpen && !!tab.trigger?.isFocused : pathname === destination.path;
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
    } else if (destination.name) {
      // Reset only a tab with pages pushed on it (an album, an item). A tab at its first page opens
      // as it was: a reset dropped its state and built the whole tab again (seconds on a TV stick).
      const route = tab.trigger?.route;
      const pushed = (route?.state?.index ?? 0) > 0;
      const name = destination.name;
      // A built tab at its first page shows now; the router follows after this frame.
      if (TvVisibility && route?.state && !pushed) {
        useTvChrome.setState({ shownTab: route.name });
        // The menu closes now; the focus goes into the new page once the router knows it is the page.
        onDone();
        setTimeout(() => {
          tab.switchTab(name, { resetOnFocus: false });
          setTimeout(() => {
            useTvChrome.setState({ shownTab: null });
            onDone();
          }, 0);
        }, 16);
        return;
      } else tab.switchTab(name, { resetOnFocus: pushed });
    }
    else router.navigate(destination.href);
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

/**
 * While music plays: the first entry of the menu, with the cover in place of an icon (so the
 * closed rail shows what plays). One Left and Select open the player from any page; on TV
 * there is no mini player over the content to reach with the D-pad.
 */
function NowPlayingItem({
  open,
  railWidth,
  progress,
  onFocus,
  onBlur,
}: {
  open: boolean;
  railWidth: number;
  progress: SharedValue<number>;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const item = usePlayerStore((st) => (st.now?.kind === 'audio' ? st.now.item : null));
  const labelStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  if (!item) return null;
  return (
    <Pressable
      onPress={openFullPlayer}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      accessibilityRole="menuitem"
      accessibilityLabel={`Now playing: ${item.Name ?? ''}. Opens the player`}
      style={[s.item, s.nowItem, webPressable]}>
      <View style={[s.itemInner, { paddingLeft: iconInset(railWidth) }, focused && s.itemFocused]}>
        <ItemImage item={item} variant="square" width={ICON} aspectRatio={1} rounded={radius.xs} hideArtTitle />
        {open ? (
          <Animated.View style={[s.nowText, labelStyle]}>
            <Text style={[s.nowLabel, { color: focused ? c.bg : c.text2 }]} numberOfLines={1}>
              Now playing
            </Text>
            <Text style={[s.label, { color: focused ? c.bg : c.text }]} numberOfLines={1}>
              {item.Name ?? ''}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The tab screens on TV. Like expo-router's own (the hidden tabs stay mounted and keep their state,
 * focus memory and scroll), without what made a tab switch take seconds:
 * - A hidden tab is not `display: none`, which made the new renderer drop every native view under
 *   it and build them all again on the next visit. It sits in `TvVisibility` (Android
 *   `View.INVISIBLE`): not drawn, no focus, its views and images kept. A build without that
 *   module detaches the hidden tab with react-native-screens instead (a detached tab could come
 *   back with images it never drew, so the visibility container comes first).
 * - No `freezeOnBlur`: a frozen tab is hidden through Suspense, which sets `display: none` again.
 * - A tab picked in the side menu that is already built shows at once (`shownTab`): the router's
 *   switch took about a second of JS work on a TV stick before anything changed on screen.
 */
/**
 * A tab's screen renders again only when its own route changes (a push in its stack). The tab
 * navigator renders every tab on each switch; the hidden Music browser took 370 ms of it.
 */
const TabScreen = memo(
  function TabScreen({ descriptor }: { descriptor: TabsDescriptor }) {
    return descriptor.render();
  },
  (a, b) => a.descriptor.route === b.descriptor.route,
);

function renderTvTab(descriptor: TabsDescriptor, { isFocused: routed, loaded, detachInactiveScreens }: TabsSlotRenderOptions, shown: string | null) {
  // A tab picked in the menu shows at once, before the router switches (`shownTab`).
  const isFocused = shown ? descriptor.route.name === shown : routed;
  if (!loaded && !isFocused) return null;
  if (TvVisibility) {
    return (
      <TvVisibility key={descriptor.route.key} hidden={!isFocused} style={[StyleSheet.absoluteFill, isFocused ? styles.tabFocused : styles.tabHidden]}>
        <TabScreen descriptor={descriptor} />
      </TvVisibility>
    );
  }
  return (
    <Screen
      key={descriptor.route.key}
      enabled={detachInactiveScreens}
      activityState={isFocused ? 2 : 0}
      style={[StyleSheet.absoluteFill, isFocused ? styles.tabFocused : styles.tabHidden]}>
      <TabScreen descriptor={descriptor} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabFocused: { zIndex: 1 },
  tabHidden: { zIndex: -1 },
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
    nowItem: { marginBottom: spacing.lg },
    nowText: { flex: 1 },
    nowLabel: { ...font(type.caption1), textTransform: 'uppercase' as const, letterSpacing: 0.8 },
    selectedBar: { position: 'absolute' as const, left: 0, top: '25%' as const, bottom: '25%' as const, width: 3, borderRadius: 2, backgroundColor: c.accent },
    label: { ...font(type.title3), flexShrink: 1 },
    labelSelected: { fontWeight: '700' as const },
}));
