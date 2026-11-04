/**
 * The Remote screen over the app, from the profile menu or the "Play on"
 * toast. `?session=<id>` picks a device at the start.
 */
import { useLocalSearchParams } from 'expo-router';

import { RemoteScreen } from '@/features/remote/remote-screen';

export default function RemoteRoute() {
  const { session } = useLocalSearchParams<{ session?: string }>();
  return <RemoteScreen initialSessionId={session} />;
}
