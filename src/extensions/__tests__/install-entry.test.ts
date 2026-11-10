import { installEntry } from '../install-entry';
import { manifest } from '../test-utils/fixtures';
import type { InstalledExtension } from '../types';

const grants: InstalledExtension['grants'] = { itemPath: false, jellyfinToken: false, playback: true, downloads: false };

describe('installEntry', () => {
  it('a new extension is on and has no tab choice', () => {
    const e = installEntry({ manifestUrl: 'http://192.0.2.10/a.json', manifest: manifest() }, grants, 500);
    expect(e).toEqual({ manifestUrl: 'http://192.0.2.10/a.json', manifest: manifest(), enabled: true, grants, installedAt: 500 });
  });

  it('an update keeps the tab page, the place on the phone and the add time', () => {
    const old: InstalledExtension = { manifestUrl: 'http://192.0.2.10/a.json', manifest: manifest(), enabled: true, grants, installedAt: 100, tab: 'main', phoneTab: '(saved)' };
    const newer = { ...manifest(), version: '9.9.9' };
    const e = installEntry({ manifestUrl: 'http://192.0.2.10/b.json', manifest: newer, installed: old }, grants, 500);
    expect(e.tab).toBe('main');
    expect(e.phoneTab).toBe('(saved)');
    expect(e.installedAt).toBe(100);
    expect(e.manifest.version).toBe('9.9.9');
    expect(e.manifestUrl).toBe('http://192.0.2.10/b.json');
  });
});
