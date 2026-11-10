import { useLocalSearchParams } from 'expo-router';

import { firstParam } from '@/features/extensions/routes';
import { PageScreen } from '@/features/extensions/page-screen';

export default function ExtensionPageRoute() {
  const { ext, page, section } = useLocalSearchParams<{ ext: string; page: string; section?: string }>();
  return <PageScreen extId={firstParam(ext) ?? ''} pageId={firstParam(page) ?? ''} sectionId={firstParam(section)} />;
}
