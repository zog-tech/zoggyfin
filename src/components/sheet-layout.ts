/**
 * Sheet sizes and the screen orientations a modal accepts. Pure, so it is
 * unit-tested.
 */
import type { ModalProps } from 'react-native';

import { spacing } from '@/theme/theme';

/**
 * Every orientation the app runs in. A React Native `Modal` on iOS accepts
 * only portrait unless it says otherwise: opened on a phone on its side, the
 * sheet came up sideways, and a rotation while it was open turned the app
 * under it but not the sheet.
 */
export const MODAL_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = ['portrait', 'portrait-upside-down', 'landscape'];

/** A window lower than this (a phone on its side) gets a taller share. */
const SHORT = 500;

/**
 * The sheet panel's height share (fixed-height sheets) and its limit: 80 %
 * of the space the sheet gets. On a short window 80 % left a list of three
 * rows under the header, so the panel takes all but a top margin there. It
 * stays a percentage, so the panel still shrinks above the keyboard.
 */
export function sheetHeight(windowHeight: number, insetTop: number): `${number}%` {
  if (windowHeight >= SHORT || windowHeight <= 0) return '80%';
  const share = (windowHeight - Math.max(insetTop, spacing.xl)) / windowHeight;
  return `${Math.max(80, Math.floor(share * 100))}%`;
}
