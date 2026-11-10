/**
 * The join link of a nearby session (`zoggyfin://join?v=1&...`, in the
 * host's QR code). The Camera app opens it. This screen sends the join
 * request, goes to Home (or sign-in with no account) and opens the session
 * sheet there.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '@/auth/session-store';
import { toast } from '@/lib/toast';
import { useTheme } from '@/theme';
import { nearby, nearbySupported } from '@/together/nearby';
import { openTogetherSheet } from '@/together/store';

/** The join link again, from the route's query values. */
function linkFrom(params: Record<string, string | string[] | undefined>): string {
  const query = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `zoggyfin://join?${query}`;
}

export default function JoinRoute() {
  const params = useLocalSearchParams();
  const signedIn = useSessionStore((s) => !!s.session);
  const { c } = useTheme();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // A bare /join is no join link. The router also lands here when the web
    // app opens at "/" with no account (the first screen it may show), so
    // it only goes on, with no message.
    const isLink = Object.values(params).some((v) => typeof v === 'string');
    const ok = isLink && nearbySupported && nearby().joinWithCode(linkFrom(params));
    router.replace(signedIn ? '/' : '/sign-in');
    if (ok) openTogetherSheet('join', null);
    else if (isLink) toast('This code is not correct.');
  }, [params, signedIn]);

  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
