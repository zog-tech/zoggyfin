import { isMusicItem, likeActionTitle, likeDoneText } from '../like-words';

describe('like words', () => {
  it('calls the heart Like for songs, albums, artists and audio playlists', () => {
    for (const Type of ['Audio', 'MusicAlbum', 'MusicArtist'] as const) {
      expect(likeActionTitle({ Type }, true)).toBe('Like');
      expect(likeActionTitle({ Type }, false)).toBe('Unlike');
    }
    expect(isMusicItem({ Type: 'Playlist', MediaType: 'Audio' })).toBe(true);
    expect(likeDoneText({ Type: 'Audio' }, true)).toBe('Liked');
    expect(likeDoneText({ Type: 'Audio' }, false)).toBe('Removed from Liked');
  });

  it('keeps favourites for films, shows and video playlists', () => {
    expect(likeActionTitle({ Type: 'Movie' }, true)).toBe('Add to favourites');
    expect(likeActionTitle({ Type: 'Series' }, false)).toBe('Remove from favourites');
    expect(isMusicItem({ Type: 'Playlist', MediaType: 'Video' })).toBe(false);
    expect(likeDoneText({ Type: 'Episode' }, true)).toBe('Added to favourites');
  });
});
