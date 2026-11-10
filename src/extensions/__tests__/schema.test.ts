import { describePermission, parseManifest } from '../schema';
import { raw } from '../test-utils/fixtures';

describe('parseManifest', () => {
  it('accepts a full manifest', () => {
    const r = parseManifest(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.contributes.itemActions?.[0].request.method).toBe('POST');
      expect(r.manifest.contributes.homeSections?.[0].shape).toBe('thumb');
    }
  });

  it('adds the network permission', () => {
    const r = parseManifest({ ...raw, permissions: ['itemPath'] });
    expect(r.ok && r.manifest.permissions).toEqual(['network', 'itemPath']);
  });

  it('fills defaults for a minimal manifest', () => {
    const r = parseManifest({ schemaVersion: 1, id: 'min', name: 'Min', version: '1', baseUrl: 'https://ext.example' });
    expect(r.ok && r.manifest.permissions).toEqual(['network']);
    expect(r.ok && r.manifest.contributes).toEqual({});
  });

  it('rejects another schema version with a clear message', () => {
    const r = parseManifest({ ...raw, schemaVersion: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/versions 1 and 2.*version 3/);
  });

  it('rejects a base URL that is not http(s)', () => {
    const r = parseManifest({ ...raw, baseUrl: 'file:///etc' });
    expect(r.ok).toBe(false);
  });

  it('rejects text that is not a URL and a header map with a bad value, naming the field', () => {
    const u = parseManifest({ ...raw, baseUrl: 'not a url' });
    expect(!u.ok && u.error).toMatch(/^baseUrl: /);
    const h = parseManifest({ ...raw, headers: { Authorization: 5 } });
    expect(!h.ok && h.error).toMatch(/^headers\.Authorization: /);
  });

  it('rejects unknown permissions and bad ids, naming the field', () => {
    const p = parseManifest({ ...raw, permissions: ['camera'] });
    expect(!p.ok && p.error).toMatch(/^permissions/);
    const i = parseManifest({ ...raw, id: 'Bad Id' });
    expect(!i.ok && i.error).toMatch(/^id/);
  });

  it('rejects a duplicate contribution id', () => {
    const a = raw.contributes.itemActions[0];
    const r = parseManifest({ ...raw, contributes: { ...raw.contributes, itemActions: [a, a] } });
    expect(!r.ok && r.error).toMatch(/greet.*twice/);
  });

  it('rejects an unknown setting source', () => {
    const r = parseManifest({ ...raw, contributes: { settings: [{ key: 'x', type: 'text', label: 'X', source: 'jellyfin.password' }] } });
    expect(r.ok).toBe(false);
  });

  it('describes the token permission as sensitive', () => {
    const d = describePermission('jellyfinToken', { name: 'Hello', baseUrl: raw.baseUrl });
    expect(d.sensitive).toBe(true);
    expect(d.title).toBe('Hello can act as you on your Jellyfin server');
  });
});
