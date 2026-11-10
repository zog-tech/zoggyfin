/**
 * Account sync of the extension list: the merge, removal markers, the
 * seen ledger (no confirm-screen loop), first-sync seeding, conflicts by
 * stamp, secrets that never sync, and the CustomPrefs chunks.
 */
import { chunkCodec, TOMBSTONE_TTL_MS } from '@/lib/account-blob';

import {
  accountInstall,
  applyUpdates,
  decodeExtBlob,
  EMPTY_EXT_META,
  extBlobText,
  extChunks,
  type ExtSyncBlob,
  type ExtSyncMeta,
  isEmptyBlob,
  type LocalExtensions,
  localBlob,
  markSeen,
  mergeBlobs,
  migrateExtBlob,
  migrateExtMeta,
  observe,
  planApply,
  sameBlob,
  syncedOf,
  withExtBlob,
} from '../sync/blob';
import { manifest } from '../test-utils/fixtures';
import type { InstalledExtension } from '../types';

const T0 = 1_800_000_000_000;
const HELLO = 'com.example.hello';

function ext(id: string, installedAt = 100, over: Partial<InstalledExtension> = {}): InstalledExtension {
  return { manifestUrl: `http://192.0.2.10/${id}.json`, manifest: { ...manifest(), id }, enabled: true, grants: { itemPath: false, jellyfinToken: true, playback: false, downloads: false }, installedAt, ...over };
}

function device(list: InstalledExtension[] = [], values: LocalExtensions['values'] = {}): { local: LocalExtensions; meta: ExtSyncMeta } {
  return { local: { list, values, skip: {} }, meta: EMPTY_EXT_META };
}

/** One sync of a device with the account, as `io.ts` does it; the offers show (and the device installs none). */
function sync(d: { local: LocalExtensions; meta: ExtSyncMeta }, remote: ExtSyncBlob | null, now: number) {
  let meta = observe(d.meta, d.local, now);
  const blob = mergeBlobs(localBlob(meta, d.local), remote, now);
  const plan = planApply(d.local, blob, meta);
  const removed = { ...d.local, list: d.local.list.filter((e) => !plan.remove.includes(e.manifest.id)) };
  d.local = applyUpdates(removed, plan);
  meta = markSeen(plan.meta, plan.offer);
  d.meta = meta;
  return { blob, plan, pushed: !sameBlob(blob, remote) && !(isEmptyBlob(blob) && !remote) };
}

describe('extension account sync', () => {
  it('first sync: the device seeds the account with the lowest stamps', () => {
    const a = device([ext(HELLO)], { [HELLO]: { user: 'Jane Doe' } });
    const r = sync(a, null, T0);
    expect(r.pushed).toBe(true);
    expect(r.blob.extensions[HELLO]).toMatchObject({ at: 1, val: { manifestUrl: `http://192.0.2.10/${HELLO}.json`, settings: { user: 'Jane Doe' }, addedAt: 100 } });
    expect(r.plan.offer).toEqual([]);
    // Nothing changed: the next sync sends nothing.
    expect(sync(a, r.blob, T0 + 1).pushed).toBe(false);
  });

  it('a user with no extensions anywhere gets no blob', () => {
    expect(sync(device(), null, T0).pushed).toBe(false);
  });

  it('first sync of a new device only adds: the account keeps its version', () => {
    const a = device([ext(HELLO)], { [HELLO]: { user: 'Jane Doe' } });
    a.meta = { ...EMPTY_EXT_META, seeded: true };
    const account = sync(a, null, T0).blob;
    const b = device([ext(HELLO, 200), ext('org.example.other')], { [HELLO]: { user: 'Sam' } });
    const r = sync(b, account, T0 + 10);
    expect(Object.keys(r.blob.extensions).sort()).toEqual([HELLO, 'org.example.other']);
    expect(r.blob.extensions[HELLO].val?.settings).toEqual({ user: 'Jane Doe' });
    expect(b.local.values[HELLO]).toEqual({ user: 'Jane Doe' });
    expect(b.local.list.find((e) => e.manifest.id === HELLO)?.installedAt).toBe(100);
  });

  it('offers an extension of the account once, and never loops on repeated pulls', () => {
    const a = device([ext(HELLO)]);
    const account = sync(a, null, T0).blob;
    const b = device();
    const first = sync(b, account, T0 + 1);
    expect(first.plan.offer).toEqual([{ id: HELLO, manifestUrl: `http://192.0.2.10/${HELLO}.json`, added: 100, at: 1, val: account.extensions[HELLO].val }]);
    // "Not now": the device installs nothing. Ten more pulls offer nothing.
    for (let i = 0; i < 10; i++) expect(sync(b, account, T0 + 2 + i).plan.offer).toEqual([]);
    // The offer is not in the ledger as installed, so nothing is removed from the account.
    expect(sync(b, account, T0 + 20).blob.extensions[HELLO].del).toBeUndefined();
  });

  it('a settings change elsewhere does not offer again; a new add does', () => {
    const a = device([ext(HELLO)]);
    let account = sync(a, null, T0).blob;
    const b = device();
    sync(b, account, T0 + 1);
    a.local = { ...a.local, values: { [HELLO]: { user: 'Sam' } } };
    account = sync(a, account, T0 + 2).blob;
    expect(sync(b, account, T0 + 3).plan.offer).toEqual([]);
    // Removed and added again on the first device.
    a.local = { ...a.local, list: [] };
    account = sync(a, account, T0 + 4).blob;
    a.local = { ...a.local, list: [ext(HELLO, T0 + 5)] };
    account = sync(a, account, T0 + 6).blob;
    expect(sync(b, account, T0 + 7).plan.offer.map((o) => o.added)).toEqual([T0 + 5]);
  });

  /** The account with the extension from the first device, and a second device that was offered it. */
  function offered(grants = { itemPath: true, jellyfinToken: true, playback: false, downloads: false }) {
    const a = device([ext(HELLO, 100, { grants, tab: 'latest' })], { [HELLO]: { user: 'Jane Doe', apiKey: '•' } });
    a.meta = { ...EMPTY_EXT_META, seeded: true };
    const account = sync(a, null, T0).blob;
    const c = device();
    c.meta = { ...EMPTY_EXT_META, seeded: true };
    const [offer] = sync(c, account, T0 + 1).plan.offer;
    /** The confirm screen's install, with the grants the user set there. */
    const installWith = (g: InstalledExtension['grants']) => {
      const r = accountInstall(ext(HELLO, T0 + 2, { grants: g }), { user: 'Default' }, offer.val);
      c.local = { ...c.local, list: [r.ext], values: { [HELLO]: r.values } };
    };
    return { a, c, account, offer, installWith };
  }

  it('an install of an offered extension takes the account settings and grants, and sends nothing back', () => {
    const { c, account, offer, installWith } = offered({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    expect(offer.val.grants).toEqual({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    installWith(offer.val.grants);
    const rc = sync(c, account, T0 + 4);
    expect(rc.pushed).toBe(false);
    const got = c.local.list[0];
    expect(got.grants).toEqual({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    expect(got.tab).toBe('latest');
    expect(got.installedAt).toBe(100);
    expect(c.local.values[HELLO]).toEqual({ user: 'Jane Doe' });
    expect(sync(c, account, T0 + 5).pushed).toBe(false);
  });

  it('a grant the user turns off on the confirm screen stays off after the next pull, and goes to the account', () => {
    const { c, account, installWith } = offered();
    installWith({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    const r = sync(c, account, T0 + 4);
    expect(r.pushed).toBe(true);
    expect(c.local.list[0].grants.jellyfinToken).toBe(false);
    expect(r.blob.extensions[HELLO].val?.grants.jellyfinToken).toBe(false);
    // The account's settings still came with the install.
    expect(r.blob.extensions[HELLO].val?.settings).toEqual({ user: 'Jane Doe' });
    // A later pull of the older account value (the push did not reach the server) does not undo it.
    const again = sync(c, account, T0 + 5);
    expect(c.local.list[0].grants.jellyfinToken).toBe(false);
    expect(again.blob.extensions[HELLO].val?.grants.jellyfinToken).toBe(false);
    // And a pull of the account after the push changes nothing.
    expect(sync(c, r.blob, T0 + 6).pushed).toBe(false);
    expect(c.local.list[0].grants.jellyfinToken).toBe(false);
  });

  it('a newer grant change on another device still applies after the choice on the screen', () => {
    const { a, c, account, installWith } = offered();
    installWith({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    let blob = sync(c, account, T0 + 4).blob;
    blob = sync(a, blob, T0 + 5).blob;
    expect(a.local.list[0].grants.jellyfinToken).toBe(false);
    // Later, the first device turns the token grant on again.
    a.local = { ...a.local, list: [{ ...a.local.list[0], grants: { itemPath: true, jellyfinToken: true, playback: false, downloads: false } }] };
    blob = sync(a, blob, T0 + 100).blob;
    sync(c, blob, T0 + 101);
    expect(c.local.list[0].grants.jellyfinToken).toBe(true);
  });

  it('syncs the playback and download grants like the others', () => {
    const a = device([ext(HELLO)]);
    a.meta = { ...EMPTY_EXT_META, seeded: true };
    let account = sync(a, null, T0).blob;
    const b = device([ext(HELLO)]);
    b.meta = { ...EMPTY_EXT_META, seeded: true };
    account = sync(b, account, T0 + 1).blob;
    a.local = { ...a.local, list: [{ ...a.local.list[0], grants: { ...a.local.list[0].grants, playback: true, downloads: false } }] };
    account = sync(a, account, T0 + 10).blob;
    expect(account.extensions[HELLO].val?.grants).toEqual({ itemPath: false, jellyfinToken: true, playback: true, downloads: false });
    sync(b, account, T0 + 11);
    expect(b.local.list[0].grants).toEqual({ itemPath: false, jellyfinToken: true, playback: true, downloads: false });
  });

  it('a removal on one device removes the extension on the others, with no offer', () => {
    const a = device([ext(HELLO)]);
    a.meta = { ...EMPTY_EXT_META, seeded: true };
    let account = sync(a, null, T0).blob;
    const b = device([ext(HELLO)]);
    b.meta = { ...EMPTY_EXT_META, seeded: true };
    account = sync(b, account, T0 + 1).blob;
    a.local = { ...a.local, list: [] };
    account = sync(a, account, T0 + 2).blob;
    expect(account.extensions[HELLO]).toMatchObject({ del: true });
    const r = sync(b, account, T0 + 3);
    expect(r.plan.remove).toEqual([HELLO]);
    expect(r.plan.offer).toEqual([]);
    expect(b.local.list).toEqual([]);
    // The marker goes after 30 days.
    expect(mergeBlobs(account, null, account.extensions[HELLO].at + TOMBSTONE_TTL_MS + 1).extensions).toEqual({});
  });

  it('a removal in the account wins over a device that had the extension before its first sync', () => {
    const tomb: ExtSyncBlob = { schemaVersion: 1, extensions: { [HELLO]: { at: T0 - 1000, del: true } }, skip: {} };
    const b = device([ext(HELLO)]);
    expect(sync(b, tomb, T0).plan.remove).toEqual([HELLO]);
  });

  it('a conflict goes to the newer stamp; a tie keeps the account', () => {
    const base = device([ext(HELLO)]);
    base.meta = { ...EMPTY_EXT_META, seeded: true };
    const local = (user: string): LocalExtensions => ({ list: [ext(HELLO)], values: { [HELLO]: { user } }, skip: {} });
    const remote = (user: string, at: number): ExtSyncBlob => ({ schemaVersion: 1, extensions: { [HELLO]: { at, val: { ...syncedOf(local(user), HELLO)! } } }, skip: {} });
    const meta = observe(base.meta, local('mine'), T0);
    const at = meta.extensions[HELLO].at;
    expect(mergeBlobs(localBlob(meta, local('mine')), remote('theirs', at + 1), T0).extensions[HELLO].val?.settings).toEqual({ user: 'theirs' });
    expect(mergeBlobs(localBlob(meta, local('mine')), remote('theirs', at - 1), T0).extensions[HELLO].val?.settings).toEqual({ user: 'mine' });
    expect(mergeBlobs(localBlob(meta, local('mine')), remote('theirs', at), T0).extensions[HELLO].val?.settings).toEqual({ user: 'theirs' });
  });

  it('never syncs a secret setting and keeps the device secrets on an update', () => {
    const a = device([ext(HELLO)], { [HELLO]: { apiKey: '•', user: 'Jane Doe', loud: false } });
    const blob = sync(a, null, T0).blob;
    expect(blob.extensions[HELLO].val?.settings).toEqual({ user: 'Jane Doe', loud: false });
    expect(JSON.stringify(blob)).not.toContain('apiKey');
    // The account says apiKey too (an old or bad blob): it is not written.
    const evil: ExtSyncBlob = { schemaVersion: 1, extensions: { [HELLO]: { at: T0 + 1000, val: { ...blob.extensions[HELLO].val!, settings: { user: 'Sam', apiKey: 'stolen' } } } }, skip: {} };
    const b = device([ext(HELLO)], { [HELLO]: { apiKey: '•', user: 'Jane Doe' } });
    b.meta = { ...EMPTY_EXT_META, seeded: true };
    sync(b, evil, T0 + 200);
    expect(b.local.values[HELLO]).toEqual({ apiKey: '•', user: 'Sam' });
  });

  it('merges skip choices per label', () => {
    const a = device();
    a.local.skip = { [`${HELLO}:intro`]: 'auto' };
    a.meta = { ...EMPTY_EXT_META, seeded: true };
    let account = sync(a, null, T0).blob;
    const b = device();
    b.local.skip = { [`${HELLO}:promo`]: 'off' };
    b.meta = { ...EMPTY_EXT_META, seeded: true };
    account = sync(b, account, T0 + 1).blob;
    expect(b.local.skip).toEqual({ [`${HELLO}:intro`]: 'auto', [`${HELLO}:promo`]: 'off' });
    a.local = { ...a.local, skip: {} };
    account = sync(a, account, T0 + 2).blob;
    sync(b, account, T0 + 3);
    expect(b.local.skip).toEqual({ [`${HELLO}:promo`]: 'off' });
  });
});

describe('reading and writing the blob', () => {
  it('splits a large blob into chunks and reads it back', () => {
    const big: ExtSyncBlob = { schemaVersion: 1, extensions: {}, skip: {} };
    for (let i = 0; i < 150; i++) big.extensions[`org.example.e${i}`] = { at: T0 + i, val: { manifestUrl: `https://media.example.org/${i}/zoggyfin-extension.json`, enabled: true, grants: { itemPath: false, jellyfinToken: false, playback: false, downloads: false }, settings: { note: 'x'.repeat(1500) }, addedAt: i } };
    const text = extBlobText(big)!;
    const small = chunkCodec('ext', 50_000);
    const prefs = small.encode(text);
    expect(Number(prefs['ext.parts'])).toBeGreaterThan(1);
    expect(small.decode(prefs)).toBe(text);
    const sent = withExtBlob({ other: 'kept', 'ext.parts': '9', 'ext.8': 'old', 'iptv.parts': '1' }, text);
    expect(sent.other).toBe('kept');
    expect(sent['iptv.parts']).toBe('1');
    expect(sent['ext.8']).toBeUndefined();
    expect(sameBlob(decodeExtBlob(sent), big)).toBe(true);
  });

  it('reads nothing from missing parts or bad JSON, and never throws', () => {
    expect(decodeExtBlob(null)).toBeNull();
    expect(decodeExtBlob({ 'ext.parts': '2', 'ext.0': '{}' })).toBeNull();
    expect(decodeExtBlob({ 'ext.parts': '1', 'ext.0': '{not json' })).toBeNull();
    expect(decodeExtBlob(extChunks.encode('{"schemaVersion":1}'))).toEqual({ schemaVersion: 1, extensions: {}, skip: {} });
  });

  it('drops bad entries from the server', () => {
    const b = migrateExtBlob({
      schemaVersion: 1,
      extensions: {
        good: { at: 5, val: { manifestUrl: 'https://media.example.org/m.json', settings: { a: 'b', n: 3 }, tab: 'main' } },
        script: { at: 5, val: { manifestUrl: 'javascript:alert(1)' } },
        nostamp: { val: { manifestUrl: 'https://media.example.org/m.json' } },
        gone: { at: 6, del: true },
      },
      skip: { 'a:intro': { at: 1, val: 'auto' }, 'a:bad': { at: 1, val: 'sometimes' }, nolabel: { at: 1, val: 'off' } },
    });
    expect(Object.keys(b!.extensions).sort()).toEqual(['gone', 'good']);
    expect(b!.extensions.good.val).toEqual({ manifestUrl: 'https://media.example.org/m.json', enabled: true, grants: { itemPath: false, jellyfinToken: false, playback: true, downloads: true }, settings: { a: 'b' }, tab: 'main', addedAt: 0 });
    expect(Object.keys(b!.skip)).toEqual(['a:intro']);
    expect(migrateExtBlob({ extensions: {} })).toBeNull();
    expect(migrateExtBlob('x')).toBeNull();
  });

  it('reads any ledger and never throws', () => {
    expect(migrateExtMeta(null)).toEqual(EMPTY_EXT_META);
    expect(migrateExtMeta({ seeded: true, extensions: { a: { at: 1 }, b: 'x' }, seen: { a: { added: 1, at: 2 }, b: { added: 'x' } } })).toMatchObject({ seeded: true, extensions: { a: { at: 1 } }, seen: { a: { added: 1, at: 2 } } });
  });
});
