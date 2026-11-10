/**
 * Rewrites system links before the router reads them (iOS and Android).
 *
 * An invite link has its payload in the fragment: `zoggyfin://join#…` or the
 * universal link `https://zoggyfin.zog-tech.com/join#…`. The payload goes to
 * memory and the router opens /accept-invite, so the one-time password is
 * not in the route. Other links (the nearby `zoggyfin://join?…`) pass as they are,
 * except a link into a tab that an extension page took the place of on this
 * phone: it goes to that tab's screens in their new stack (lib/tab-destination.ts).
 */
import { rewriteSystemPath } from '@/features/extensions/tab-nav';
import { setIncomingInvite } from '@/invite/incoming';
import { payloadFromText } from '@/invite/payload';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const payload = payloadFromText(path);
    if (payload) {
      setIncomingInvite(payload);
      return '/accept-invite';
    }
  } catch {
    // Never block a link.
  }
  try {
    return rewriteSystemPath(path);
  } catch {
    return path;
  }
}
