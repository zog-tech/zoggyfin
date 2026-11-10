import { useLocalSearchParams } from 'expo-router';

import { EntryScreen } from '@/features/extensions/entry-screen';

export default function ExtensionEntryRoute() {
  const params = useLocalSearchParams<{ ext: string; entry: string; detail?: string; title?: string }>();
  return <EntryScreen params={params} />;
}
