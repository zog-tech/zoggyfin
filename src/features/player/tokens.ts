/**
 * Player sizes and timings from design-system §7.8. Full players are always dark.
 * `playerTvModern` holds the TV Modern look's sizes (§7.22).
 */
import { Easing } from 'react-native-reanimated';

import { dark, iconSize, motion, radius, spacing, type } from '@/theme/theme';

export const c = dark;
export { iconSize, motion, radius, spacing, type };

export const player = {
  closeSize: 44,
  pillButton: 44,
  skipSize: 64,
  playSize: 84,
  playGlyph: 48,
  centerGap: 56,
  track: 6,
  trackActive: 10,
  thumb: 16,
  chapterGap: 2,
  preview: { width: 160, height: 90, radius: 10, border: 1.5 },
  /** Controls hide after this long without input while playing. */
  autoHideMs: 3000,
  scrubberHitHeight: 44,
  skipPill: 'rgba(255,255,255,0.9)',
  skipPillText: '#111114',
  trackColor: 'rgba(255,255,255,0.28)',
  bufferedColor: 'rgba(255,255,255,0.45)',
  playedColor: '#FFFFFF',
  chapterMarkColor: 'rgba(0,0,0,0.65)',
  topScrim: ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const,
  bottomScrim: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)'] as const,
  /** The subtitle preview in Settings: a mid-tone scene, so every background choice shows. */
  subtitlePreview: ['#6E7F92', '#3B434E', '#1C2027'] as const,
} as const;

/**
 * TV Modern look (design system §7.22): the video player's sizes in TV design
 * units on a 1920-wide screen (turn them into points with `u()`). The Classic
 * player keeps `player` above. Flat controls only: no circle, no capsule.
 */
export const playerTvModern = {
  /** The safe area: controls keep this far from the screen edges. */
  safeX: 96,
  safeTop: 54,
  safeBottom: 60,
  topScrimHeight: 200,
  bottomScrimHeight: 420,
  topScrim: ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const,
  bottomScrim: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.80)'] as const,
  /** The centre row: bare glyphs in square boxes, the plate fills the box on focus. */
  playBox: 112,
  playGlyph: 72,
  skipBox: 96,
  skipGlyph: 52,
  /** Web: the seconds drawn inside the rotate arrows (SF Symbols have them in the glyph). */
  skipNumber: 16,
  centerGap: 48,
  /** The seek bar: 8 u, 12 u with the focus; the thumb is a bar, not a knob, and shows with the focus. */
  track: 8,
  trackActive: 12,
  thumbWidth: 8,
  thumbHeight: 28,
  thumbRadius: 4,
  hitHeight: 48,
  trackColor: 'rgba(255,255,255,0.22)',
  bufferedColor: 'rgba(255,255,255,0.40)',
  preview: { width: 320, radius: 12, border: 3 },
  /** Between the title row and the bar, and between the bar and the times. */
  rowGap: 16,
  /** The height of the controls over the bottom inset: subtitles and prompts sit above it. */
  controlsHeight: 220,
  /** Prompts with the controls hidden: this far over the bottom inset. */
  promptRest: 48,
  /** The seek bubble and other small boxes on video. */
  boxRadius: 8,
  errorRadius: 28,
  errorWidth: 880,
  errorPad: 48,
  errorTitle: { fontSize: 36, lineHeight: 44 },
  /** The next-up card. */
  card: { radius: 16, pad: 24, gap: 24, width: 760, image: 256, ring: 56, stroke: 4 },
} as const;

export const ease = {
  standard: Easing.bezier(...motion.easing.standard),
  enter: Easing.bezier(...motion.easing.enter),
  exit: Easing.bezier(...motion.easing.exit),
};

/** RN text style from a design type token (drops the non-style fields). */
export function textStyle(t: (typeof type)[keyof typeof type]) {
  return { fontSize: t.fontSize, lineHeight: t.lineHeight, fontWeight: t.fontWeight, letterSpacing: t.letterSpacing } as const;
}
