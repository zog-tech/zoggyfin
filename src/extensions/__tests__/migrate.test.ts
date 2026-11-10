/**
 * The move from the device-wide list (`extensions.v1`) to one list per
 * account (`extensions.v2`): no install is lost, bad data never throws,
 * and a saved v1-era manifest gets the current model.
 */
import { claimAccount, EXTENSIONS_SCHEMA_VERSION, installedElsewhere, loadExtensionsData, readAccountExtensions, readSavedManifest } from '../migrate';
import { pagesOf } from '../schema';
import { manifest, raw, rawV2 } from '../test-utils/fixtures';

const A = 'srv1.userA';
const B = 'srv1.userB';
const C = 'srv2.userC';

/** A v1 payload as the old store wrote it: the parsed manifest, with no `pages`. */
function v1Payload() {
  const { pages: _p, ...contributes } = manifest().contributes;
  return {
    list: [
      { manifestUrl: 'http://192.0.2.10:3000/zoggyfin-extension.json', manifest: { ...manifest(), contributes }, enabled: true, grants: { itemPath: true, jellyfinToken: false, playback: false, downloads: false }, installedAt: 1_700_000_000_000 },
      { manifestUrl: 'http://192.0.2.20/x.json', manifest: { ...manifest(), id: 'org.example.off', contributes: {} }, enabled: false, grants: { itemPath: false, jellyfinToken: true, playback: false, downloads: false }, installedAt: 1_700_000_100_000 },
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
        ['com.example.hello', true, { itemPath: true, jellyfinToken: false, playback: false, downloads: false }],
        ['org.example.off', false, { itemPath: false, jellyfinToken: true, playback: false, downloads: false }],
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

  it('keeps the grants of existing installs; the new grants are on only for manifests that ask for them', () => {
    const v2Manifest = manifest();
    const media = { ...rawV2 };
    const { data } = loadExtensionsData(
      null,
      {
        list: [
          { manifestUrl: 'http://192.0.2.10/hello.json', manifest: v2Manifest, enabled: true, grants: { itemPath: false, jellyfinToken: true }, installedAt: 1 },
          { manifestUrl: 'https://media.example.org/zoggyfin-extension.json', manifest: media, enabled: true, grants: { itemPath: false, jellyfinToken: false }, installedAt: 2 },
          { manifestUrl: 'https://media.example.org/b.json', manifest: { ...media, id: 'org.example.chosen' }, enabled: true, grants: { itemPath: false, jellyfinToken: false, playback: false, downloads: true }, installedAt: 3 },
        ],
      },
      [A],
    );
    expect(data.accounts[A].list.map((e) => e.grants)).toEqual([
      { itemPath: false, jellyfinToken: true, playback: false, downloads: false },
      { itemPath: false, jellyfinToken: false, playback: true, downloads: true },
      { itemPath: false, jellyfinToken: false, playback: false, downloads: true },
    ]);
  });

  it('keeps an install whose saved manifest no longer parses', () => {
    const odd = { ...raw, permissions: ['network', 'teleport'] };
    const m = readSavedManifest(odd);
    expect(m?.id).toBe('com.example.hello');
    expect(m?.permissions).toEqual(['network', 'teleport']);
    expect(readSavedManifest({ name: 'No id' })).toBeNull();
  });

  it('reads v2 and ignores v1 then; v2 is saved again as v3', () => {
    const v2 = { schemaVersion: 2, accounts: { [A]: v1Payload(), [B]: { list: [] } }, unclaimed: null };
    const { data, migrated } = loadExtensionsData(v2, { list: [{ junk: true }] }, [A, B, C]);
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(3);
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

  it('v2 → v3: an existing install has no phone tab choice (a Library tile)', () => {
    const v2 = { schemaVersion: 2, accounts: { [A]: v1Payload() }, unclaimed: null };
    const { data } = loadExtensionsData(v2, null, [A]);
    expect(data.accounts[A].list.length).toBeGreaterThan(0);
    for (const e of data.accounts[A].list) expect(e).not.toHaveProperty('phoneTab');
  });

  it('v3: keeps a known phone tab choice, drops an unknown one, and never throws', () => {
    const entry = v1Payload().list[0];
    const v3 = (phoneTab: unknown) => ({ schemaVersion: 3, accounts: { [A]: { list: [{ ...entry, phoneTab }] } }, unclaimed: null });
    const ok = loadExtensionsData(v3('(saved)'), null, [A]);
    expect(ok.migrated).toBe(false);
    expect(ok.data.accounts[A].list[0].phoneTab).toBe('(saved)');
    for (const bad of ['(home)', '(ext)', 'replace:(music)', 7, null, { x: 1 }]) {
      expect(() => loadExtensionsData(v3(bad), null, [A])).not.toThrow();
      expect(loadExtensionsData(v3(bad), null, [A]).data.accounts[A].list[0]).not.toHaveProperty('phoneTab');
    }
  });
});
