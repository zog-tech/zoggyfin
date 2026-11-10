/**
 * Keeps the extension store on the signed-in account: it binds at once and
 * again on every sign-in, sign-out and account switch. Safe to call often.
 */
import { useSessionStore } from '@/auth/session-store';

import { accountKey, bindAccount } from './store';

let following = false;

function savedAccountKeys(): string[] {
  return useSessionStore.getState().accounts.servers.flatMap((s) => s.users.map((u) => accountKey({ serverId: s.id, userId: u.userId })));
}

function bindNow(): void {
  const s = useSessionStore.getState().session;
  bindAccount(s ? accountKey(s) : null, savedAccountKeys());
}

export function followSession(): void {
  if (following) return;
  following = true;
  bindNow();
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.serverId === prev.session?.serverId && s.session?.userId === prev.session?.userId) return;
    bindNow();
  });
}
