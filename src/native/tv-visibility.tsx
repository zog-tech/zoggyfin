import type { ComponentType, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** The web (TV preview) has no native visibility container: callers hide content their own way. */
export const TvVisibility: ComponentType<{ hidden: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode }> | null = null;
