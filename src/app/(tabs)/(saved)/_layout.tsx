import { Stack } from 'expo-router';

import { tvScreenLayout } from '@/features/tv/focus';
import { OwnTab } from '@/lib/own-tab';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

/** Each tab root has its own path, so web URLs stay unique (only Home owns "/"). */
export const unstable_settings = { anchor: 'downloads' };

export default function DownloadsLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return (
    <OwnTab.Provider value="(saved)">
      <Stack screenOptions={options} screenLayout={tvScreenLayout} />
    </OwnTab.Provider>
  );
}
