import type { BaseItemDto } from '@/api/types';
import { registerBuiltinItemActions } from '@/features/actions/builtin';

import { actionSections, actionsFor, type AppActionApi, type ItemAction, itemActions } from '../item-actions';

const noop = () => undefined;
const app: AppActionApi = {
  play: noop,
  openItem: noop,
  setFavorite: async () => undefined,
  setPlayed: async () => undefined,
  playNext: noop,
  addToQueue: noop,
  instantMix: noop,
  addToPlaylist: noop,
  playOn: noop,
  deleteItem: noop,
  downloadStatus: () => ({ state: 'none' }),
  download: noop,
  removeDownload: noop,
};

const song: BaseItemDto = {
  Id: 's1',
  Type: 'Audio',
  MediaType: 'Audio',
  Name: 'Song',
  AlbumId: 'al1',
  Album: 'Album',
  AlbumArtists: [{ Id: 'ar1', Name: 'Artist' }],
  CanDelete: true,
  UserData: { IsFavorite: false, Key: 's1' },
};

const a = (id: string, extra: Partial<ItemAction> = {}): ItemAction => ({ id, title: id, icon: 'circle', run: noop, ...extra });

describe('actionSections', () => {
  it('groups in section order, keeps the order inside a section and puts destructive last', () => {
    const list = [
      a('play', { group: 'play' }),
      a('fav', { group: 'library' }),
      a('ext'),
      a('del', { group: 'more', destructive: true }),
      a('album', { group: 'goTo' }),
      a('next', { group: 'play' }),
    ];
    expect(actionSections(list).map((s) => [s.key, s.actions.map((x) => x.id)])).toEqual([
      ['play', ['play', 'next']],
      ['library', ['fav']],
      ['goTo', ['album']],
      ['more', ['ext']],
      ['destructive', ['del']],
    ]);
  });

  it('leaves out empty sections and puts an unknown group under more', () => {
    expect(actionSections([a('odd', { group: 'nope' as never })]).map((s) => s.key)).toEqual(['more']);
    expect(actionSections([])).toEqual([]);
  });
});

describe('built-in actions for a song', () => {
  beforeAll(() => registerBuiltinItemActions());
  const sections = (here?: string, appApi: AppActionApi = app) =>
    actionSections(actionsFor({ item: song, app: appApi, platform: 'ios', here }, itemActions)).map((s) => [s.key, s.actions.map((x) => x.id)]);

  it('shows short groups: play, library, go to, more, destructive', () => {
    expect(sections()).toEqual([
      ['play', ['builtin.play', 'builtin.playNext', 'builtin.addToQueue']],
      ['library', ['builtin.favorite', 'builtin.addToPlaylist', 'builtin.download']],
      ['goTo', ['builtin.goToAlbum', 'builtin.goToArtist']],
      ['more', ['builtin.instantMix', 'builtin.playOn']],
      ['destructive', ['builtin.deleteItem']],
    ]);
  });

  it('puts "Remove download" with the destructive actions', () => {
    const done: AppActionApi = { ...app, downloadStatus: () => ({ state: 'completed' }) };
    const out = sections(undefined, done);
    expect(out.find(([k]) => k === 'library')).toEqual(['library', ['builtin.favorite', 'builtin.addToPlaylist']]);
    expect(out.find(([k]) => k === 'destructive')).toEqual(['destructive', ['builtin.removeDownload', 'builtin.deleteItem']]);
  });

  it('hides "Go to album" on the album page and "Go to artist" on the artist page', () => {
    expect(sections('al1').find(([k]) => k === 'goTo')).toEqual(['goTo', ['builtin.goToArtist']]);
    expect(sections('ar1').find(([k]) => k === 'goTo')).toEqual(['goTo', ['builtin.goToAlbum']]);
  });
});
