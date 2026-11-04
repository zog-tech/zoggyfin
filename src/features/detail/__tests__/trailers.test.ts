import type { BaseItemDto } from '@/api/types';

import { hasTrailers, remoteTrailers, siteName, trailerChoices, youtubeId } from '../trailers';

const movie = (over: Partial<BaseItemDto> = {}): BaseItemDto => ({ Id: 'm1', Name: 'Jane Doe Story', Type: 'Movie', ...over });

describe('youtubeId', () => {
  it('reads watch, short and embed links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=BgesL8cVgmI')).toBe('BgesL8cVgmI');
    expect(youtubeId('https://youtube.com/watch?feature=x&v=BgesL8cVgmI')).toBe('BgesL8cVgmI');
    expect(youtubeId('https://youtu.be/BgesL8cVgmI')).toBe('BgesL8cVgmI');
    expect(youtubeId('https://www.youtube.com/embed/BgesL8cVgmI')).toBe('BgesL8cVgmI');
  });

  it('gives null for other sites', () => {
    expect(youtubeId('https://vimeo.com/123456')).toBeNull();
    expect(youtubeId('not a link')).toBeNull();
  });
});

describe('siteName', () => {
  it('names known sites and falls back to the host', () => {
    expect(siteName('https://www.youtube.com/watch?v=abcdef')).toBe('YouTube');
    expect(siteName('https://youtu.be/abcdef')).toBe('YouTube');
    expect(siteName('https://vimeo.com/1')).toBe('Vimeo');
    expect(siteName('https://www.example.org/t.mp4')).toBe('example.org');
  });
});

describe('remoteTrailers', () => {
  it('drops empty, non-http and duplicate links', () => {
    const item = movie({
      RemoteTrailers: [
        { Url: 'https://www.youtube.com/watch?v=aaaaaaa' },
        { Url: 'https://youtu.be/aaaaaaa' },
        { Url: '' },
        { Url: 'javascript:alert(1)' },
        { Url: 'https://vimeo.com/1', Name: 'Teaser' },
      ],
    });
    expect(remoteTrailers(item).map((t) => t.kind === 'remote' && t.url)).toEqual(['https://www.youtube.com/watch?v=aaaaaaa', 'https://vimeo.com/1']);
  });
});

describe('hasTrailers', () => {
  it('is true with a local trailer or a link', () => {
    expect(hasTrailers(movie())).toBe(false);
    expect(hasTrailers(movie({ LocalTrailerCount: 1 }))).toBe(true);
    expect(hasTrailers(movie({ RemoteTrailers: [{ Url: 'https://youtu.be/aaaaaaa' }] }))).toBe(true);
    expect(hasTrailers(movie({ RemoteTrailers: [{ Url: 'ftp://x' }] }))).toBe(false);
  });
});

describe('trailerChoices', () => {
  it('names one trailer "Trailer"', () => {
    const c = trailerChoices(movie({ RemoteTrailers: [{ Url: 'https://youtu.be/aaaaaaa' }] }), []);
    expect(c.map((t) => t.label)).toEqual(['Trailer · YouTube']);
  });

  it('puts files on the server first and numbers unnamed trailers', () => {
    const local: BaseItemDto[] = [{ Id: 't1', Name: '' }, { Name: 'No Id' }];
    const c = trailerChoices(
      movie({ RemoteTrailers: [{ Url: 'https://youtu.be/aaaaaaa' }, { Url: 'https://vimeo.com/1', Name: 'Teaser' }] }),
      local,
    );
    expect(c.map((t) => [t.kind, t.label])).toEqual([
      ['local', 'Trailer 1'],
      ['remote', 'Trailer 2 · YouTube'],
      ['remote', 'Teaser · Vimeo'],
    ]);
  });

  it('works before the local list loads', () => {
    expect(trailerChoices(movie({ LocalTrailerCount: 1 }), undefined)).toEqual([]);
  });
});
