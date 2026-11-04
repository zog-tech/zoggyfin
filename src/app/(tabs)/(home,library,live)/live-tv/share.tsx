import { useLocalSearchParams } from 'expo-router';

import { ShareScreen } from '@/features/iptv/share-screen';

export default function ShareRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return id ? <ShareScreen id={id} /> : null;
}
