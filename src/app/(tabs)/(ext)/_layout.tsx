import { Stack } from 'expo-router';

import { tvScreenLayout } from '@/features/tv/focus';
import { useTabStackOptions } from '@/lib/stack-options';
import { SidebarInsetProvider } from '@/theme/sidebar-inset';

/**
 * The extension tab: one fixed slot that shows the page chosen by
 * `features/extensions/placement.ts` (iPad, the web and the Mac app; hidden
 * on phones and not used on TV). Its pages are shared with Home, Library and
 * Search: `(home,library,search,ext)/ext/`.
 */
export const unstable_settings = { anchor: 'ext-tab' };

export default function ExtLayout() {
  return <SidebarInsetProvider>{(inset) => <TabStack inset={inset} />}</SidebarInsetProvider>;
}

function TabStack({ inset }: { inset: number }) {
  const options = useTabStackOptions(inset);
  return <Stack screenOptions={options} screenLayout={tvScreenLayout} />;
}
