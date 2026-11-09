import { canAddToPlaylist, fits, moveEntry, playlistMediaFor, playlistName, removeEntries, rollbackTo, sheetOrder, touchRecent } from '../logic';

describe('playlist media', () => {
  it('sends audio to audio playlists and video to video playlists', () => {
    expect(playlistMediaFor([{ Type: 'Audio' }])).toBe('Audio');
    expect(playlistMediaFor([{ Type: 'MusicAlbum' }])).toBe('Audio');
    expect(playlistMediaFor([{ Type: 'Movie' }])).toBe('Video');
    expect(playlistMediaFor([{ Type: 'Episode' }])).toBe('Video');
    expect(playlistMediaFor([{ Type: 'Playlist', MediaType: 'Video' }])).toBe('Video');
  });

  it('fits playlists of the same type, or with no type', () => {
    expect(fits({ MediaType: 'Audio' }, 'Audio')).toBe(true);
    expect(fits({ MediaType: 'Video' }, 'Audio')).toBe(false);
    expect(fits({}, 'Video')).toBe(true);
  });

  it('knows what can go into a playlist', () => {
    expect(canAddToPlaylist({ Id: 'a', Type: 'Audio' })).toBe(true);
    expect(canAddToPlaylist({ Id: 'a', Type: 'Person' })).toBe(false);
    expect(canAddToPlaylist({ Type: 'Movie' })).toBe(false);
  });
});

describe('sheetOrder', () => {
  const lists = [
    { Id: '1', Name: 'beta' },
    { Id: '2', Name: 'Alpha' },
    { Id: '3', Name: 'Gamma' },
  ];
  it('puts recent first (in use order), then the rest A–Z', () => {
    const o = sheetOrder(lists, ['3', 'missing', '1']);
    expect(o.recent.map((p) => p.Id)).toEqual(['3', '1']);
    expect(o.all.map((p) => p.Id)).toEqual(['2']);
  });
  it('sorts A–Z without case', () => {
    expect(sheetOrder(lists, []).all.map((p) => p.Name)).toEqual(['Alpha', 'beta', 'Gamma']);
  });
  it('shows at most five recent playlists', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ Id: String(i), Name: `P${i}` }));
    expect(sheetOrder(many, many.map((p) => p.Id)).recent).toHaveLength(5);
  });
  it('moves a used playlist to the front', () => {
    expect(touchRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(touchRecent(['a'], 'z', 2)).toEqual(['z', 'a']);
  });
});

describe('reorder and remove', () => {
  it('moves to the final index, like the server', () => {
    expect(moveEntry(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveEntry(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveEntry(['a', 'b', 'c'], 1, 10)).toEqual(['a', 'c', 'b']);
    expect(moveEntry(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('removes by entry id, not item id', () => {
    const list = [
      { Id: 'x', PlaylistItemId: 'e1' },
      { Id: 'x', PlaylistItemId: 'e2' },
      { Id: 'y', PlaylistItemId: 'e3' },
    ];
    expect(removeEntries(list, ['e2']).map((i) => i.PlaylistItemId)).toEqual(['e1', 'e3']);
  });
  it('cleans the name', () => {
    expect(playlistName('  Road   trip ')).toBe('Road trip');
    expect(playlistName('   ')).toBe('New playlist');
  });
});

describe('rollbackTo', () => {
  const before = [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }];
  it('puts the old list back when the cache still holds this change', () => {
    const applied = moveEntry(before, 0, 2);
    expect(rollbackTo(applied, applied, before)).toBe(before);
  });
  it('keeps a newer change: two fast moves, the first one fails', () => {
    const first = moveEntry(before, 0, 2);
    const second = moveEntry(first, 0, 1);
    expect(rollbackTo(second, first, before)).toBeNull();
  });
});
