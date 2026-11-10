import { plannedContributions, registrationSignature } from '../registration';
import { manifest } from '../test-utils/fixtures';
import type { InstalledExtension } from '../types';

const ext = (id: string, at: number, enabled = true): InstalledExtension => ({ manifestUrl: `http://192.0.2.10/${id}.json`, manifest: { ...manifest(), id }, enabled, grants: { itemPath: false, jellyfinToken: false }, installedAt: at });

describe('registration', () => {
  it('registers the enabled extensions, oldest install first', () => {
    const plan = plannedContributions([ext('b', 2), ext('a', 1), ext('off', 0, false)]);
    expect(plan.map((c) => [c.kind, c.id, c.order])).toEqual([
      ['itemAction', 'ext.a.greet', 60],
      ['homeSection', 'ext.a.latest', 45],
      ['itemAction', 'ext.b.greet', 65],
      ['homeSection', 'ext.b.latest', 46],
    ]);
  });

  it('registers again on an account switch, also when both lists are the same', () => {
    const list = [ext('a', 1)];
    const a = registrationSignature('srv.userA', list);
    expect(registrationSignature('srv.userA', [ext('a', 1)])).toBe(a);
    expect(registrationSignature('srv.userB', list)).not.toBe(a);
    expect(registrationSignature(null, [])).not.toBe(registrationSignature('srv.userA', []));
  });

  it('does not register again for a change that adds nothing (a disabled extension)', () => {
    const base = registrationSignature('k', [ext('a', 1)]);
    expect(registrationSignature('k', [ext('a', 1), ext('off', 2, false)])).toBe(base);
    expect(registrationSignature('k', [{ ...ext('a', 1), grants: { itemPath: true, jellyfinToken: false } }])).not.toBe(base);
  });
});
