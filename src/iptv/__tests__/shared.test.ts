/**
 * Providers shared by an admin: the choices, who they reach, the blob of
 * each user (two admins can share with one user), what the user's device
 * changes, and bad data that never throws.
 */
import type { SyncedProvider } from '../account-sync';
import {
  desiredFor,
  EMPTY_SHARED,
  EMPTY_SHARING,
  localSharedId,
  migrateShared,
  migrateSharing,
  parseShared,
  planShared,
  sharedLabel,
  targetsOf,
  withAdminShares,
  withChoice,
  withValue,
} from '../shared';
import type { ProviderRecord, ProviderSecrets } from '../types';

const ADMIN = { userId: 'admin1', name: 'Sam' };
const xtream = (name = 'Panel'): SyncedProvider => ({ kind: 'xtream', name, server: 'http://panel.example:8080', userAgent: null, createdAt: 1, secrets: { username: 'jane', password: 'hunter2' } });
const m3u = (url = 'http://lists.example/a.m3u?token=1'): SyncedProvider => ({ kind: 'm3u', name: 'Lists', server: null, userAgent: null, createdAt: 2, secrets: { playlistUrl: url } });

describe('choices', () => {
  it('saves a choice, clears it, and keeps the same object when nothing changes', () => {
    const a = withChoice(EMPTY_SHARING, 'p1', { everyone: false, users: ['u2', 'u1', 'u1'] });
    expect(a.providers.p1).toEqual({ everyone: false, users: ['u1', 'u2'] });
    expect(withChoice(a, 'p1', { everyone: false, users: ['u1', 'u2'] })).toBe(a);
    expect(withChoice(a, 'p1', null).providers).toEqual({});
    expect(withChoice(a, 'p1', { everyone: false, users: [] }).providers).toEqual({});
    expect(withChoice(a, 'p1', { everyone: true, users: ['u1'] }).providers.p1).toEqual({ everyone: true, users: [] });
  });

  it('reaches everyone but the admin, or the chosen users that exist', () => {
    const ids = ['admin1', 'u1', 'u2', 'u3'];
    expect(targetsOf({ everyone: true, users: [] }, ids, 'admin1')).toEqual(['u1', 'u2', 'u3']);
    expect(targetsOf({ everyone: false, users: ['u2', 'gone', 'admin1'] }, ids, 'admin1')).toEqual(['u2']);
    expect(targetsOf(undefined, ids, 'admin1')).toEqual([]);
  });

  it('a user added later is reached by "Everyone"', () => {
    const choices = withChoice(EMPTY_SHARING, 'p1', { everyone: true, users: [] });
    expect(Object.keys(desiredFor('new', choices, { p1: xtream() }, ['admin1', 'u1', 'new'], ADMIN))).toEqual(['p1']);
  });

  it('a choice for a removed provider reaches no one', () => {
    const choices = withChoice(EMPTY_SHARING, 'p1', { everyone: true, users: [] });
    expect(desiredFor('u1', choices, {}, ['admin1', 'u1'], ADMIN)).toEqual({});
  });
});

describe('a user blob', () => {
  it('replaces only this admin entries; another admin entries stay', () => {
    const other = { ...m3u(), by: { userId: 'admin2', name: 'Kim' } };
    const blob = migrateShared({ providers: { q: other } });
    const added = withAdminShares(blob, 'admin1', { p1: { ...xtream(), by: ADMIN } });
    expect(Object.keys(added.providers).sort()).toEqual(['p1', 'q']);
    expect(withAdminShares(added, 'admin1', { p1: { ...xtream(), by: ADMIN } })).toBe(added);
    const removed = withAdminShares(added, 'admin1', {});
    expect(Object.keys(removed.providers)).toEqual(['q']);
  });

  it('ignores bad data and never throws', () => {
    for (const raw of [null, 3, 'x', [], { providers: 5 }]) expect(migrateShared(raw)).toEqual(EMPTY_SHARED);
    const b = migrateShared({
      providers: {
        ok: { ...xtream(), by: ADMIN },
        noBy: xtream(),
        noPassword: { ...xtream(), secrets: { username: 'jane' }, by: ADMIN },
        noList: { ...m3u(), secrets: {}, by: ADMIN },
        'bad id/..': { ...xtream(), by: ADMIN },
      },
    });
    expect(Object.keys(b.providers)).toEqual(['ok']);
    expect(parseShared({ shared: '{nope' })).toEqual(EMPTY_SHARED);
    expect(migrateSharing({ providers: { p: { users: [1, 'u1'] }, q: { everyone: 'yes' } } }).providers).toEqual({ p: { everyone: false, users: ['u1'] } });
  });

  it('writes one key and keeps the others', () => {
    expect(withValue({ sharing: 'x', shared: 'old', other: null }, 'shared', null)).toEqual({ sharing: 'x' });
    expect(withValue({ sharing: 'x' }, 'shared', { a: 1 })).toEqual({ sharing: 'x', shared: '{"a":1}' });
  });
});

describe('the user device', () => {
  const record = (id: string, extra: Partial<ProviderRecord> = {}): ProviderRecord => ({
    id,
    kind: 'xtream',
    name: 'Panel',
    server: 'http://panel.example:8080',
    userAgent: null,
    hasGuide: true,
    createdAt: 1,
    updatedAt: 1,
    refreshedAt: 9,
    channelCount: 40,
    ...extra,
  });

  it('adds a shared provider under its own id, with its login for the secure store', () => {
    const blob = migrateShared({ providers: { p1: { ...xtream(), by: ADMIN } } });
    const plan = planShared({ own: record('own') }, () => ({}), blob, 'u1', 100);
    expect(plan.remove).toEqual([]);
    expect(plan.upsert).toHaveLength(1);
    expect(plan.upsert[0].record).toMatchObject({ id: localSharedId('p1'), sharedBy: ADMIN, refreshedAt: null });
    expect(plan.upsert[0].secrets).toEqual({ username: 'jane', password: 'hunter2' });
  });

  it('changes nothing when the shared provider is the same, and reloads it when the login changes', () => {
    const id = localSharedId('p1');
    const have = { [id]: record(id, { sharedBy: ADMIN }) };
    const secrets: Record<string, ProviderSecrets> = { [id]: { username: 'jane', password: 'hunter2' } };
    const same = planShared(have, (x) => secrets[x] ?? {}, migrateShared({ providers: { p1: { ...xtream(), by: ADMIN } } }), 'u1', 100);
    expect(same).toEqual({ upsert: [], remove: [] });
    const changed = planShared(have, (x) => secrets[x] ?? {}, migrateShared({ providers: { p1: { ...xtream(), secrets: { username: 'jane', password: 'new' }, by: ADMIN } } }), 'u1', 100);
    expect(changed.upsert[0].reload).toBe(true);
    expect(changed.upsert[0].record.channelCount).toBe(0);
  });

  it('removes a provider that is no longer shared, and never touches the user own providers', () => {
    const id = localSharedId('p1');
    const plan = planShared({ [id]: record(id, { sharedBy: ADMIN }), own: record('own') }, () => ({}), EMPTY_SHARED, 'u1', 100);
    expect(plan.remove).toEqual([id]);
  });

  it('skips a provider the user shared (the admin own blob)', () => {
    const plan = planShared({}, () => ({}), migrateShared({ providers: { p1: { ...xtream(), by: ADMIN } } }), 'admin1', 100);
    expect(plan.upsert).toEqual([]);
  });

  it('labels a shared provider', () => {
    expect(sharedLabel(ADMIN)).toBe('Shared by Sam');
  });
});
