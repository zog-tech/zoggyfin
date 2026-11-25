import { playlistShareText, shareLine } from '../share-text';

describe('shareLine', () => {
  it('writes a song as artist and title', () => {
    expect(shareLine({ Type: 'Audio', MediaType: 'Audio', Name: 'Song One', Artists: ['Jane Doe'] })).toBe('Jane Doe - Song One');
  });

  it('joins several artists, and falls back to the album artist', () => {
    expect(shareLine({ Type: 'Audio', Name: 'Duet', Artists: ['Jane Doe', 'Sam Roe'] })).toBe('Jane Doe, Sam Roe - Duet');
    expect(shareLine({ Type: 'Audio', Name: 'Solo', Artists: [], AlbumArtist: 'Sam Roe' })).toBe('Sam Roe - Solo');
  });

  it('writes a song with no artist as its title', () => {
    expect(shareLine({ Type: 'Audio', Name: 'Untitled' })).toBe('Untitled');
  });

  it('writes a film with its year and an episode with its series', () => {
    expect(shareLine({ Type: 'Movie', MediaType: 'Video', Name: 'A Film', ProductionYear: 1953 })).toBe('A Film (1953)');
    expect(shareLine({ Type: 'Episode', MediaType: 'Video', Name: 'Pilot', SeriesName: 'A Show' })).toBe('A Show - Pilot');
  });

  it('skips an entry with no name', () => {
    expect(shareLine({ Type: 'Audio', Name: '  ' })).toBeNull();
  });
});

describe('playlistShareText', () => {
  it('puts the name first, then one line per entry in order', () => {
    const text = playlistShareText('Road trip', [
      { Type: 'Audio', Name: 'B', Artists: ['Y'] },
      { Type: 'Audio', Name: 'A', Artists: ['X'] },
    ]);
    expect(text).toBe('Road trip\n\nY - B\nX - A');
  });

  it('gives only the name for an empty playlist', () => {
    expect(playlistShareText('Empty', [])).toBe('Empty');
    expect(playlistShareText(null, [])).toBe('Playlist');
  });
});
