/**
 * Subtitle appearance: the saved choices and what each choice means for each
 * renderer. The app draws Jellyfin text subtitles itself (React Native text),
 * the browser draws the subtitles inside an HLS stream (`::cue` CSS), and
 * libmpv draws every subtitle in the Mac app (mpv properties).
 *
 * Pure, so it is unit-tested: no React, no storage, no native imports. The
 * caller passes the TV type scale, so the same rules give 10-foot sizes.
 */

export type SubtitleSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SubtitleColor = 'white' | 'yellow';
export type SubtitleBackground = 'none' | 'outline' | 'box';
export type SubtitlePosition = 'normal' | 'raised';

export interface SubtitleAppearance {
  size: SubtitleSize;
  color: SubtitleColor;
  background: SubtitleBackground;
  position: SubtitlePosition;
}

/** The look before this setting existed: medium white text on a translucent box. */
export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = {
  size: 'medium',
  color: 'white',
  background: 'box',
  position: 'normal',
};

export const SUBTITLE_SIZE_OPTIONS: readonly { value: SubtitleSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
];

export const SUBTITLE_COLOR_OPTIONS: readonly { value: SubtitleColor; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'yellow', label: 'Yellow' },
];

export const SUBTITLE_BACKGROUND_OPTIONS: readonly { value: SubtitleBackground; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'outline', label: 'Outline and shadow' },
  { value: 'box', label: 'Translucent box' },
];

export const SUBTITLE_POSITION_OPTIONS: readonly { value: SubtitlePosition; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'raised', label: 'Raised' },
];

/** Text size multiplier for each size choice. Medium is the size before this setting. */
export const SIZE_SCALE: Record<SubtitleSize, number> = { small: 0.8, medium: 1, large: 1.25, xlarge: 1.5 };

/** Subtitle colours. Players are always dark, so these never follow the app theme. */
export const SUBTITLE_COLORS = {
  white: '#FFFFFF',
  yellow: '#FFD60A',
  box: 'rgba(0,0,0,0.55)',
  shadow: 'rgba(0,0,0,0.8)',
  outline: 'rgba(0,0,0,0.95)',
} as const;

/** "Raised" lifts the subtitles by this share of the video height. */
export const RAISED_SHARE = 0.1;

/** The phone text size of medium subtitles (design type `title3`). */
const BASE = { fontSize: 20, lineHeight: 25, padX: 8, padY: 2, radius: 6, gap: 4 };

function pick<T extends string>(value: unknown, options: readonly { value: T }[], fallback: T): T {
  return options.some((o) => o.value === value) ? (value as T) : fallback;
}

/**
 * Reads a saved value of any shape. Unknown or missing fields get the default,
 * so an old or damaged saved value never breaks the player. Never throws.
 */
export function normalizeSubtitleAppearance(raw: unknown): SubtitleAppearance {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SUBTITLE_APPEARANCE;
  return {
    size: pick(r.size, SUBTITLE_SIZE_OPTIONS, d.size),
    color: pick(r.color, SUBTITLE_COLOR_OPTIONS, d.color),
    background: pick(r.background, SUBTITLE_BACKGROUND_OPTIONS, d.background),
    position: pick(r.position, SUBTITLE_POSITION_OPTIONS, d.position),
  };
}

export function optionLabel<T extends string>(options: readonly { value: T; label: string }[], value: T): string {
  return options.find((o) => o.value === value)?.label ?? '';
}

/** A React Native text style for one subtitle line (plain object, no StyleSheet). */
export interface SubtitleTextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '600';
  color: string;
  textAlign: 'center';
  backgroundColor?: string;
  paddingHorizontal?: number;
  paddingVertical?: number;
  borderRadius?: number;
  overflow?: 'hidden';
  textShadowColor?: string;
  textShadowRadius?: number;
  textShadowOffset?: { width: number; height: number };
}

/**
 * The style of a subtitle line the app draws. `typeScale` is the TV text
 * scale (`TYPE_SCALE`, 1 off TV); `extra` scales a small preview.
 */
export function subtitleTextStyle(a: SubtitleAppearance, typeScale = 1, extra = 1): SubtitleTextStyle {
  const k = SIZE_SCALE[a.size] * typeScale * extra;
  const style: SubtitleTextStyle = {
    fontSize: Math.round(BASE.fontSize * k),
    lineHeight: Math.round(BASE.lineHeight * k),
    fontWeight: '600',
    color: SUBTITLE_COLORS[a.color],
    textAlign: 'center',
  };
  if (a.background === 'box') {
    const box = typeScale * extra;
    style.backgroundColor = SUBTITLE_COLORS.box;
    style.paddingHorizontal = Math.round(BASE.padX * box);
    style.paddingVertical = Math.round(BASE.padY * box);
    style.borderRadius = Math.round(BASE.radius * box);
    style.overflow = 'hidden';
    style.textShadowColor = SUBTITLE_COLORS.shadow;
    style.textShadowRadius = 3;
  } else if (a.background === 'outline') {
    // React Native has no text stroke: a tight dark shadow reads as an outline.
    style.textShadowColor = SUBTITLE_COLORS.outline;
    style.textShadowRadius = Math.max(2, Math.round(4 * Math.min(k, 2)));
    style.textShadowOffset = { width: 0, height: Math.max(1, Math.round(k)) };
  }
  return style;
}

/** The gap between subtitle lines. */
export function subtitleLineGap(typeScale = 1): number {
  return Math.round(BASE.gap * typeScale);
}

/** The distance of the subtitles from the bottom edge, with "Raised" added. */
export function subtitleBottom(a: SubtitleAppearance, base: number, videoHeight: number): number {
  return a.position === 'raised' ? base + Math.round(videoHeight * RAISED_SHARE) : base;
}

/**
 * CSS for the subtitles the browser draws in a `<video>` element (tracks
 * inside an HLS stream). Chrome and Safari also move them up for "Raised";
 * Firefox has no selector for the cue box, so it keeps their place.
 */
export function cueCss(a: SubtitleAppearance, selector = 'video'): string {
  const rules = [`color: ${SUBTITLE_COLORS[a.color]}`, `font-size: ${Math.round(SIZE_SCALE[a.size] * 100)}%`];
  if (a.background === 'box') rules.push(`background-color: ${SUBTITLE_COLORS.box}`, 'text-shadow: none');
  else if (a.background === 'outline')
    rules.push('background-color: transparent', `text-shadow: 0 0 3px ${SUBTITLE_COLORS.outline}, 0 0 3px ${SUBTITLE_COLORS.outline}, 0 1px 2px ${SUBTITLE_COLORS.outline}`);
  else rules.push('background-color: transparent', 'text-shadow: none');
  const css = [`${selector}::cue { ${rules.join('; ')}; }`];
  if (a.position === 'raised') css.push(`${selector}::-webkit-media-text-track-container { transform: translateY(-${RAISED_SHARE * 100}%); }`);
  return css.join('\n');
}

/** libmpv's default bottom margin, in its 720-line script space. */
const MPV_MARGIN_Y = 34;

/** mpv colours are `#AARRGGBB`. */
const MPV_COLORS: Record<SubtitleColor, string> = { white: '#FFFFFFFF', yellow: '#FFFFD60A' };

/**
 * The libmpv properties for the subtitles it draws in the Mac app. Styled ASS
 * subtitles keep their own look and place (`sub-ass-override=scale`); size
 * still applies to them.
 */
export function mpvSubtitleProperties(a: SubtitleAppearance): [string, string][] {
  const base: [string, string][] = [
    ['sub-scale', String(SIZE_SCALE[a.size])],
    ['sub-color', MPV_COLORS[a.color]],
    ['sub-margin-y', String(a.position === 'raised' ? MPV_MARGIN_Y + Math.round(720 * RAISED_SHARE) : MPV_MARGIN_Y)],
  ];
  switch (a.background) {
    case 'box':
      return [...base, ['sub-border-style', 'background-box'], ['sub-back-color', '#8C000000'], ['sub-outline-size', '0'], ['sub-shadow-offset', '4']];
    case 'outline':
      return [
        ...base,
        ['sub-border-style', 'outline-and-shadow'],
        ['sub-outline-color', '#FF000000'],
        ['sub-outline-size', '2.5'],
        ['sub-back-color', '#80000000'],
        ['sub-shadow-offset', '1'],
      ];
    case 'none':
      return [...base, ['sub-border-style', 'outline-and-shadow'], ['sub-outline-size', '0'], ['sub-shadow-offset', '0']];
  }
}
