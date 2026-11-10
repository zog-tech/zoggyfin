/**
 * The page layout of an IPTV film or series: `PlainDetail` with the IPTV
 * names (`facts` are the lines). Kept so the IPTV screens read as before.
 */
import type { ComponentProps } from 'react';

import { type PlainAction, PlainDetail } from '@/features/detail/plain-detail';

export type VodAction = PlainAction;

export function VodDetail({ facts, ...rest }: Omit<ComponentProps<typeof PlainDetail>, 'lines' | 'kind'> & { kind: 'film' | 'series'; facts: string[] }) {
  return <PlainDetail {...rest} lines={facts} />;
}
