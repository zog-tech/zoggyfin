import { Stack } from 'expo-router';

import { tvScreenLayout } from '@/features/tv/focus';
import { OwnTab } from '@/lib/own-tab';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

/**
 * The Live TV tab (web and the Mac app; see features/iptv/nav.ts). Its pages
 * are shared with Home and Library: `(home,library,live)/live-tv/`.
 */
export const unstable_settings = { anchor: 'live-tv/index' };

export default function LiveLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return (
    <OwnTab.Provider value="(live)">
      <Stack screenOptions={options} screenLayout={tvScreenLayout} />
    </OwnTab.Provider>
  );
}
