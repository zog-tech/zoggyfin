import type { ProviderChannel } from '@/iptv';

import {
  HOME_ROW_MAX,
  homeRowChannels,
  LIVE_TV_TILE_ID,
  libraryTileSubtitle,
  showHomeRow,
  showLibraryTile,
  withLiveTvTile,
} from '../placement';

const pc = (providerId: string, id: string): ProviderChannel => ({
  key: `${providerId}|${id}`,
  providerId,
  channel: { id, name: `Channel ${id}`, url: `http://example.com/${id}.ts`, group: 'News' },
});

const ios = { os: 'ios', tab: false, tv: false };
const android = { os: 'android', tab: false, tv: false };
const web = { os: 'web', tab: true, tv: false };
const tv = { os: 'android', tab: false, tv: true };

describe('showLibraryTile', () => {
  it('shows on iOS only after a provider is added', () => {
    expect(showLibraryTile(ios, 0)).toBe(false);
    expect(showLibraryTile(ios, 1)).toBe(true);
  });

  it('shows on Android with no provider, so people find Live TV', () => {
    expect(showLibraryTile(android, 0)).toBe(true);
  });

  it('never shows where Live TV is a tab or in the TV side menu', () => {
    expect(showLibraryTile(web, 2)).toBe(false);
    expect(showLibraryTile(tv, 2)).toBe(false);
  });
});

describe('showHomeRow', () => {
  it('needs a provider on every platform', () => {
    for (const env of [ios, android, web]) {
      expect(showHomeRow(env, 0)).toBe(false);
      expect(showHomeRow(env, 1)).toBe(true);
    }
  });

  it('never shows on TV', () => {
    expect(showHomeRow(tv, 3)).toBe(false);
  });
});

describe('homeRowChannels', () => {
  it('puts favourites first, then recents that are not favourites', () => {
    const fav = [pc('a', '1'), pc('b', '2')];
    const rec = [pc('b', '2'), pc('a', '3'), pc('a', '1')];
    expect(homeRowChannels(fav, rec).map((c) => c.key)).toEqual(['a|1', 'b|2', 'a|3']);
  });

  it('uses recents when there are no favourites', () => {
    expect(homeRowChannels([], [pc('a', '9')]).map((c) => c.key)).toEqual(['a|9']);
  });

  it('is empty with no favourites and no recents', () => {
    expect(homeRowChannels([], [])).toEqual([]);
  });

  it('keeps the same channel id of two providers apart', () => {
    expect(homeRowChannels([pc('a', '1')], [pc('b', '1')])).toHaveLength(2);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => pc('a', String(i)));
    expect(homeRowChannels(many, [])).toHaveLength(HOME_ROW_MAX);
    expect(homeRowChannels(many, many, 3).map((c) => c.key)).toEqual(['a|0', 'a|1', 'a|2']);
  });
});

describe('libraryTileSubtitle', () => {
  it('counts the favourites first', () => {
    expect(libraryTileSubtitle(['Home IPTV'], 1)).toBe('1 favourite');
    expect(libraryTileSubtitle(['Home IPTV', 'Other'], 4)).toBe('4 favourites');
  });

  it('names the provider, or counts the providers', () => {
    expect(libraryTileSubtitle(['Home IPTV'], 0)).toBe('Home IPTV');
    expect(libraryTileSubtitle(['A', 'B', 'C'], 0)).toBe('3 providers');
  });

  it('asks for a provider when there is none', () => {
    expect(libraryTileSubtitle([], 0)).toBe('Add an IPTV provider');
  });
});

describe('withLiveTvTile', () => {
  const views = [{ Id: 'm', Name: 'Movies' }, { Id: 's', Name: 'Shows' }];

  it('adds the tile after the libraries', () => {
    const out = withLiveTvTile(views, true);
    expect(out.map((v) => v.Id)).toEqual(['m', 's', LIVE_TV_TILE_ID]);
    expect(out[2]).toMatchObject({ Name: 'Live TV', CollectionType: 'livetv' });
  });

  it('leaves the libraries as they are when hidden', () => {
    expect(withLiveTvTile(views, false)).toEqual(views);
  });

  it('shows the tile alone when the server has no libraries', () => {
    expect(withLiveTvTile([], true).map((v) => v.Id)).toEqual([LIVE_TV_TILE_ID]);
  });
});
