/**
 * Zoggyfin design tokens.
 *
 * Source of truth: docs/design/design-system.md. Keep the two files in step.
 * No dependencies. Copy to src/theme/theme.ts and import from there.
 *
 * Units are iOS points (React Native density-independent pixels).
 * Colour values are sRGB hex, or rgba() strings where alpha is part of the token.
 */

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type ColorTokens = {
  /** Page canvas behind everything. */
  bg: string;
  /** Grouped page canvas (settings, sheets). Same as bg in dark. */
  bgGrouped: string;
  /** Cards, rows, tiles before artwork loads. */
  surface: string;
  /** Raised surface: sheets, menus, focused row, skeleton base. */
  surface2: string;
  /** Pressed fill, selected chip, skeleton highlight. Not a text surface for text3. */
  surface3: string;
  /** Primary text and primary icons. */
  text: string;
  /** Secondary text: metadata, subtitles. AA on every surface. */
  text2: string;
  /** Tertiary text: timestamps, counts, placeholder. AA on bg, surface, surface2. */
  text3: string;
  /** Text and icons on an artwork scrim or on the video player. Always white. */
  textOnMedia: string;
  textOnMediaSecondary: string;
  /** Brand accent ("Ember"). Primary buttons, progress fill, selected tab, links. */
  accent: string;
  /** Accent while pressed. */
  accentPressed: string;
  /** Text or icon on an accent fill. */
  onAccent: string;
  /** Accent at low alpha: selected row tint, focus halo. */
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  /** Hairline separators between rows. Decorative, no contrast requirement. */
  separator: string;
  /** Borders that carry meaning (text field, unselected checkbox). 3:1 on bg/surface/surface2. */
  controlBorder: string;
  /** Keyboard focus ring. */
  focusRing: string;
  /** Modal scrim behind sheets and dialogs. */
  scrim: string;
  /** Bottom gradient over artwork, top stop to bottom stop. */
  artScrimTop: string;
  artScrimBottom: string;
  /** Progress track on light-or-dark artwork. */
  progressTrack: string;
  /** Glass fallback tint when a blur/glass view is not available (web, reduced transparency). */
  glassFallback: string;
};

export const dark: ColorTokens = {
  bg: '#0B0B0E',
  bgGrouped: '#0B0B0E',
  surface: '#16161A',
  surface2: '#202026',
  surface3: '#2A2A31',
  text: '#F5F5F7', // 18.05:1 on bg
  text2: '#A8A8B3', // 8.35:1 on bg, 6.05:1 on surface3
  text3: '#96969F', // 6.70:1 on bg, 5.52:1 on surface2
  textOnMedia: '#FFFFFF',
  textOnMediaSecondary: 'rgba(255,255,255,0.78)',
  accent: '#FF7A59', // 7.66:1 on bg, 5.55:1 on surface3
  accentPressed: '#E8684A',
  onAccent: '#1A0B06', // 7.47:1 on accent
  accentSoft: 'rgba(255,122,89,0.16)',
  success: '#3DD68C', // 10.48:1 on bg
  warning: '#F2B54B', // 10.75:1 on bg
  danger: '#FF6B6B', // 7.08:1 on bg
  separator: 'rgba(255,255,255,0.09)',
  controlBorder: '#71717C', // 4.08:1 on bg, 3.36:1 on surface2
  focusRing: '#FF7A59',
  scrim: 'rgba(0,0,0,0.56)',
  artScrimTop: 'rgba(0,0,0,0)',
  artScrimBottom: 'rgba(0,0,0,0.72)',
  progressTrack: 'rgba(255,255,255,0.28)',
  glassFallback: 'rgba(28,28,33,0.86)',
};

export const light: ColorTokens = {
  bg: '#FFFFFF',
  bgGrouped: '#F2F2F5',
  surface: '#FFFFFF',
  surface2: '#EBEBEF',
  surface3: '#E2E2E7',
  text: '#111114', // 18.85:1 on bg
  text2: '#595963', // 6.92:1 on bg, 5.36:1 on surface3
  text3: '#63636C', // 5.95:1 on bg, 4.61:1 on surface3
  textOnMedia: '#FFFFFF',
  textOnMediaSecondary: 'rgba(255,255,255,0.82)',
  accent: '#B53A17', // 5.86:1 on bg, 4.54:1 on surface3
  accentPressed: '#9C3113',
  onAccent: '#FFFFFF', // 5.86:1 on accent
  accentSoft: 'rgba(181,58,23,0.10)',
  success: '#12703F', // 6.15:1 on bg
  warning: '#855300', // 6.49:1 on bg
  danger: '#BE2329', // 6.07:1 on bg
  separator: 'rgba(17,17,20,0.12)',
  controlBorder: '#7E7E88', // 4.02:1 on bg, 3.11:1 on surface3
  focusRing: '#B53A17',
  scrim: 'rgba(0,0,0,0.40)',
  artScrimTop: 'rgba(0,0,0,0)',
  artScrimBottom: 'rgba(0,0,0,0.68)',
  progressTrack: 'rgba(255,255,255,0.40)',
  glassFallback: 'rgba(250,250,252,0.88)',
};

/**
 * The brand accent shown on artwork-agnostic brand surfaces (icon, splash).
 * Not a UI token: inside the app use `accent` from the active scheme.
 */
export const brand = {
  ember: '#FF7A59',
  emberDeep: '#FF6A4D',
  emberLight: '#FFA270',
  ink: '#0B0B0E',
} as const;

/**
 * TV: the caption strip under a focused tile's art (design system §7.19). TV
 * is always dark; the focused tile's caption turns light at once, like a lit
 * card. Unfocused captions keep the scheme's `text` and `text2`.
 */
export const tvCaption = {
  focusFill: '#FFFFFF',
  focusText: '#343434', // 12.45:1 on focusFill
  focusText2: '#62626B', // 6.04:1 on focusFill
} as const;

// ---------------------------------------------------------------------------
// Spacing, radius, layout
// ---------------------------------------------------------------------------

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  section: 28, // vertical gap between Home rows
  huge: 48,
} as const;

export const radius = {
  xs: 4,
  sm: 8, // square tiles (album art), chips
  md: 10, // poster and thumb tiles
  lg: 14, // cards, mini player, menus
  xl: 20, // sheets, full-player artwork
  xxl: 28, // iPad sheets, large panels
  pill: 999,
} as const;

export type Breakpoint = 'compact' | 'medium' | 'expanded' | 'wide';

/** Window-width breakpoints. Always read width from useWindowDimensions(), never the device model. */
export const breakpoints: Readonly<Record<Breakpoint, number>> = {
  compact: 0, // iPhone, iPad Slide Over, narrow Split View
  medium: 600, // iPad portrait, half-screen Split View
  expanded: 900, // iPad landscape, large Mac window
  wide: 1280, // Mac full screen, desktop web
};

export function breakpointFor(width: number): Breakpoint {
  if (width >= breakpoints.wide) return 'wide';
  if (width >= breakpoints.expanded) return 'expanded';
  if (width >= breakpoints.medium) return 'medium';
  return 'compact';
}

export type TileKind = 'poster' | 'thumb' | 'square' | 'circle';

export const layout = {
  /** Horizontal page gutter per breakpoint. */
  gutter: { compact: 16, medium: 24, expanded: 32, wide: 40 } satisfies Record<Breakpoint, number>,
  /** Gap between tiles in a row or a grid. */
  tileGap: { compact: 12, medium: 16, expanded: 16, wide: 20 } satisfies Record<Breakpoint, number>,
  /** Tile width in horizontal rows. Height follows the aspect ratio. */
  rowTileWidth: {
    poster: { compact: 116, medium: 140, expanded: 152, wide: 168 },
    thumb: { compact: 264, medium: 300, expanded: 320, wide: 352 },
    square: { compact: 148, medium: 168, expanded: 180, wide: 196 },
    circle: { compact: 88, medium: 100, expanded: 108, wide: 116 },
  } satisfies Record<TileKind, Record<Breakpoint, number>>,
  /** Minimum tile width in grids; columns = floor((W - 2*gutter + gap) / (min + gap)). */
  gridMinTile: {
    poster: { compact: 104, medium: 132, expanded: 140, wide: 152 },
    thumb: { compact: 300, medium: 260, expanded: 280, wide: 300 },
    square: { compact: 150, medium: 160, expanded: 172, wide: 184 },
    circle: { compact: 96, medium: 112, expanded: 120, wide: 128 },
  } satisfies Record<TileKind, Record<Breakpoint, number>>,
  /** Minimum and maximum column counts, so a grid never looks empty or crowded. */
  gridColumnLimits: {
    poster: [3, 10],
    thumb: [1, 5],
    square: [2, 8],
    circle: [3, 10],
  } satisfies Record<TileKind, readonly [number, number]>,
  aspect: { poster: 2 / 3, thumb: 16 / 9, square: 1, circle: 1 } satisfies Record<TileKind, number>,
  /** iPad/Mac sidebar width when the native tab bar shows as a sidebar. */
  sidebarWidth: 280,
  /** Max width of long-form text (overview, lyrics) on wide windows. */
  readableWidth: 640,
  miniPlayerHeight: 56,
  minTouchTarget: 44,
  rowHeight: { compact: 44, regular: 60, media: 72 },
} as const;

export type GridResult = { columns: number; tileWidth: number; gap: number; gutter: number };

/** Column count and exact tile width for a grid of `kind` tiles in a window `width` points wide. */
export function gridFor(kind: TileKind, width: number): GridResult {
  const bp = breakpointFor(width);
  const gutter = layout.gutter[bp];
  const gap = layout.tileGap[bp];
  const min = layout.gridMinTile[kind][bp];
  const [lo, hi] = layout.gridColumnLimits[kind];
  const inner = width - gutter * 2;
  const raw = Math.floor((inner + gap) / (min + gap));
  const columns = Math.min(hi, Math.max(lo, raw));
  const tileWidth = Math.floor((inner - gap * (columns - 1)) / columns);
  return { columns, tileWidth, gap, gutter };
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/** iOS Dynamic Type text style names (UIFont.TextStyle). */
export type DynamicTypeStyle =
  | 'largeTitle'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'callout'
  | 'subheadline'
  | 'footnote'
  | 'caption1'
  | 'caption2';

export type FontWeight = '400' | '500' | '600' | '700' | '800';

export type TypeToken = {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  /** The Dynamic Type style this token scales with. */
  dynamicType: DynamicTypeStyle;
  /** Max scale factor applied by the OS font size setting (maxFontSizeMultiplier). */
  maxScale: number;
};

/**
 * Sizes are the iOS "Large" (default) Dynamic Type sizes. Weights are Zoggyfin choices.
 * Use the system font: SF Pro for Latin, SF Arabic for Arabic (automatic fallback on Apple).
 * letterSpacing follows SF tracking at each size.
 */
export const type = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '800', letterSpacing: 0.4, dynamicType: 'largeTitle', maxScale: 1.4 },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4, dynamicType: 'largeTitle', maxScale: 1.6 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.38, dynamicType: 'title1', maxScale: 1.6 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.26, dynamicType: 'title2', maxScale: 1.8 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.45, dynamicType: 'title3', maxScale: 1.8 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.43, dynamicType: 'headline', maxScale: 2 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.43, dynamicType: 'body', maxScale: 2.2 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.31, dynamicType: 'callout', maxScale: 2.2 },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.23, dynamicType: 'subheadline', maxScale: 2 },
  tileTitle: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.15, dynamicType: 'subheadline', maxScale: 1.5 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08, dynamicType: 'footnote', maxScale: 2 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0, dynamicType: 'caption1', maxScale: 1.8 },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '500', letterSpacing: 0.06, dynamicType: 'caption2', maxScale: 1.6 },
  /** Player times, file sizes, speeds. Apply fontVariant: ['tabular-nums']. */
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0, dynamicType: 'footnote', maxScale: 1.6 },
} as const satisfies Record<string, TypeToken>;

export type TypeName = keyof typeof type;

export const fontFamily = {
  /** React Native on Apple: undefined = system font (SF Pro / SF Arabic). */
  native: undefined,
  /** Web: system first, then fonts with full Arabic coverage. */
  web: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Arabic', system-ui, 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', sans-serif",
  webMono: "ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** Arabic, Hebrew, Syriac, Thaana, N'Ko and Arabic presentation-form ranges. */
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHARS = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

export type TextDirection = 'ltr' | 'rtl';

/** Direction of a content string from its first strong character (Unicode bidi rule P2). */
export function textDirection(text: string): TextDirection {
  for (const ch of text) {
    if (RTL_CHARS.test(ch)) return 'rtl';
    if (LTR_CHARS.test(ch)) return 'ltr';
  }
  return 'ltr';
}

/** True when a string contains any Arabic-script character. Use to raise line height. */
export function hasArabic(text: string): boolean {
  return /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text);
}

/** Line-height factor for text runs with Arabic script: SF Arabic needs taller lines than SF Pro. */
export const arabicLineHeightFactor = 1.18;

// ---------------------------------------------------------------------------
// Icons, elevation, materials
// ---------------------------------------------------------------------------

export const iconSize = {
  xs: 13, // inline badge
  sm: 17, // row accessory, chip
  md: 22, // toolbar, header buttons
  lg: 28, // tab bar, player secondary controls
  xl: 36, // player skip
  xxl: 48, // player play/pause on phone
} as const;

export type Shadow = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  /** Android elevation equivalent. */
  elevation: number;
};

export const elevation: Record<'flat' | 'raised' | 'floating' | 'overlay', Record<'dark' | 'light', Shadow>> = {
  flat: {
    dark: { shadowColor: '#000000', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
    light: { shadowColor: '#000000', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  },
  /** Tiles on hover/focus, artwork in the full player. */
  raised: {
    dark: { shadowColor: '#000000', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
    light: { shadowColor: '#14141A', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  },
  /** Mini player, toasts, menus. */
  floating: {
    dark: { shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
    light: { shadowColor: '#14141A', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  },
  /** Sheets and dialogs. */
  overlay: {
    dark: { shadowColor: '#000000', shadowOpacity: 0.6, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
    light: { shadowColor: '#14141A', shadowOpacity: 0.22, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 16 },
  },
};

/** Material recipes. Prefer the native glass/blur view; fall back to glassFallback when unavailable. */
export const material = {
  /** Mini player, floating toolbars: iOS 26 glass, else blur. */
  chrome: { glass: 'regular', blurTint: 'systemChromeMaterial', blurIntensity: 80 },
  /** Video player control pills over video. */
  overVideo: { glass: 'clear', blurTint: 'systemUltraThinMaterialDark', blurIntensity: 40 },
  /** Context menus, sheets on web. */
  thick: { glass: 'regular', blurTint: 'systemThickMaterial', blurIntensity: 95 },
  /** Full player background: blurred artwork, radius in points. */
  artworkBackdrop: { blurRadius: 60, saturation: 1.4, dimDark: 0.45, dimLight: 0.25 },
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/** Reanimated withSpring configs (physics form). */
export type SpringConfig = { damping: number; stiffness: number; mass: number };

export const motion = {
  duration: {
    instant: 0,
    press: 90, // press-in feedback
    fast: 160, // fades, small state changes, exits
    base: 240, // most UI transitions
    slow: 340, // sheet presentation fallback, large moves
    skeletonCycle: 1400, // one shimmer pass
    toast: 3200, // visible time before auto-dismiss
  },
  /** Cubic-bezier control points [x1, y1, x2, y2]; use Easing.bezier(...). */
  easing: {
    standard: [0.2, 0, 0, 1],
    enter: [0, 0, 0, 1],
    exit: [0.3, 0, 1, 1],
    linear: [0, 0, 1, 1],
  },
  spring: {
    /** Press release, toggles, chips. Critically damped feel, no visible bounce. */
    snappy: { damping: 30, stiffness: 420, mass: 1 },
    /** Default for layout moves, tab indicator settle, mini player expand. */
    smooth: { damping: 28, stiffness: 260, mass: 1 },
    /** Sheets and the full player after a fling. Accepts gesture velocity. */
    sheet: { damping: 32, stiffness: 300, mass: 1 },
    /** Rare celebratory moments (download complete check). Small overshoot. */
    gentleBounce: { damping: 16, stiffness: 220, mass: 1 },
  } satisfies Record<string, SpringConfig>,
  press: {
    /** Scale on press-in for tiles and cards. */
    tileScale: 0.97,
    /** Scale for round icon buttons (player controls). */
    buttonScale: 0.92,
    /** Opacity for list rows and text buttons (no scale on rows). */
    rowOpacity: 0.6,
    /** Overlay brightness added on hover (pointer) for tiles. */
    hoverOverlay: 0.08,
    hoverScale: 1.03,
  },
  /** Stagger between items of a first-load reveal; capped at the first 6 items. */
  stagger: { each: 30, maxItems: 6 },
  /** Reduced-motion mode: replace transforms with fades of this length. */
  reducedMotion: { fade: 150 },
} as const;

/** expo-haptics mapping. Use these names, never raw calls in screens. */
export const haptics = {
  selection: 'selectionAsync', // tab/segment change, scrubber chapter tick
  light: 'impactLight', // play/pause, add to queue, long-press menu open
  medium: 'impactMedium', // drag pick-up in reorder
  success: 'notificationSuccess', // download complete, playlist created
  warning: 'notificationWarning', // destructive confirm shown
  error: 'notificationError', // action failed
} as const;

// ---------------------------------------------------------------------------
// Generated-art fallback
// ---------------------------------------------------------------------------

export type FallbackArt = {
  /** Two colour stops, start to end. */
  from: string;
  to: string;
  /** Gradient angle in CSS degrees (0 = to top, 90 = to right). */
  angle: number;
  /** Start and end points in unit space, for expo-linear-gradient / Skia. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Soft highlight colour (draw at 35% alpha, radius 70% of tile width). */
  glow: string;
  glowCenter: { x: number; y: number };
  /** CSS for web, or React Native experimental_backgroundImage. */
  css: string;
  /** Direction for the title text drawn on the tile. */
  direction: TextDirection;
};

/** FNV-1a 32-bit over UTF-16 code units. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const ANGLES = [135, 160, 200, 225] as const;

/**
 * Deterministic gradient for an item without artwork.
 * Same title gives the same art on every device and platform.
 * White text on `from` is at least 5.19:1 for every hue; the darker `to` stop is higher still.
 */
export function fallbackArt(title: string, fallbackKey = ''): FallbackArt {
  const key = (title.normalize('NFKC').trim().toLowerCase() || fallbackKey).trim();
  const h = fnv1a(key);
  const hue = h % 360;
  const shift = 24 + ((h >>> 9) % 33); // 24..56 degrees
  const sign = (h >>> 17) & 1 ? 1 : -1;
  const hue2 = (hue + sign * shift + 360) % 360;
  const angle = ANGLES[(h >>> 20) & 3] ?? 135;
  const from = hslToHex(hue, 0.42, 0.31);
  const to = hslToHex(hue2, 0.38, 0.16);
  const glow = hslToHex(hue, 0.6, 0.55);
  const glowCenter = { x: (20 + ((h >>> 24) % 61)) / 100, y: 0.18 };
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    from,
    to,
    angle,
    start: { x: r(0.5 - dx), y: r(0.5 - dy) },
    end: { x: r(0.5 + dx), y: r(0.5 + dy) },
    glow,
    glowCenter,
    css:
      `radial-gradient(circle at ${Math.round(glowCenter.x * 100)}% 18%, ${glow}59 0%, ${glow}00 70%), ` +
      `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`,
    direction: textDirection(title),
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export const theme = {
  dark,
  light,
  brand,
  spacing,
  radius,
  layout,
  breakpoints,
  type,
  fontFamily,
  iconSize,
  elevation,
  material,
  motion,
  haptics,
} as const;

export type Theme = typeof theme;
export type ColorScheme = 'dark' | 'light';

export function colorsFor(scheme: ColorScheme): ColorTokens {
  return scheme === 'light' ? light : dark;
}
