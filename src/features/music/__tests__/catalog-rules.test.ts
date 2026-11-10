import type { BaseItemDto } from '@/api/types';

import { catalogShape, catalogSongs, catalogSubtitle } from '../catalog-rules';

const item = (Type: string, extra: Partial<BaseItemDto> = {}): BaseItemDto => ({ Id: `${Type}-${Math.random()}`, Name: 'x', Type, ...extra }) as BaseItemDto;

describe('catalogShape', () => {
  it('follows a known row type', () => {
    expect(catalogShape({ itemType: 'MusicArtist', items: [item('MusicAlbum')] })).toBe('circle');
    expect(catalogShape({ itemType: 'Audio', items: [item('Audio')] })).toBe('square');
    expect(catalogShape({ itemType: 'Playlist', items: [item('Playlist')] })).toBe('square');
  });
  it('takes the shape most items want for an unknown row type', () => {
    expect(catalogShape({ itemType: 'Podcast', items: [item('MusicArtist'), item('MusicArtist'), item('MusicAlbum')] })).toBe('circle');
    expect(catalogShape({ itemType: undefined, items: [item('MusicAlbum'), item('MusicArtist')] })).toBe('square');
  });
  it('uses wide tiles for items with wide images', () => {
    const wide = [item('MusicVideo2', { PrimaryImageAspectRatio: 1.78 }), item('MusicVideo2', { PrimaryImageAspectRatio: 1.78 })];
    expect(catalogShape({ itemType: 'Video clips', items: wide })).toBe('thumb');
  });
});

describe('catalogSubtitle', () => {
  it('names the artist of a song and the artist and year of an album', () => {
    expect(catalogSubtitle(item('Audio', { Artists: ['Jane Doe'], Album: 'A' }))).toBe('Jane Doe');
    expect(catalogSubtitle(item('Audio', { Album: 'A' }))).toBe('A');
    expect(catalogSubtitle(item('MusicAlbum', { AlbumArtist: 'Jane Doe', ProductionYear: 2024 }))).toBe('Jane Doe · 2024');
    expect(catalogSubtitle(item('MusicAlbum'))).toBeUndefined();
    expect(catalogSubtitle(item('Playlist'))).toBeUndefined();
  });
});

describe('catalogSongs', () => {
  it('keeps only the songs, in order', () => {
    const a = item('Audio');
    const b = item('MusicAlbum');
    const c = item('Audio');
    expect(catalogSongs([a, b, c])).toEqual([a, c]);
  });
});
