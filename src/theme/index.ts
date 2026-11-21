/**
 * The app theme. Tokens are in theme.ts (a copy of docs/design/theme.ts);
 * this file adds the active colour scheme, text helpers and component sizes.
 * Screens never put a raw colour or size in a style: they use these values.
 */
import { createContext, useContext, useMemo } from 'react';
import { Dimensions, type ImageStyle, Platform, StyleSheet, type TextStyle, useWindowDimensions, type ViewStyle } from 'react-native';

import { isTV } from '@/platform/tv';

import { layoutFor, type LayoutInfo, tv, tvScale } from './layout';
import { useSidebarInset } from './sidebar-inset';
import {
  arabicLineHeightFactor,
  type ColorScheme,
  type ColorTokens,
  dark,
  elevation,
  fontFamily,
  hasArabic,
  light as lightTokens,
  type Shadow,
  textDirection,
  type TypeToken,
} from './theme';

export * from './theme';
export { gridLayout, layoutFor, type LayoutInfo, type SafeInset, tv, tvFocusBleed, tvPageEndPadding, tvRowInset, tvSafeInset, tvScale } from './layout';

// ---------------------------------------------------------------------------
// Active scheme
// ---------------------------------------------------------------------------

export interface AppTheme {
  scheme: ColorScheme;
  c: ColorTokens;
  /** Shadow for an elevation level in this scheme. */
  shadow: (level: keyof typeof elevation) => Shadow;
}

export function makeTheme(scheme: ColorScheme): AppTheme {
  const c = scheme === 'light' ? lightTokens : dark;
  return { scheme, c, shadow: (level) => elevation[level][scheme] };
}


export const darkTheme = makeTheme('dark');
export const lightTheme = makeTheme('light');

export const ThemeContext = createContext<AppTheme>(darkTheme);

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Declares scheme-dependent styles. Wrapping the factory gives its object
 * literal the RN style types, so `'row'` stays `'row'` and not `string`.
 */
export function createStyles<T extends NamedStyles<T>>(factory: (t: AppTheme) => T & NamedStyles<T>): (t: AppTheme) => T {
  return factory;
}

/**
 * Styles that depend on the scheme. The factory runs once per scheme change.
 * Example: `const s = useStyles(makeStyles)` with
 * `const makeStyles = createStyles(({ c }) => ({ root: { backgroundColor: c.bg } }))`.
 */
export function useStyles<T extends NamedStyles<T>>(factory: (t: AppTheme) => T): T {
  const t = useTheme();
  return useMemo(() => StyleSheet.create(factory(t)), [factory, t]);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Text sizes grow on TV (10-foot UI). The TV window never changes size, so this is fixed. */
export const TYPE_SCALE: number = isTV ? tv.typeScale * tvScale(Dimensions.get('window').width) : 1;

const webFont = Platform.OS === 'web' ? fontFamily.web : undefined;

/** RN text style for a design type token. */
export function font(t: TypeToken, opts: { tabular?: boolean } = {}): TextStyle {
  const k = TYPE_SCALE;
  return {
    fontSize: Math.round(t.fontSize * k),
    lineHeight: Math.round(t.lineHeight * k),
    fontWeight: t.fontWeight,
    letterSpacing: t.letterSpacing,
    ...(webFont ? { fontFamily: webFont } : null),
    ...(opts.tabular ? { fontVariant: ['tabular-nums'] } : null),
  };
}

/** A size scaled for TV like text (for icons inside text-sized controls). */
export function scaled(n: number): number {
  return Math.round(n * TYPE_SCALE);
}

/**
 * Script rules for content text (design system §4.3): direction from the
 * first strong character, a taller line for Arabic and no tracking on it.
 * `standalone` blocks (titles, overviews) also align to their own direction;
 * short labels in tiles and rows keep the UI start edge.
 */
export function scriptStyle(text: string | null | undefined, base: TextStyle, standalone = false): TextStyle | null {
  if (!text) return null;
  const dir = textDirection(text);
  const arabic = hasArabic(text);
  if (dir === 'ltr' && !arabic) return null;
  return {
    writingDirection: dir,
    // Standalone blocks align to their own direction; short labels keep the UI start edge (LTR UI).
    ...(base.textAlign === 'center' ? null : { textAlign: standalone && dir === 'rtl' ? 'right' : 'left' }),
    ...(arabic
      ? { letterSpacing: 0, lineHeight: base.lineHeight ? Math.round(base.lineHeight * arabicLineHeightFactor) : undefined }
      : null),
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Window layout: breakpoint, gutter, tile sizes. TV gets the 10-foot sizes. */
export function useLayout(): LayoutInfo & { width: number; height: number; fontScale: number } {
  const { width, height, fontScale } = useWindowDimensions();
  const sidebar = useSidebarInset();
  return useMemo(
    () => ({ ...layoutFor(width, isTV ? { tv: true } : { sidebar }), width, height, fontScale }),
    [width, height, fontScale, sidebar],
  );
}

/**
 * Web only: no browser focus outline (the app draws its own focus ring) and a
 * pointer cursor. RN Web supports these styles; the RN types do not list them.
 */
export const webPressable = (Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'pointer' } : {}) as unknown as ViewStyle;
export const webInput = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as unknown as TextStyle;

/** Fixed component sizes in points (design system §7). TV scales them with `scaled()`. */
export const sizes = {
  buttonHeight: 50,
  buttonSmall: 32,
  chipHeight: 32,
  iconButton: 44,
  iconButtonDense: 36,
  fieldHeight: 50,
  webSearchHeight: 40,
  avatarSmall: 32,
  avatarLarge: 52,
  /** Tile badge (played, downloaded). */
  badge: 22,
  badgeInset: 6,
  /** Progress bar on artwork. */
  progress: 4,
  progressInset: 10,
  /** Resume bar under the detail Play button. */
  resumeBar: 3,
  /** Tile title gap and metadata gap. */
  tileTitleGap: 6,
  tileMetaGap: 2,
  sectionHeaderGap: 10,
  hairline: StyleSheet.hairlineWidth,
  /** Settings rows (§7.15). */
  settingsRow: 44,
  settingsAccountRow: 60,
  settingsIcon: 29,
  settingsIconRadius: 7,
  rowMin: 44,
  rowMedia: 60,
  trackNumber: 28,
  trackArt: 44,
  episodeThumb: 150,
  /** Album art on the album page. */
  albumArt: 236,
  personArt: 160,
  logoMark: 72,
  stateIcon: 48,
  stateMessageMaxWidth: 300,
  toastMaxWidth: 360,
  toastMinHeight: 44,
  formMaxWidth: 440,
  sheetMaxWidth: 520,
  settingsMaxWidth: 680,
  /** Detail hero: min(0.56 × window height, 520). */
  heroHeightFactor: 0.56,
  heroMaxHeight: 520,
  heroWideMaxHeight: 420,
  /** Logo image on the detail hero. */
  logoMaxWidth: 280,
  logoMaxHeight: 100,
  skeletonBar: 12,
  /** Skeletons appear only after this delay (ms). */
  skeletonDelay: 150,
  pagerStripHeight: 38,
  pagerGap: 22,
  pagerIndicator: 3,
  searchDebounce: 250,
  readableWidth: 640,
} as const;

/** Colours that are fixed whatever the scheme (on artwork and on video). */
export const mediaColors = {
  white: '#FFFFFF',
  black: '#000000',
  badgeFill: 'rgba(0,0,0,0.6)',
  pressOverlay: 'rgba(0,0,0,0.08)',
  hoverOverlay: 'rgba(255,255,255,0.08)',
  /** TV: the fill of a focused row (TV is always dark). */
  tvRowFocus: 'rgba(255,255,255,0.22)',
  /** TV: an action button at rest (a translucent pill on the art). Focused it is `white` with `tvButtonFocusText`. */
  tvButtonRest: 'rgba(255,255,255,0.16)',
  /** TV: a plain icon button at rest (no fill; the focus fills it white). */
  tvButtonClear: 'rgba(255,255,255,0)',
  tvButtonFocusText: '#0B0B0E',
  /** TV: the empty part of a resume bar on a button or tile. */
  tvTrack: 'rgba(128,128,128,0.55)',
  tileHairlineDark: 'rgba(255,255,255,0.08)',
  tileHairlineLight: 'rgba(0,0,0,0.08)',
  heroTopScrim: 'rgba(0,0,0,0.35)',
  artGlyph: 'rgba(255,255,255,0.5)',
  artText: '#FFFFFF',
  transparent: 'transparent',
} as const;

/** Which way the hero gradient fades: transparent to the page colour. */
export function fadeTo(c: ColorTokens): readonly [string, string, string] {
  return [withAlpha(c.bg, 0), withAlpha(c.bg, 0), c.bg] as const;
}

/** `#RRGGBB` plus an alpha 0..1 as `rgba()`. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1] ?? '000000', 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
