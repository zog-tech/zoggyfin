import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isTV } from '@/platform/tv';
import { type AppTheme, font, fontFamily, spacing, type, useLayout, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

/** Native stack options for a tab stack, in the active scheme. */
export function stackOptionsFor({ c }: AppTheme): NativeStackNavigationOptions {
  return {
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.text, fontWeight: font(type.headline).fontWeight },
    headerLargeTitleShadowVisible: false,
    headerShadowVisible: false,
    headerTransparent: false,
    headerStyle: { backgroundColor: c.bg },
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: c.bg },
    // TV: the rail is the navigation; no header bar. Web keeps a slim header.
    headerShown: !isTV,
    // Web and TV change pages at once: a push animation on a TV stick costs frames and feels slow.
    ...(Platform.OS === 'web' || isTV ? { animation: 'none' as const } : null),
  };
}

export function useStackOptions(): NativeStackNavigationOptions {
  const t = useTheme();
  return useMemo(() => stackOptionsFor(t), [t]);
}

/**
 * Options for a tab stack. On iPad the content starts after a visible
 * sidebar (`inset`), so nothing sits under it.
 */
export function useTabStackOptions(inset: number): NativeStackNavigationOptions {
  const base = useStackOptions();
  return useMemo(
    () => (inset > 0 ? { ...base, contentStyle: [base.contentStyle, { paddingLeft: inset }] } : base),
    [base, inset],
  );
}

/** The slim web header of a root page (the default React Navigation header is 64 px). */
export const WEB_ROOT_BAR_HEIGHT = 44;

/**
 * For a tab's first screen: a compact header, so the content starts at the
 * top of the window. The tab bar (or the iPad sidebar) already says where
 * the person is, so a root page shows no title.
 *
 * - `bar: false` (the default): no header at all. The screen pads its top
 *   by the safe-area inset (the status bar), so the first row starts right
 *   under it.
 * - `bar: true`: a slim header with no title, for a page that has buttons
 *   or a native search field in it (Home: the profile button). A page can
 *   still set a short `headerTitle` when the title carries information
 *   (the picked Music library).
 *
 * `title` stays the screen's name (the web page title, accessibility).
 * Scroll views keep `contentInsetAdjustmentBehavior="automatic"` for the
 * bottom (the iOS tab bar). TV shows no header (`stackOptionsFor`).
 */
export function useRootScreenOptions({ bar = false, background }: { bar?: boolean; background?: string } = {}): NativeStackNavigationOptions {
  const { c } = useTheme();
  const { gutter } = useLayout();
  const top = useSafeAreaInsets().top;
  const sidebar = useSidebarInset();
  const bg = background ?? c.bg;
  return useMemo((): NativeStackNavigationOptions => {
    // iPad: the content starts after the sidebar, as in useTabStackOptions (a screen's contentStyle replaces the stack's).
    const side = sidebar > 0 ? { paddingLeft: sidebar } : null;
    if (!bar || isTV) {
      return {
        headerShown: false,
        headerLargeTitleEnabled: false,
        // The header held the status bar inset; the screen keeps it, so nothing sits under the clock.
        contentStyle: [{ backgroundColor: bg, paddingTop: isTV ? 0 : top + spacing.xs }, side],
      };
    }
    return {
      headerShown: true,
      headerLargeTitleEnabled: false,
      headerTitle: '',
      headerStyle: { backgroundColor: bg },
      contentStyle: [{ backgroundColor: bg }, side],
      ...(Platform.OS === 'web'
        ? {
            headerTitleAlign: 'left' as const,
            headerTitleStyle: { color: c.text, fontSize: type.headline.fontSize, fontWeight: font(type.headline).fontWeight, fontFamily: fontFamily.web },
            // The web header (React Navigation elements) takes these; the native-stack types do not list them.
            ...({
              headerStyle: { backgroundColor: bg, height: WEB_ROOT_BAR_HEIGHT },
              headerTitleContainerStyle: { marginLeft: gutter },
              headerRightContainerStyle: { paddingRight: gutter },
            } as NativeStackNavigationOptions),
          }
        : null),
    };
  }, [c, gutter, bar, bg, top, sidebar]);
}

/** Detail pages draw their own hero under a transparent header. */
export const detailScreenOptions: NativeStackNavigationOptions = {
  headerTransparent: true,
  headerTitle: '',
  headerStyle: { backgroundColor: 'transparent' },
  // iOS 26 dims content under a transparent bar. The hero has its own top scrim.
  scrollEdgeEffects: { top: 'hidden' },
};

/**
 * Pages with swipeable song rows (album, artist, playlist, a music library).
 * iOS 26 pops a page on a swipe right anywhere in its content, and that swipe
 * would take the row's "Play next" swipe. These pages keep only the swipe
 * from the left edge, which the rows leave free (`swipe-logic.ts` EDGE_X).
 */
export const rowSwipeScreenOptions: NativeStackNavigationOptions = Platform.OS === 'ios' && !isTV ? { fullScreenGestureEnabled: false } : {};
