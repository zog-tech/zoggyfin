/**
 * Player sizes and timings from design-system §7.8. Full players are always dark.
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

export const ease = {
  standard: Easing.bezier(...motion.easing.standard),
  enter: Easing.bezier(...motion.easing.enter),
  exit: Easing.bezier(...motion.easing.exit),
};

/** RN text style from a design type token (drops the non-style fields). */
export function textStyle(t: (typeof type)[keyof typeof type]) {
  return { fontSize: t.fontSize, lineHeight: t.lineHeight, fontWeight: t.fontWeight, letterSpacing: t.letterSpacing } as const;
}
