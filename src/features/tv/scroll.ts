/**
 * Props for a ScrollView (or FlashList) whose scroll the app drives on
 * Android TV: Home, its rows and the item grids scroll to the focused row or
 * tile with `scrollTo`.
 *
 * Android's own focus scroll ran as well. It jumped at once to show the
 * focused view and the animated `scrollTo` then moved again, so each D-pad
 * press jumped and slid. With no focus target left (Down on the last row) it
 * scrolled past the end and cut the rows off. `scrollEnabled: false` turns
 * both off on Android: the D-pad still moves the focus, and `scrollTo` still
 * scrolls. The animation glides: 300 ms on an ease-out cubic curve, so it
 * starts at speed and settles softly. A press during a glide starts the next
 * one from where the page is, still moving fast, so held presses flow on
 * (180 ms with the plain ease-out felt abrupt).
 *
 * Off on the web TV preview and on tvOS, where the focus engine owns the scroll.
 */
import { Platform, type ScrollViewProps } from 'react-native';

import { isNativeTV } from '@/platform/tv';

const driven = isNativeTV && Platform.OS === 'android';

export const tvDrivenScroll: Pick<ScrollViewProps, 'scrollEnabled' | 'scrollAnimationDuration' | 'scrollAnimationEasing'> = driven
  ? { scrollEnabled: false, scrollAnimationDuration: 300, scrollAnimationEasing: [0.33, 1, 0.68, 1] }
  : {};
