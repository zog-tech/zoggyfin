import { Stack } from 'expo-router';

import { tvScreenLayout } from '@/features/tv/focus';
import { OwnTab } from '@/lib/own-tab';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

export const unstable_settings = { anchor: 'index' };

export default function HomeLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return (
    <OwnTab.Provider value="(home)">
      <Stack screenOptions={options} screenLayout={tvScreenLayout} />
    </OwnTab.Provider>
  );
}
