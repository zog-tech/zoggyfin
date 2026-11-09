/**
 * One address check per server at a time, with one more after it.
 *
 * A check reads the server's address list and mode when it starts. A request
 * during a check (an address edit, a network change) must not get that old
 * result, so the runner checks once more after the current check, and the
 * request's promise gives the result of that newer check. Requests for
 * different servers never wait for each other.
 *
 * A check that throws counts as "no address answers": the promise never
 * rejects, so callers that use `void` do not leave an unhandled rejection.
 *
 * Pure, so it is unit-tested. The check itself is passed in.
 */
import { createSerialRunner, type SerialRunner } from '@/lib/async-gate';

export function serverChecks(check: (serverId: string) => Promise<boolean>): (serverId: string) => Promise<boolean> {
  const byServer = new Map<string, { runner: SerialRunner; ok: boolean }>();
  return (serverId) => {
    let entry = byServer.get(serverId);
    if (!entry) {
      const created = {
        ok: false,
        runner: createSerialRunner(async () => {
          created.ok = await check(serverId).catch(() => false);
        }),
      };
      byServer.set(serverId, created);
      entry = created;
    }
    const e = entry;
    return e.runner.request().then(
      () => e.ok,
      () => false,
    );
  };
}
