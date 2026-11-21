/**
 * TV: a container that hides its content without unmounting it or dropping
 * its native views (`ZoggyfinTvVisibility`, Android). Hidden, nothing in it is
 * drawn or takes the focus. With an older build that lacks the module,
 * `TvVisibility` is null and the caller hides the content its own way.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

interface Props {
  hidden: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const available = Platform.OS === 'android' && !!requireOptionalNativeModule('ZoggyfinTvVisibility');

export const TvVisibility: ComponentType<Props> | null = available ? requireNativeView<Props>('ZoggyfinTvVisibility') : null;
