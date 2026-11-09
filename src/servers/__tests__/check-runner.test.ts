import { serverChecks } from '../check-runner';

/** A check that waits until the test lets it end. */
function deferredCheck() {
  const calls: { serverId: string; seen: string; end: (ok: boolean) => void; fail: (e: Error) => void }[] = [];
  let addresses = 'old';
  const check = (serverId: string) =>
    new Promise<boolean>((resolve, reject) => {
      calls.push({ serverId, seen: addresses, end: resolve, fail: reject });
    });
  return { calls, check, setAddresses: (a: string) => (addresses = a) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('serverChecks', () => {
  it('checks once more after an edit during a check, and gives the newer result', async () => {
    const d = deferredCheck();
    const checks = serverChecks(d.check);
    const first = checks('s1');
    await flush();
    d.setAddresses('new');
    const second = checks('s1');
    d.calls[0]!.end(false);
    await flush();
    expect(d.calls).toHaveLength(2);
    expect(d.calls[1]!.seen).toBe('new');
    d.calls[1]!.end(true);
    await expect(second).resolves.toBe(true);
    await expect(first).resolves.toBe(true);
  });

  it('runs one more check for many requests during a check', async () => {
    const d = deferredCheck();
    const checks = serverChecks(d.check);
    void checks('s1');
    await flush();
    void checks('s1');
    void checks('s1');
    d.calls[0]!.end(true);
    await flush();
    d.calls[1]!.end(true);
    await flush();
    expect(d.calls).toHaveLength(2);
  });

  it('does not make one server wait for another', async () => {
    const d = deferredCheck();
    const checks = serverChecks(d.check);
    void checks('s1');
    const b = checks('s2');
    await flush();
    expect(d.calls.map((c) => c.serverId)).toEqual(['s1', 's2']);
    d.calls[1]!.end(true);
    await expect(b).resolves.toBe(true);
  });

  it('gives false and never rejects when a check throws, and the next check runs', async () => {
    const d = deferredCheck();
    const checks = serverChecks(d.check);
    const a = checks('s1');
    await flush();
    d.calls[0]!.fail(new Error('no network facts'));
    await expect(a).resolves.toBe(false);
    const b = checks('s1');
    await flush();
    d.calls[1]!.end(true);
    await expect(b).resolves.toBe(true);
  });
});
