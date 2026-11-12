import { parseManifest, type Manifest } from '../schema';
import { rawV2 } from '../test-utils/fixtures';
import { checkForUpdates, type CheckDeps, clearUpdatePending, dueForCheck, markUpdatePending, pendingUpdatesOf, UPDATE_CHECK_INTERVAL_MS, updatePlan, useExtensionUpdates } from '../update-check';

jest.mock('@/storage/json', () => ({ readJson: (_k: string, fb: unknown) => fb, writeJson: jest.fn() }));

function ok(data: unknown): Manifest {
  const r = parseManifest(data);
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}

const page = rawV2.contributes.pages[0];
const base = ok(rawV2);
const sec = (id: string) => ({ id, title: id, feed: `/api/${id}` });
const withPages = (pages: unknown[], extra: object = {}) => ok({ ...rawV2, ...extra, contributes: { ...rawV2.contributes, pages } });
const tabbed = withPages([{ ...page, tabs: [{ id: 'a', title: 'A', sections: [sec('x')] }, { id: 'b', title: 'B', sections: [sec('y')] }] }], { version: '2.1.0' });

describe('updatePlan', () => {
  it('applies an update that only adds tabs and bumps the version, with no confirm', () => {
    expect(updatePlan(base, tabbed)).toEqual({ kind: 'apply', newPermissions: [], newlyPlaced: [] });
  });

  it('does nothing for the same manifest', () => {
    expect(updatePlan(base, ok(rawV2)).kind).toBe('none');
  });

  it('asks for consent for a new permission', () => {
    const next = ok({ ...rawV2, permissions: [...rawV2.permissions, 'jellyfinToken'] });
    expect(updatePlan(base, next)).toMatchObject({ kind: 'consent', newPermissions: ['jellyfinToken'] });
  });

  it('applies a page that asks for a new place, with no confirm', () => {
    const quiet = withPages([{ ...page, placement: { home: [] } }]);
    const placedLater = withPages([{ ...page, placement: { library: true, home: [] } }]);
    expect(updatePlan(quiet, placedLater)).toMatchObject({ kind: 'apply', newlyPlaced: [page.id] });
    const extra = withPages([page, { id: 'other', title: 'Other', placement: { tab: true }, sections: [sec('z')] }]);
    expect(updatePlan(base, extra)).toMatchObject({ kind: 'apply', newlyPlaced: ['other'] });
    // A new place together with a new permission still asks.
    const both = withPages([page, { id: 'other', title: 'Other', placement: { tab: true }, sections: [sec('z')] }], { permissions: [...rawV2.permissions, 'jellyfinToken'] });
    expect(updatePlan(base, both)).toMatchObject({ kind: 'consent', newPermissions: ['jellyfinToken'] });
    // A page that keeps its place, or drops one, asks nothing.
    expect(updatePlan(placedLater, quiet).kind).toBe('apply');
  });
});

describe('dueForCheck', () => {
  it('checks at start and then at most once per 15 minutes', () => {
    expect(dueForCheck(undefined, 1000)).toBe(true);
    expect(dueForCheck(1000, 1000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(dueForCheck(1000, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
  });
});

describe('checkForUpdates', () => {
  // `key` names the manifest URL; the id is the manifest's.
  const ext = (key: string, manifest: Manifest) => ({ id: manifest.id, name: `Ext ${key}`, manifestUrl: `https://media.example.org/${key}.json`, manifest });
  const other = ok({ ...rawV2, id: 'org.example.b' });
  function deps(served: Record<string, Manifest | Error>, toasted: Record<string, string> = {}) {
    const d = {
      account: 'acct',
      toasted,
      load: jest.fn(async (url: string) => {
        const m = served[url];
        if (!m || m instanceof Error) throw m ?? new Error('404');
        return { manifest: m };
      }),
      apply: jest.fn(),
      markPending: jest.fn(),
      toast: jest.fn(),
      saveToasted: jest.fn((next: Record<string, string>) => {
        d.toasted = next;
      }),
    } satisfies CheckDeps;
    return d;
  }

  it('applies a tabs-only update by itself, and leaves an unchanged one alone', async () => {
    const d = deps({ 'https://media.example.org/a.json': tabbed, 'https://media.example.org/b.json': other });
    const r = await checkForUpdates([ext('a', base), ext('b', other)], d);
    expect(r).toEqual({ applied: [base.id], pending: [] });
    expect(d.apply).toHaveBeenCalledWith(base.id, tabbed);
    expect(d.toast).not.toHaveBeenCalled();
  });

  it('marks an update that needs consent, toasts once per version, and never applies it', async () => {
    const next = ok({ ...rawV2, version: '3.0.0', permissions: [...rawV2.permissions, 'jellyfinToken'] });
    const served = { 'https://media.example.org/a.json': next };
    const d = deps(served);
    const list = [ext('a', base)];
    expect(await checkForUpdates(list, d)).toEqual({ applied: [], pending: [base.id] });
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.markPending).toHaveBeenCalledWith(base.id, '3.0.0');
    expect(d.toast).toHaveBeenCalledTimes(1);
    expect(d.toast.mock.calls[0][0]).toContain('Ext a has an update');
    // The next check (another launch) marks it again but does not toast again.
    const again = deps(served, d.toasted);
    await checkForUpdates(list, again);
    expect(again.markPending).toHaveBeenCalledTimes(1);
    expect(again.toast).not.toHaveBeenCalled();
    // A newer version toasts once more.
    const newer = deps({ 'https://media.example.org/a.json': { ...next, version: '3.1.0' } }, d.toasted);
    await checkForUpdates(list, newer);
    expect(newer.toast).toHaveBeenCalledTimes(1);
  });

  it('ignores errors and a URL that now serves another extension', async () => {
    const d = deps({ 'https://media.example.org/a.json': new Error('offline'), 'https://media.example.org/b.json': ok({ ...rawV2, id: 'org.example.other', version: '9' }) });
    expect(await checkForUpdates([ext('a', base), ext('b', base)], d)).toEqual({ applied: [], pending: [] });
    expect(d.apply).not.toHaveBeenCalled();
  });
});

describe('pending updates per account', () => {
  it('keeps each account apart and clears one when it is applied', () => {
    markUpdatePending('acct1', 'a', '2');
    markUpdatePending('acct2', 'b', '5');
    const st = useExtensionUpdates.getState();
    expect(pendingUpdatesOf(st, 'acct1')).toEqual({ a: '2' });
    expect(pendingUpdatesOf(st, 'acct2')).toEqual({ b: '5' });
    expect(pendingUpdatesOf(st, null)).toEqual({});
    clearUpdatePending('acct1', 'a');
    expect(pendingUpdatesOf(useExtensionUpdates.getState(), 'acct1')).toEqual({});
    expect(pendingUpdatesOf(useExtensionUpdates.getState(), 'acct2')).toEqual({ b: '5' });
  });
});
