import { GRANT_KEYS, grantKeyOf, hasGrant, readGrants } from '../grants';
import { PERMISSIONS } from '../schema';

describe('grants', () => {
  it('gives each permission but network its own grant', () => {
    expect(PERMISSIONS.map((p) => grantKeyOf(p))).toEqual(PERMISSIONS.map((p) => (p === 'network' ? null : p)));
    expect(new Set(GRANT_KEYS).size).toBe(GRANT_KEYS.length);
  });

  it('counts a grant only with its permission', () => {
    const grants = { itemPath: true, jellyfinToken: true, playback: true, downloads: false };
    expect(hasGrant({ manifest: { permissions: ['network', 'playback', 'downloads'] }, grants }, 'playback')).toBe(true);
    expect(hasGrant({ manifest: { permissions: ['network', 'playback', 'downloads'] }, grants }, 'downloads')).toBe(false);
    expect(hasGrant({ manifest: { permissions: ['network'] }, grants }, 'jellyfinToken')).toBe(false);
  });

  it('reads saved grants: old ones keep their value, new ones follow the manifest', () => {
    expect(readGrants({ itemPath: true, jellyfinToken: false }, ['network', 'itemPath'])).toEqual({ itemPath: true, jellyfinToken: false, playback: false, downloads: false });
    expect(readGrants({ jellyfinToken: true }, ['network', 'playback', 'downloads'])).toEqual({ itemPath: false, jellyfinToken: true, playback: true, downloads: true });
    expect(readGrants({ playback: false }, ['network', 'playback'])).toEqual({ itemPath: false, jellyfinToken: false, playback: false, downloads: false });
    for (const junk of [null, 'x', 3, []]) expect(readGrants(junk, ['network'])).toEqual({ itemPath: false, jellyfinToken: false, playback: false, downloads: false });
  });
});
