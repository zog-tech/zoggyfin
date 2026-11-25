/**
 * Helpers for the TV Modern look (design system §7.22). Modern sizes are TV
 * design units on a 1920-wide screen: `u()` turns them into points for this
 * screen (Android TV reports 960 dp, so 1 u is 0.5 dp there). Unlike Classic,
 * Modern never mixes scaled and unscaled points, and its type tokens are
 * final sizes: no type scale on top. The TV window never changes size, so
 * the scale is read once.
 */
import { Dimensions, Platform, type TextStyle } from 'react-native';

import { tvScale } from './layout';
import { fontFamily, tvModern } from './theme';

/** The Modern tokens (short name for styles). */
export const tvm = tvModern;

export type TvTypeToken = (typeof tvModern.type)[keyof typeof tvModern.type];

const SCALE = tvScale(Dimensions.get('window').width);

/** TV design units to points for this screen. */
export function u(n: number): number {
  return Math.round(n * SCALE);
}

const webFont = Platform.OS === 'web' ? fontFamily.web : undefined;

/** RN text style for a Modern type token: sizes through `u()`, the web font family as `font()` gives it. */
export function tvFont(t: TvTypeToken, opts: { tabular?: boolean } = {}): TextStyle {
  return {
    fontSize: u(t.fontSize),
    lineHeight: u(t.lineHeight),
    fontWeight: t.fontWeight,
    letterSpacing: t.letterSpacing * SCALE,
    ...(webFont ? { fontFamily: webFont } : null),
    ...(opts.tabular ? { fontVariant: ['tabular-nums'] } : null),
  };
}
