/**
 * Live TV in the Jellyfin account: providers and lists merge one by one with
 * removal markers, the order is last writer wins, a device's first sync
 * never overwrites either side, bad data from the server is ignored, and the
 * ledger never holds a secret.
 */
import {
  blobText,
  chunkKey,
  decodeChunks,
  EMPTY_META,
  encodeChunks,
  isEmptyBlob,
  localBlob,
  type LocalState,
  MAX_SYNC_CHARS,
  mergeBlobs,
  mergeStamped,
  migrateBlob,
  migrateMeta,
  observe,
  PARTS_KEY,
  planApply,
  planIsEmpty,
  sameBlob,
  SYNC_CHUNK_CHARS,
  type SyncBlob,
  type SyncMeta,
  TOMBSTONE_TTL_MS,
  withBlob,
} from '../account-sync';
import { EMPTY_LISTS } from '../lists';
import type { ChannelLists, ProviderRecord, ProviderSecrets } from '../types';
import { EMPTY_VOD_LISTS } from '../vod-lists';
import type { VodLists, VodPosition } from '../vod-types';

const T0 = 1_800_000_000_000;

function record(id: string, kind: 'xtream' | 'm3u' = 'm3u', name = id, createdAt = 1): ProviderRecord {
  return { id, kind, name, server: kind === 'xtream' ? 'http://panel.example:8080' : null, userAgent: null, hasGuide: false, createdAt, updatedAt: 1, refreshedAt: 5, channelCount: 10 };
}

function device(providers: ProviderRecord[], secrets: Record<string, ProviderSecrets> = {}, lists: Record<string, ChannelLists> = {}, vod: Record<string, VodLists> = {}): LocalState {
  const rec = Object.fromEntries(providers.map((p) => [p.id, p]));
  const sec = { ...Object.fromEntries(providers.map((p) => [p.id, p.kind === 'm3u' ? { playlistUrl: `http://lists.example/${p.id}.m3u?token=secret` } : { username: 'jane', password: 'hunter2' }])), ...secrets };
  return { providers: { schemaVersion: 1, providers: rec, order: providers.map((p) => p.id), startWith: null }, secrets: sec, lists, vod };
}

const snap = (id: string) => ({ id, name: `Channel ${id}`, group: 'News' });
const listsWith = (favourites: string[], recents: { id: string; at: number }[] = []): ChannelLists => ({
  ...EMPTY_LISTS,
  favourites,
  recents,
  snaps: Object.fromEntries([...favourites, ...recents.map((r) => r.id)].map((id) => [id, snap(id)])),
});

interface Dev {
  local: LocalState;
  meta: SyncMeta;
}

/** One device's sync against the account blob: what `sync.ts` does, with no I/O. Returns the device and the new account blob. */
function sync(d: Dev, remote: SyncBlob | null, now: number): Dev & { remote: SyncBlob } {
  const meta = observe(d.meta, d.local, now);
  const blob = mergeBlobs(localBlob(meta, d.local), remote, now);
  const plan = planApply(d.local, blob, meta);
  const local: LocalState = {
    providers: plan.providers,
    secrets: Object.fromEntries(plan.providers.order.map((id) => [id, plan.secrets[id] ?? d.local.secrets[id] ?? {}])),
    lists: Object.fromEntries(plan.providers.order.map((id) => [id, plan.lists[id] ?? d.local.lists[id] ?? EMPTY_LISTS])),
    vod: Object.fromEntries(plan.providers.order.map((id) => [id, plan.vod[id] ?? d.local.vod[id] ?? EMPTY_VOD_LISTS])),
  };
  return { local, meta: plan.meta, remote: blob };
}

const fresh = (local: LocalState): Dev => ({ local, meta: EMPTY_META });
const withoutProvider = (l: LocalState, id: string): LocalState => {
  const { [id]: _gone, ...providers } = l.providers.providers;
  return { ...l, providers: { ...l.providers, providers, order: l.providers.order.filter((x) => x !== id) } };
};
const withProvider = (l: LocalState, p: ProviderRecord, s: ProviderSecrets): LocalState => ({
  ...l,
  providers: { ...l.providers, providers: { ...l.providers.providers, [p.id]: p }, order: [...l.providers.order, p.id] },
  secrets: { ...l.secrets, [p.id]: s },
});

describe('observe', () => {
  it('gives what a device had before its first sync the lowest stamps, and later changes the time', () => {
    const local = device([record('a')], {}, { a: listsWith(['x', 'y']) });
    const m = observe(EMPTY_META, local, T0);
    expect(m.seeded).toBe(true);
    expect(m.providers.a.at).toBeLessThan(T0);
    expect(m.favourites.a.x.at).toBeGreaterThan(m.favourites.a.y.at);
    expect(m.favourites.a.x.at).toBeLessThan(T0);
    expect(observe(m, local, T0 + 1000)).toBe(m);
    const more = observe(m, { ...local, lists: { a: listsWith(['z', 'x', 'y']) } }, T0 + 2000);
    expect(more.favourites.a.z.at).toBe(T0 + 2000);
  });

  it('marks a removed favourite and a removed provider', () => {
    const local = device([record('a'), record('b')], {}, { a: listsWith(['x', 'y']) });
    const m = observe(EMPTY_META, local, T0);
    const after = observe(m, { ...local, lists: { a: listsWith(['y']) } }, T0 + 5000);
    expect(after.favourites.a.x).toEqual({ at: T0 + 5000, del: true });
    const gone = observe(after, withoutProvider({ ...local, lists: { a: listsWith(['y']) } }, 'b'), T0 + 6000);
    expect(gone.providers.b).toEqual({ at: T0 + 6000, del: true });
  });

  it('stamps a provider again only when its login or settings change, and keeps no secret', () => {
    const local = device([record('a', 'xtream')]);
    const m = observe(EMPTY_META, local, T0);
    expect(JSON.stringify(m)).not.toMatch(/hunter2|jane/);
    // A refresh (channel count, refreshed time) is not a change.
    const refreshed = { ...local, providers: { ...local.providers, providers: { a: { ...record('a', 'xtream'), channelCount: 99, refreshedAt: 77 } } } };
    expect(observe(m, refreshed, T0 + 10)).toBe(m);
    const newPassword = { ...local, secrets: { a: { username: 'jane', password: 'other' } } };
    expect(observe(m, newPassword, T0 + 10).providers.a.at).toBe(T0 + 10);
  });
});

describe('mergeStamped', () => {
  it('keeps the newer entry; on the same stamp the removal wins', () => {
    const m = mergeStamped({ x: { at: 5, val: 1 }, y: { at: 5, val: 1 } }, { x: { at: 6, del: true }, y: { at: 5, del: true } }, 10, 100);
    expect(m.x).toEqual({ at: 6, del: true });
    expect(m.y).toEqual({ at: 5, del: true });
  });

  it('drops old removal markers and keeps the newest entries up to the limit', () => {
    const m = mergeStamped({ old: { at: T0 - TOMBSTONE_TTL_MS - 1, del: true }, a: { at: 1 }, b: { at: 2 }, c: { at: 3 } }, undefined, T0, 2);
    expect(Object.keys(m).sort()).toEqual(['b', 'c']);
  });
});

describe('providers on two devices', () => {
  it('keeps providers added on two devices, and a removal on one reaches the other', () => {
    let tv = sync(fresh(device([record('a')])), null, T0);
    let remote = tv.remote;
    let phone = sync(fresh(device([])), remote, T0 + 10);
    remote = phone.remote;
    expect(phone.local.providers.order).toEqual(['a']);
    expect(phone.local.secrets.a.playlistUrl).toContain('token=secret');

    // Each adds a different provider before they sync.
    tv = { ...tv, local: withProvider(tv.local, record('tvp', 'm3u', 'TV list', 2), { playlistUrl: 'http://lists.example/tv.m3u' }) };
    phone = { ...phone, local: withProvider(phone.local, record('php', 'm3u', 'Phone list', 3), { playlistUrl: 'http://lists.example/phone.m3u' }) };
    tv = sync(tv, remote, T0 + 20);
    phone = sync(phone, tv.remote, T0 + 30);
    tv = sync(tv, phone.remote, T0 + 40);
    expect(new Set(tv.local.providers.order)).toEqual(new Set(['a', 'tvp', 'php']));
    expect(new Set(phone.local.providers.order)).toEqual(new Set(['a', 'tvp', 'php']));

    // The phone removes the TV's provider.
    phone = sync({ ...phone, local: withoutProvider(phone.local, 'tvp') }, tv.remote, T0 + 50);
    const plan = planApply(tv.local, mergeBlobs(localBlob(observe(tv.meta, tv.local, T0 + 60), tv.local), phone.remote, T0 + 60), tv.meta);
    expect(plan.removed).toEqual(['tvp']);
    tv = sync(tv, phone.remote, T0 + 60);
    expect(tv.local.providers.order).not.toContain('tvp');
  });

  it('a first sync with providers on both sides keeps both and overwrites neither', () => {
    const account = sync(fresh(device([record('acc', 'xtream', 'Account', 1)], {}, { acc: listsWith(['f1']) })), null, T0).remote;
    const mine = device([record('acc', 'xtream', 'Renamed here', 1), record('own', 'm3u', 'Own', 2)], { acc: { username: 'jane', password: 'hunter2' } }, { own: listsWith(['f2']) });
    const r = sync(fresh(mine), account, T0 + 100);
    expect(r.local.providers.order).toEqual(['acc', 'own']);
    // The account's version of a provider the device also had wins on the first sync.
    expect(r.local.providers.providers.acc.name).toBe('Account');
    expect(r.local.lists.acc.favourites).toEqual(['f1']);
    expect(r.local.lists.own.favourites).toEqual(['f2']);
  });

  it('a removal in the account wins over the same provider on a device that syncs for the first time', () => {
    const first = sync(fresh(device([record('a'), record('b')])), null, T0);
    const removed = sync({ ...first, local: withoutProvider(first.local, 'b') }, first.remote, T0 + 10);
    const r = sync(fresh(device([record('b')])), removed.remote, T0 + 20);
    expect(r.local.providers.order).toEqual(['a']);
  });

  it('makes two providers with the same login one, and moves the favourites over', () => {
    const account = sync(fresh(device([record('old', 'm3u', 'Lists', 1)], { old: { playlistUrl: 'http://lists.example/same.m3u' } })), null, T0).remote;
    const mine = device([record('dup', 'm3u', 'Lists', 5)], { dup: { playlistUrl: 'http://lists.example/same.m3u' } }, { dup: listsWith(['fav']) });
    const r = sync(fresh(mine), account, T0 + 100);
    expect(r.local.providers.order).toEqual(['old']);
    expect(r.local.lists.old.favourites).toEqual(['fav']);
    expect(r.remote.providers.dup.del).toBe(true);
  });

  it('gives a second provider with the same name a number', () => {
    const account = sync(fresh(device([record('a', 'm3u', 'News', 1)])), null, T0).remote;
    const r = sync(fresh(device([record('b', 'm3u', 'News', 2)])), account, T0 + 1);
    expect(r.local.providers.providers.b.name).not.toBe('News');
  });

  it('takes the newer order and start choice', () => {
    let a = sync(fresh(device([record('x', 'm3u', 'X', 1), record('y', 'm3u', 'Y', 2)])), null, T0);
    let b = sync(fresh(device([])), a.remote, T0 + 1);
    b = { ...b, local: { ...b.local, providers: { ...b.local.providers, order: ['y', 'x'], startWith: 'y' } } };
    b = sync(b, a.remote, T0 + 2);
    a = sync(a, b.remote, T0 + 3);
    expect(a.local.providers.order).toEqual(['y', 'x']);
    expect(a.local.providers.startWith).toBe('y');
  });
});

describe('lists on two devices', () => {
  it('keeps a favourite added on the TV and another added on the phone', () => {
    let tv = sync(fresh(device([record('a')], {}, { a: listsWith(['base']) })), null, T0);
    let phone = sync(fresh(device([])), tv.remote, T0 + 1000);
    expect(phone.local.lists.a.favourites).toEqual(['base']);
    tv = { ...tv, local: { ...tv.local, lists: { a: listsWith(['tv', 'base']) } } };
    phone = { ...phone, local: { ...phone.local, lists: { a: listsWith(['phone', 'base']) } } };
    tv = sync(tv, phone.remote, T0 + 2000);
    phone = sync(phone, tv.remote, T0 + 3000);
    tv = sync(tv, phone.remote, T0 + 4000);
    expect(new Set(phone.local.lists.a.favourites)).toEqual(new Set(['tv', 'phone', 'base']));
    expect(new Set(tv.local.lists.a.favourites)).toEqual(new Set(['tv', 'phone', 'base']));
    expect(phone.local.lists.a.favourites[0]).toBe('phone');

    // A removal on the phone reaches the TV.
    phone = sync({ ...phone, local: { ...phone.local, lists: { a: listsWith(['phone', 'base']) } } }, tv.remote, T0 + 5000);
    tv = sync(tv, phone.remote, T0 + 6000);
    expect(tv.local.lists.a.favourites).not.toContain('tv');
  });

  it('keeps the newest position of a film and the newest play of a channel', () => {
    const p = (at: number, position: number): VodPosition => ({ kind: 'film', id: 'f', position, duration: 6000, at, finished: false, title: 'F' });
    const a = sync(fresh(device([record('a')], {}, { a: listsWith([], [{ id: 'c', at: 10 }]) }, { a: { ...EMPTY_VOD_LISTS, positions: { 'film:f': p(10, 100) } } })), null, T0);
    let b = sync(fresh(device([])), a.remote, T0 + 1);
    b = sync({ ...b, local: { ...b.local, lists: { a: listsWith([], [{ id: 'c', at: 50 }]) }, vod: { a: { ...EMPTY_VOD_LISTS, positions: { 'film:f': p(50, 900) } } } } }, b.remote, T0 + 2);
    const back = sync(a, b.remote, T0 + 3);
    expect(back.local.vod.a.positions['film:f'].position).toBe(900);
    expect(back.local.lists.a.recents).toEqual([{ id: 'c', at: 50 }]);
  });

  it('a synced device stays still: a second sync with nothing new changes nothing', () => {
    const vod: VodPosition = { kind: 'film', id: 'f1', position: 600, duration: 6000, at: T0 - 5, finished: false, title: 'A film' };
    const first = sync(fresh(device([record('a')], {}, { a: listsWith(['x'], [{ id: 'y', at: T0 - 9 }]) }, { a: { ...EMPTY_VOD_LISTS, positions: { 'film:f1': vod } } })), null, T0);
    expect(observe(first.meta, first.local, T0 + 100)).toBe(first.meta);
    const again = mergeBlobs(localBlob(first.meta, first.local), first.remote, T0 + 100);
    expect(sameBlob(again, first.remote)).toBe(true);
    expect(planIsEmpty(planApply(first.local, again, first.meta), first.local)).toBe(true);
  });

  it('a user with no providers makes an empty blob (the app does not send it)', () => {
    expect(isEmptyBlob(sync(fresh(device([])), null, T0).remote)).toBe(true);
  });
});

describe('reading the blob', () => {
  it('ignores bad data and never throws', () => {
    for (const raw of [null, 1, 'x', [], {}, { schemaVersion: 'x' }, { schemaVersion: 1, providers: 'no' }, { schemaVersion: 1, settings: 5 }]) {
      expect(() => migrateBlob(raw)).not.toThrow();
    }
    const b = migrateBlob({
      schemaVersion: 1,
      providers: {
        ok: { at: 5, val: { kind: 'm3u', name: 'Lists', createdAt: 1, secrets: { playlistUrl: 'http://lists.example/a.m3u' } } },
        nourl: { at: 5, val: { kind: 'm3u', name: 'No list', secrets: {} } },
        bad: { at: 5, val: { kind: 'other' } },
        nostamp: { val: { kind: 'm3u', secrets: { playlistUrl: 'http://lists.example/b.m3u' } } },
        gone: { at: 7, del: true },
      },
      settings: { at: 3, order: ['gone', 'ok', 5], startWith: 'gone' },
      favourites: { ok: { c1: { at: 3, val: { name: 'One', group: '', url: 'http://stream.example/live?token=1' } }, c2: { at: 'x' }, c3: { at: 4, del: true } }, gone: { c: { at: 1 } } },
    });
    expect(Object.keys(b?.providers ?? {}).sort()).toEqual(['gone', 'ok']);
    expect(b?.settings).toEqual({ at: 3, order: ['ok'], startWith: null });
    expect(b?.favourites.ok.c1.val).toEqual({ id: 'c1', name: 'One', group: '' });
    expect(b?.favourites.ok.c2).toBeUndefined();
    expect(b?.favourites.ok.c3).toEqual({ at: 4, del: true });
    expect(b?.favourites.gone).toBeUndefined();
  });

  it('reads a bad ledger as empty', () => {
    expect(migrateMeta('x')).toEqual(EMPTY_META);
    expect(migrateMeta({ seeded: true, favourites: { a: { x: { at: 1 }, y: 'bad' } } }).favourites).toEqual({ a: { x: { at: 1 } } });
  });
});

describe('chunks', () => {
  it('splits a large blob into numbered keys and reads it back', () => {
    const many = Array.from({ length: 1500 }, (_, i) => `channel-${i}-${'x'.repeat(150)}`);
    const blob = sync(fresh(device([record('a')], {}, { a: listsWith(many) })), null, T0).remote;
    const text = blobText(blob) as string;
    const prefs = encodeChunks(text);
    expect(Number(prefs[PARTS_KEY])).toBe(Math.ceil(text.length / SYNC_CHUNK_CHARS));
    expect(Number(prefs[PARTS_KEY])).toBeGreaterThan(1);
    expect(sameBlob(decodeChunks(prefs), blob)).toBe(true);
    const { [chunkKey(1)]: _gone, ...missing } = prefs;
    expect(decodeChunks(missing)).toBeNull();
    expect(decodeChunks({ [PARTS_KEY]: '1', [chunkKey(0)]: '{not json' })).toBeNull();
  });

  it('keeps the other keys and replaces the blob keys', () => {
    expect(withBlob({ other: 'keep', empty: null, [chunkKey(5)]: 'old' }, '{}')).toEqual({ other: 'keep', [PARTS_KEY]: '1', [chunkKey(0)]: '{}' });
  });

  it('leaves out positions, then recents, when the blob is too large', () => {
    const big: VodPosition = { kind: 'film', id: 'f', position: 100, duration: 6000, at: 1, finished: false, title: 'x'.repeat(MAX_SYNC_CHARS) };
    const blob = sync(fresh(device([record('a')], {}, { a: listsWith(['c']) }, { a: { ...EMPTY_VOD_LISTS, positions: { 'film:f': big } } })), null, T0).remote;
    const back = migrateBlob(JSON.parse(blobText(blob) as string));
    expect(back?.positions).toEqual({});
    expect(Object.keys(back?.favourites.a ?? {})).toEqual(['c']);
  });
});
