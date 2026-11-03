/**
 * Where the Live TV pages live. They are shared by the Home, Library and
 * Live TV stacks (`src/app/(tabs)/(home,library,live)/live-tv/`), so a page
 * stays in the tab that opened it.
 *
 * Live TV is its own tab only on the web and in the Mac app. iOS and Android
 * already have five tabs: Android's bottom bar cannot hold a sixth (it
 * throws), and iOS would move it into a "More" tab. There, Live TV is a
 * tile in the Library grid beside the server's libraries, and Settings has
 * the providers. TV has it in the side menu. Every platform but TV also has
 * a Live TV row on Home once a provider exists. placement.ts has the rules.
 */
import { type Href, useSegments } from 'expo-router';
import { Platform } from 'react-native';

import { isTV } from '@/platform/tv';

export type LiveGroup = '(home)' | '(library)' | '(live)';

/** True where Live TV is a tab of its own. */
export const liveTvTab: boolean = Platform.OS === 'web' && !isTV;

const GROUPS: readonly LiveGroup[] = ['(live)', '(library)', '(home)'];

/** The stack the user is in, for pushes that stay in it. */
export function useLiveGroup(): LiveGroup {
  const segments = useSegments() as string[];
  return segments.find((s): s is LiveGroup => (GROUPS as readonly string[]).includes(s)) ?? (liveTvTab ? '(live)' : '(library)');
}

export function liveTvHref(group: LiveGroup): Href {
  return `/(tabs)/${group}/live-tv` as Href;
}

export function providersHref(group: LiveGroup): Href {
  return `/(tabs)/${group}/live-tv/providers` as Href;
}

export function providerFormHref(group: LiveGroup, params: { id?: string; kind?: 'xtream' | 'm3u' }): Href {
  return { pathname: `/(tabs)/${group}/live-tv/provider`, params } as unknown as Href;
}
