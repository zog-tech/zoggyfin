import { cancelInstallRequest, chosenGrants, confirmInstallRequest, initialGrants, loadInstallRequest, pendingCandidates, useInstallRequest } from '../install-request';
import type { Candidate } from '../runtime';
import { manifest } from '../test-utils/fixtures';

const cand = (id: string): Candidate => ({ manifestUrl: `http://192.0.2.10/${id}.json`, manifest: { ...manifest(), id, name: id.toUpperCase() } });

/** A load that the test settles by hand. */
function deferredLoad() {
  const waiting = new Map<string, (c: Candidate) => void>();
  const load = (input: string) => new Promise<Candidate>((resolve) => waiting.set(input, resolve));
  return { load, settle: (input: string) => waiting.get(input)?.(cand(input)) };
}

const state = () => useInstallRequest.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => cancelInstallRequest());

describe('install request', () => {
  it('shows the addresses, then the loaded extensions and errors', async () => {
    const p = loadInstallRequest(['a', 'bad'], async (input) => {
      if (input === 'bad') throw new Error('Not an extension.');
      return cand(input);
    });
    expect(state()).toMatchObject({ loading: true, entries: [{ input: 'a' }, { input: 'bad' }] });
    await p;
    expect(state().loading).toBe(false);
    expect(state().entries[1].error).toBe('Not an extension.');
    expect(pendingCandidates(state().entries).map((c) => c.manifest.id)).toEqual(['a']);
  });

  it('the screen starts from the account grants for an extension from the account', () => {
    const c = cand('a');
    expect(initialGrants(c)).toEqual({ itemPath: true, jellyfinToken: true, playback: false, downloads: false });
    const fromAccount = { manifestUrl: c.manifestUrl, enabled: true, grants: { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, settings: {}, addedAt: 1 };
    expect(initialGrants({ ...c, fromAccount })).toEqual({ itemPath: false, jellyfinToken: false, playback: false, downloads: false });
    expect(initialGrants({ ...c, fromAccount: { ...fromAccount, grants: { itemPath: true, jellyfinToken: true, playback: false, downloads: false } } })).toEqual({ itemPath: true, jellyfinToken: true, playback: false, downloads: false });
    // No grant without its permission, whatever the account says.
    const noToken = { ...c, manifest: { ...c.manifest, permissions: ['network' as const] } };
    expect(initialGrants({ ...noToken, fromAccount: { ...fromAccount, grants: { itemPath: true, jellyfinToken: true, playback: false, downloads: false } } })).toEqual({ itemPath: false, jellyfinToken: false, playback: false, downloads: false });
    // An update keeps the installed token choice.
    const installed = { manifestUrl: c.manifestUrl, manifest: c.manifest, enabled: true, grants: { itemPath: true, jellyfinToken: false, playback: false, downloads: false }, installedAt: 1 };
    expect(initialGrants({ ...c, installed }).jellyfinToken).toBe(false);
  });

  it('gives playback and downloads their own switch, on by default, apart from the token', () => {
    const v2 = { ...cand('m'), manifest: { ...cand('m').manifest, permissions: ['network' as const, 'jellyfinToken' as const, 'playback' as const, 'downloads' as const] } };
    expect(initialGrants(v2)).toEqual({ itemPath: false, jellyfinToken: true, playback: true, downloads: true });
    expect(chosenGrants(v2, { playback: false })).toEqual({ itemPath: false, jellyfinToken: true, playback: false, downloads: true });
    expect(chosenGrants(v2, { jellyfinToken: false })).toEqual({ itemPath: false, jellyfinToken: false, playback: true, downloads: true });
    expect(chosenGrants(v2, { downloads: false, jellyfinToken: false })).toEqual({ itemPath: false, jellyfinToken: false, playback: true, downloads: false });
    // A switch never turns on a grant the manifest does not ask for.
    expect(chosenGrants(cand('a'), { playback: true })).toMatchObject({ playback: false, downloads: false });
    // From the account: each switch starts from the account's value.
    const fromAccount = { manifestUrl: v2.manifestUrl, enabled: true, grants: { itemPath: false, jellyfinToken: true, playback: false, downloads: true }, settings: {}, addedAt: 1 };
    expect(initialGrants({ ...v2, fromAccount })).toEqual({ itemPath: false, jellyfinToken: true, playback: false, downloads: true });
  });

  it('remembers who asked: the user or account sync', async () => {
    await loadInstallRequest(['a'], async (i) => cand(i), 'account');
    expect(state().source).toBe('account');
    cancelInstallRequest();
    expect(state().source).toBe('user');
    await loadInstallRequest(['b'], async (i) => cand(i));
    expect(state().source).toBe('user');
  });

  it('a late load after Cancel does not bring the list back', async () => {
    const d = deferredLoad();
    const p = loadInstallRequest(['a'], d.load);
    cancelInstallRequest();
    d.settle('a');
    await p;
    expect(state().entries).toEqual([]);
    expect(state().loading).toBe(false);
  });

  it('a late load does not replace a newer request', async () => {
    const d = deferredLoad();
    const old = loadInstallRequest(['a'], d.load);
    const now = loadInstallRequest(['b'], d.load);
    d.settle('b');
    await now;
    d.settle('a');
    await old;
    expect(state().entries.map((e) => e.input)).toEqual(['b']);
  });

  it('adds every extension in order', async () => {
    await loadInstallRequest(['a', 'b'], async (i) => cand(i));
    const added: string[] = [];
    const r = await confirmInstallRequest(async (c) => {
      added.push(c.manifest.id);
    });
    expect(r).toEqual({ kind: 'done', names: ['A', 'B'] });
    expect(added).toEqual(['a', 'b']);
  });

  it('after a failure offers only the extensions not added, with a message', async () => {
    await loadInstallRequest(['a', 'b'], async (i) => cand(i));
    const r = await confirmInstallRequest(async (c) => {
      if (c.manifest.id === 'b') throw new Error('No space.');
    });
    expect(r).toMatchObject({ kind: 'partial', added: ['A'], failed: 'B' });
    expect(state().notice).toBe('A is on. B could not be added: No space.');
    expect(state().installing).toBe(false);
    expect(pendingCandidates(state().entries).map((c) => c.manifest.id)).toEqual(['b']);

    const again: string[] = [];
    const r2 = await confirmInstallRequest(async (c) => {
      again.push(c.manifest.id);
    });
    expect(r2).toEqual({ kind: 'done', names: ['B'] });
    expect(again).toEqual(['b']);
  });

  it('refuses a second confirm while one runs, and stops after Cancel', async () => {
    await loadInstallRequest(['a', 'b'], async (i) => cand(i));
    let release = () => {};
    const added: string[] = [];
    const first = confirmInstallRequest(async (c) => {
      added.push(c.manifest.id);
      if (c.manifest.id === 'a') await new Promise<void>((r) => (release = r));
    });
    await flush();
    expect(await confirmInstallRequest(async () => {})).toEqual({ kind: 'none' });
    cancelInstallRequest();
    release();
    expect(await first).toEqual({ kind: 'none' });
    expect(added).toEqual(['a']);
    expect(state().entries).toEqual([]);
  });
});
