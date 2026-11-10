import { Stack } from 'expo-router';

import { EmptyState } from '@/components/states';
import { PageScreen } from '@/features/extensions/page-screen';
import { useTabSlotPage } from '@/features/extensions/use-placement';
import { useRootScreenOptions } from '@/lib/stack-options';

/** The first page of the extension tab: the page that fills the tab slot. */
export default function ExtensionTabRoute() {
  const root = useRootScreenOptions();
  const page = useTabSlotPage();
  if (!page) {
    return (
      <>
        <Stack.Screen options={{ ...root, title: 'Extension' }} />
        <EmptyState icon="square.grid.2x2" title="No extension page here" message="Add an extension with a page in Settings, Extensions." />
      </>
    );
  }
  return <PageScreen extId={page.extId} pageId={page.pageId} tabRoot />;
}
