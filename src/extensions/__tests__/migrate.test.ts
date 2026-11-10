/**
 * The move from the device-wide list (`extensions.v1`) to one list per
 * account (`extensions.v2`): no install is lost, bad data never throws,
 * and a saved v1-era manifest gets the current model.
 */
import { claimAccount, EXTENSIONS_SCHEMA_VERSION, installedElsewhere, loadExtensionsData, readAccountExtensions, readSavedManifest } from '../migrate';
import { pagesOf } from '../schema';
import { manifest, raw } from '../test-utils/fixtures';

const A = 'srv1.userA';
const B = 'srv1.userB';
const C = 'srv2.userC';

/** A v1 payload as the old store wrote it: the parsed manifest, with no `pages`. */
function v1Payload() {
  const { pages: _p, ...contributes } = manifest().contributes;
  return {
    list: [
      { manifestUrl: 'http://192.0.2.10:3000/zoggyfin-extension.json', manifest: { ...manifest(), contributes }, enabled: true, grants: { itemPath: true, jellyfinToken: false }, installedAt: 1_700_000_000_000 },
      { manifestUrl: 'http://192.0.2.20/x.json', manifest: { ...manifest(), id: 'org.example.off', contributes: {} }, enabled: false, grants: { itemPath: false, jellyfinToken: true }, installedAt: 1_700_000_100_000 },
    ],
    values: { 'com.example.hello': { apiKey: '•', user: 'Jane Doe', loud: false } },
    auto: { 'com.example.hello': { folder: 'videos' } },
    options: { 'com.example.hello': { folder: [{ value: 'videos', label: 'Videos' }] } },
  };
}

describe('loadExtensionsData', () => {
  it('copies the device list, grants, values and options to every saved account', () => {
    const { data, migrated } = loadExtensionsData(null, v1Payload(), [A, B, C]);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(EXTENSIONS_SCHEMA_VERSION);
    for (const key of [A, B, C]) {
      const a = data.accounts[key];
      expect(a.list.map((e) => [e.manifest.id, e.enabled, e.grants])).toEqual([
        ['com.example.hello', true, { itemPath: true, jellyfinToken: false }],
        ['org.example.off', false, { itemPath: false, jellyfinToken: true }],
      ]);
      expect(a.values['com.example.hello']).toEqual({ apiKey: '•', user: 'Jane Doe', loud: false });
      expect(a.auto['com.example.hello']).toEqual({ folder: 'videos' });
      expect(a.options['com.example.hello'].folder).toEqual([{ value: 'videos', label: 'Videos' }]);
      expect(a.skip).toEqual({});
    }
    expect(data.unclaimed).toBeNull();
  });

  it('gives a saved v1-era manifest its pages again', () => {
    const { data } = loadExtensionsData(null, v1Payload(), [A]);
    const m = data.accounts[A].list[0].manifest;
    expect(m.contributes.pages?.map((p) => p.id)).toEqual(['latest']);
    expect(pagesOf(m)).toEqual(m.contributes.pages);
  });

  it('keeps the list for the first account when none is saved', () => {
    const { data } = loadExtensionsData(null, v1Payload(), []);
    expect(data.accounts).toEqual({});
    expect(data.unclaimed?.list).toHaveLength(2);
    const first = claimAccount(data, A);
    expect(first.slice.list).toHaveLength(2);
    expect(first.data.unclaimed).toBeNull();
    expect(first.data.accounts[A]).toBe(first.slice);
    // The next account starts empty: the list belongs to the first one.
    expect(claimAccount(first.data, B).slice.list).toEqual([]);
  });

  it('reads a corrupt v1 payload entry by entry and never throws', () => {
    const bad = {
      list: [7, null, { manifestUrl: 'http://192.0.2.30/a.json' }, { manifestUrl: 'http://192.0.2.30/b.json', manifest: { id: 'x' } }, ...v1Payload().list.slice(0, 1)],
      values: 'not a map',
      auto: { 'com.example.hello': { folder: 3, ok: 'yes' } },
      options: { 'com.example.hello': { folder: [{ value: 1 }, { value: 'v', label: 'V' }], other: 'x' } },
    };
    const { data } = loadExtensionsData(null, bad, [A]);
    const a = data.accounts[A];
    expect(a.list.map((e) => e.manifest.id)).toEqual(['com.example.hello']);
    expect(a.values).toEqual({});
    expect(a.auto).toEqual({ 'com.example.hello': { ok: 'yes' } });
    expect(a.options).toEqual({ 'com.example.hello': { folder: [{ value: 'v', label: 'V' }] } });
    for (const junk of [undefined, null, 'text', 42, [], { list: 'x' }]) expect(() => loadExtensionsData(null, junk, [A])).not.toThrow();
    expect(() => loadExtensionsData({ schemaVersion: 2, accounts: 'x', unclaimed: 5 }, null, [A])).not.toThrow();
  });

  it('keeps an install whose saved manifest no longer parses', () => {
    const odd = { ...raw, permissions: ['network', 'teleport'] };
    const m = readSavedManifest(odd);
    expect(m?.id).toBe('com.example.hello');
    expect(m?.permissions).toEqual(['network', 'teleport']);
    expect(readSavedManifest({ name: 'No id' })).toBeNull();
  });

  it('reads v2 as it is and ignores v1 then', () => {
    const v2 = { schemaVersion: 2, accounts: { [A]: v1Payload(), [B]: { list: [] } }, unclaimed: null };
    const { data, migrated } = loadExtensionsData(v2, { list: [{ junk: true }] }, [A, B, C]);
    expect(migrated).toBe(false);
    expect(Object.keys(data.accounts)).toEqual([A, B]);
    expect(data.accounts[B].list).toEqual([]);
  });

  it('an empty device list moves to nothing', () => {
    expect(loadExtensionsData(null, null, [A])).toEqual({ data: expect.objectContaining({ accounts: {}, unclaimed: null }), migrated: false });
    expect(loadExtensionsData(null, { list: [] }, [A]).data.accounts).toEqual({});
  });

  it('keeps the later entry when an id is saved twice', () => {
    const p = v1Payload();
    const a = readAccountExtensions({ list: [p.list[0], { ...p.list[0], manifestUrl: 'http://192.0.2.10:3000/new.json' }] });
    expect(a.list.map((e) => e.manifestUrl)).toEqual(['http://192.0.2.10:3000/new.json']);
  });
});

describe('installedElsewhere', () => {
  it('tells when another account still has the extension (its secrets are shared by name)', () => {
    const { data } = loadExtensionsData(null, v1Payload(), [A, B]);
    expect(installedElsewhere(data, A, 'com.example.hello')).toBe(true);
    const onlyA = { ...data, accounts: { [A]: data.accounts[A] } };
    expect(installedElsewhere(onlyA, A, 'com.example.hello')).toBe(false);
  });
});
