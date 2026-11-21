import { generatedArt, genreIcon, iconForType } from '../generated-art';
import { bucketSize, buildImageUrl, buildTrickplayUrl, buildUserImageUrl, imageCacheKey, imageSource } from '../image-url';

const server = { baseUrl: 'https://jf.example.com/base', token: 'abc' };

describe('bucketSize', () => {
  it('rounds up to a 40 px step', () => {
    expect(bucketSize(1)).toBe(40);
    expect(bucketSize(40)).toBe(40);
    expect(bucketSize(41)).toBe(80);
    expect(bucketSize(333.3)).toBe(360);
  });
  it('clamps bad and huge values', () => {
    expect(bucketSize(0)).toBe(40);
    expect(bucketSize(Number.NaN)).toBe(40);
    expect(bucketSize(99999)).toBe(3840);
  });
});

describe('buildImageUrl', () => {
  it('builds a sized, tagged URL with ApiKey', () => {
    expect(buildImageUrl(server, { itemId: 'i1', type: 'Primary', tag: 't', width: 200, height: 300 })).toBe(
      'https://jf.example.com/base/Items/i1/Images/Primary?tag=t&fillWidth=200&fillHeight=320&quality=90&ApiKey=abc',
    );
  });
  it('adds the index for backdrops and chapters only', () => {
    expect(buildImageUrl(server, { itemId: 'i', type: 'Backdrop', tag: 't', index: 2, width: 100 })).toContain(
      '/Images/Backdrop/2?',
    );
    expect(buildImageUrl(server, { itemId: 'i', type: 'Primary', tag: 't', index: 2, width: 100 })).toContain(
      '/Images/Primary?',
    );
  });
  it('omits ApiKey without a token and encodes the tag', () => {
    const url = buildImageUrl({ ...server, token: null }, { itemId: 'i', type: 'Thumb', tag: 'a b', width: 10, quality: 80 });
    expect(url).toBe('https://jf.example.com/base/Items/i/Images/Thumb?tag=a%20b&fillWidth=40&quality=80');
  });
});

describe('other URLs', () => {
  it('builds trickplay and user image URLs', () => {
    expect(buildTrickplayUrl(server, { itemId: 'v', mediaSourceId: 'm', width: 320, sheet: 0 })).toBe(
      'https://jf.example.com/base/Videos/v/Trickplay/320/0.jpg?mediaSourceId=m&ApiKey=abc',
    );
    expect(buildUserImageUrl(server, 'u', 'tg', 90)).toBe(
      'https://jf.example.com/base/Users/u/Images/Primary?tag=tg&fillWidth=120&fillHeight=120&quality=90&ApiKey=abc',
    );
  });
});

describe('generatedArt', () => {
  it('is deterministic per title', () => {
    expect(generatedArt('Sample Movie', 'Movie')).toEqual(generatedArt('Sample Movie', 'Movie'));
  });
  it('gives different titles different colors', () => {
    expect(generatedArt('Sample Movie').art.from).not.toEqual(generatedArt('Another Movie').art.from);
  });
  it('handles empty titles', () => {
    expect(generatedArt('  ').title).toBe('Untitled');
    expect(generatedArt(null).title).toBe('Untitled');
  });
  it('maps types to icons', () => {
    expect(iconForType('MusicAlbum')).toBe('music.note');
    expect(iconForType('Person')).toBe('person');
    expect(iconForType('Unknown')).toBe('play.rectangle');
    expect(iconForType('CollectionFolder', 'music')).toBe('music.note');
  });
});

describe('genreIcon', () => {
  it('picks a glyph from the genre name', () => {
    expect(genreIcon('Action', 'Genre')).toBe('flame');
    expect(genreIcon('Action & Adventure', 'Genre')).toBe('flame');
    expect(genreIcon('Comedy', 'Genre')).toBe('face.smiling');
    expect(genreIcon('Science Fiction', 'Genre')).toBe('sparkles');
    expect(genreIcon('Sci-Fi & Fantasy', 'Genre')).toBe('sparkles');
    expect(genreIcon('War & Politics', 'Genre')).toBe('shield');
    expect(genreIcon('Documentary', 'Genre')).toBe('camera');
    expect(genreIcon('Animation', 'Genre')).toBe('paintpalette');
  });
  it('keeps the masks for a genre it does not know', () => {
    expect(genreIcon('Drama', 'Genre')).toBe('theatermasks');
    expect(genreIcon('Software', 'Genre')).toBe('theatermasks');
    expect(genreIcon(null, 'Genre')).toBe('theatermasks');
  });
  it('has its own rules for music genres', () => {
    expect(genreIcon('Hard Rock', 'MusicGenre')).toBe('guitars');
    expect(genreIcon('Hip-Hop', 'MusicGenre')).toBe('music.mic');
    expect(genreIcon('R&B', 'MusicGenre')).toBe('music.mic');
    expect(genreIcon('Electronic', 'MusicGenre')).toBe('music.note');
  });
  it('is the genre art glyph', () => {
    expect(generatedArt('Horror', 'Genre').icon).toBe('moon.fill');
  });
});

describe('initials', () => {
  const { initials } = jest.requireActual<typeof import('../generated-art')>('../generated-art');
  it('takes the first letter of the first two words', () => {
    expect(initials('Jane Doe')).toBe('JD');
    expect(initials('jane')).toBe('J');
    expect(initials('www.example.net - www.sample.com')).toBe('WW');
    expect(initials('')).toBe('');
  });
});

describe('imageCacheKey', () => {
  const lan = { baseUrl: 'http://192.0.2.10:8096', token: 'abc', serverId: 'srv' };
  const wan = { baseUrl: 'https://jf.example.com/base', token: 'abc', serverId: 'srv' };
  const req = { itemId: 'item1', type: 'Primary' as const, tag: 't1', width: 200 };

  it('is the same for both addresses of a server', () => {
    const a = imageCacheKey(buildImageUrl(lan, req), lan);
    const b = imageCacheKey(buildImageUrl(wan, req), wan);
    expect(a).toBe(b);
    expect(a).toBe('srv:/Items/item1/Images/Primary?tag=t1&fillWidth=200&quality=90');
  });
  it('leaves out the token', () => {
    const other = { ...lan, token: 'another-token' };
    expect(imageCacheKey(buildImageUrl(other, req), other)).toBe(imageCacheKey(buildImageUrl(lan, req), lan));
    expect(imageCacheKey(buildImageUrl(lan, req), lan)).not.toContain('abc');
  });
  it('differs between servers', () => {
    const b = { ...lan, serverId: 'srv2' };
    expect(imageCacheKey(buildImageUrl(b, req), b)).not.toBe(imageCacheKey(buildImageUrl(lan, req), lan));
  });
  it('has no key for local files', () => {
    expect(imageCacheKey('file:///downloads/a/primary.jpg', lan)).toBeUndefined();
    expect(imageSource('file:///x.jpg', lan)).toEqual({ uri: 'file:///x.jpg' });
  });
});
