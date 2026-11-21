import { browseEntries, mergedBrowseEntries, mergedDefaultGroup, providerEntryKey } from '../browse';
import { addRecent, EMPTY_LISTS, FAVOURITES_GROUP, RECENTS_GROUP, snapOf, toggleFavourite, withSnaps } from '../lists';
import {
  ALL_PROVIDERS,
  type ChannelLookup,
  mergedFavourites,
  mergedRecents,
  mergeSearchHits,
  moveInOrder,
  providerChannelKey,
  providersMissingSnaps,
  resolveActive,
  splitProviderChannelKey,
  uniqueProviderName,
} from '../merged';
import { migrateLists, migrateProviders } from '../migrate';
import { buildSearchIndex, searchChannelsRanked } from '../search';
import type { Channel, ChannelLists } from '../types';

const ch = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({ id, name, group: 'G', ...extra });

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

/** Lists with favourites and recents, and their snaps (as the manager keeps them). */
function lists(favs: Channel[], recents: { c: Channel; at: number }[] = []): ChannelLists {
  let l = EMPTY_LISTS;
  for (const c of [...favs].reverse()) l = toggleFavourite(l, c.id, snapOf(c));
  for (const r of [...recents].sort((x, y) => x.at - y.at)) l = addRecent(l, r.c.id, r.at, snapOf(r.c));
  return l;
}

const notLoaded: ChannelLookup = () => undefined;

describe('merged keys', () => {
  it('round-trips a provider and a channel id, even when the channel id has a bar', () => {
    const key = providerChannelKey(A, 'x|y');
    expect(splitProviderChannelKey(key)).toEqual({ providerId: A, channelId: 'x|y' });
    expect(splitProviderChannelKey('nobar')).toBeNull();
    expect(splitProviderChannelKey('|x')).toBeNull();
  });
});

describe('merged favourites and recents', () => {
  const a1 = ch('1', 'News', { number: 1, url: 'http://stream.example.com/1.ts' });
  const a2 = ch('2', 'Sport');
  const b1 = ch('1', 'Films');
  const byProvider: Record<string, ChannelLists> = {
    [A]: lists([a1, a2], [{ c: a1, at: 10 }]),
    [B]: lists([b1], [{ c: b1, at: 20 }]),
  };
  const listsOf = (id: string) => byProvider[id] ?? EMPTY_LISTS;

  it('shows favourites from the snaps with no channel list loaded, in the providers order', () => {
    const favs = mergedFavourites([A, B], listsOf, notLoaded);
    expect(favs.map((f) => [f.providerId, f.channel.name])).toEqual([
      [A, 'News'],
      [A, 'Sport'],
      [B, 'Films'],
    ]);
    // Same channel id in two providers: two different keys.
    expect(new Set(favs.map((f) => f.key)).size).toBe(3);
    // The snap keeps no stream URL.
    expect(favs[0].channel.url).toBeUndefined();
    expect(mergedFavourites([B, A], listsOf, notLoaded)[0].providerId).toBe(B);
  });

  it('uses a loaded list when there is one, and leaves out a channel that list no longer has', () => {
    const renamed = { ...a1, name: 'News HD' };
    const lookup: ChannelLookup = (pid, id) => (pid === A ? (id === '1' ? renamed : null) : undefined);
    const favs = mergedFavourites([A, B], listsOf, lookup);
    expect(favs.map((f) => f.channel.name)).toEqual(['News HD', 'Films']);
  });

  it('merges recents newest first and caps them', () => {
    expect(mergedRecents([A, B], listsOf, notLoaded).map((r) => [r.providerId, r.channel.id])).toEqual([
      [B, '1'],
      [A, '1'],
    ]);
    expect(mergedRecents([A, B], listsOf, notLoaded, 1)).toHaveLength(1);
  });

  it('finds the providers whose lists predate the snaps', () => {
    const old = migrateLists({ favourites: ['9'], recents: [] });
    expect(providersMissingSnaps([A, B], (id) => (id === B ? old : listsOf(id)))).toEqual([B]);
  });
});

describe('merged search', () => {
  it('puts the best match step first, then the providers order', () => {
    const ia = buildSearchIndex([ch('1', 'Sport One', { number: 7 }), ch('2', 'One')]);
    const ib = buildSearchIndex([ch('1', 'One News'), ch('2', 'Channel', { number: 1 })]);
    const per = (q: string) => [
      { providerId: A, hits: searchChannelsRanked(ia, q) },
      { providerId: B, hits: searchChannelsRanked(ib, q) },
    ];
    // "One" and "One News" start with the word (step 2); "Sport One" has it later (step 3).
    expect(mergeSearchHits(per('one'), 10).map((h) => [h.providerId, h.channel.name])).toEqual([
      [A, 'One'],
      [B, 'One News'],
      [A, 'Sport One'],
    ]);
    expect(mergeSearchHits(per('one'), 2)).toHaveLength(2);
  });
});

describe('snaps in the lists', () => {
  it('refreshes snaps from a loaded list and returns the same object when nothing changed', () => {
    const c = ch('1', 'News', { logo: 'https://img.example.com/a.png' });
    const l = toggleFavourite(EMPTY_LISTS, '1');
    expect(l.snaps).toEqual({});
    const filled = withSnaps(l, [c, ch('2', 'Other')]);
    expect(filled.snaps).toEqual({ '1': { id: '1', name: 'News', group: 'G', logo: 'https://img.example.com/a.png' } });
    expect(withSnaps(filled, [c])).toBe(filled);
    expect(withSnaps(filled, [{ ...c, name: 'News HD' }]).snaps['1'].name).toBe('News HD');
  });

  it('drops the snap of a channel that is no longer a favourite or recent', () => {
    const c = ch('1', 'News');
    const l = toggleFavourite(EMPTY_LISTS, '1', snapOf(c));
    expect(toggleFavourite(l, '1').snaps).toEqual({});
  });

  it('migrates a v1 list (ids only) and keeps only snap fields from a saved v2 list', () => {
    expect(migrateLists({ schemaVersion: 1, favourites: ['a'], recents: [{ id: 'b', at: 1 }] })).toEqual({
      schemaVersion: 2,
      favourites: ['a'],
      recents: [{ id: 'b', at: 1 }],
      snaps: {},
    });
    const v2 = migrateLists({
      schemaVersion: 2,
      favourites: ['a'],
      recents: [],
      snaps: { a: { name: 'A', group: 'G', url: 'http://secret.example.com/a.ts', number: 3 }, gone: { name: 'X' }, b: 'junk' },
    });
    expect(v2.snaps).toEqual({ a: { id: 'a', name: 'A', group: 'G', number: 3 } });
  });
});

describe('provider list rules', () => {
  it('gives a unique name, whatever the case', () => {
    expect(uniqueProviderName('Playlist', [])).toBe('Playlist');
    expect(uniqueProviderName('Playlist', ['playlist'])).toBe('Playlist 2');
    expect(uniqueProviderName(' Playlist ', ['Playlist', 'Playlist 2'])).toBe('Playlist 3');
  });

  it('moves one place, and returns the same array at the ends', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(order, 'c', 1)).toBe(order);
    expect(moveInOrder(order, 'x', 1)).toBe(order);
  });

  it('opens on the chosen start, else the last one used, else the first provider', () => {
    expect(resolveActive(null, null, [])).toBeNull();
    expect(resolveActive(ALL_PROVIDERS, 'a', ['a', 'b'])).toBe(ALL_PROVIDERS);
    expect(resolveActive(ALL_PROVIDERS, 'a', ['a'])).toBe('a');
    expect(resolveActive('b', 'a', ['a', 'b'])).toBe('b');
    expect(resolveActive(null, ALL_PROVIDERS, ['a', 'b'])).toBe(ALL_PROVIDERS);
    expect(resolveActive('gone', 'gone', ['a', 'b'])).toBe('a');
  });

  it('reads the start choice of a saved snapshot, and drops one of a removed provider', () => {
    const rec = { kind: 'm3u', name: 'L' };
    expect(migrateProviders({ providers: { a: rec, b: rec }, order: ['a', 'b'], startWith: ALL_PROVIDERS }).startWith).toBe(ALL_PROVIDERS);
    expect(migrateProviders({ providers: { a: rec }, order: ['a'], startWith: 'b' }).startWith).toBeNull();
    expect(migrateProviders({ providers: { a: rec }, order: ['a'] }).startWith).toBeNull();
  });
});

describe('browse column with several providers', () => {
  const providers = [
    { providerId: ALL_PROVIDERS, label: 'All providers' },
    { providerId: A, label: 'One' },
    { providerId: B, label: 'Two' },
  ];

  it('lists the providers first, then the lists, sections and groups', () => {
    const groups = [
      { key: FAVOURITES_GROUP, label: 'Favourites', count: 0 },
      { key: RECENTS_GROUP, label: 'Recently watched', count: 0 },
      { key: 'all', label: 'All channels', count: 2 },
      { key: 'g:News', label: 'News', count: 2 },
    ];
    const keys = browseEntries(groups, [{ key: 'films', label: 'Films' }], providers).map((e) => e.key);
    expect(keys).toEqual(['heading:providers', providerEntryKey(ALL_PROVIDERS), providerEntryKey(A), providerEntryKey(B), 'search', 'all', FAVOURITES_GROUP, 'section:films', 'heading:groups', 'g:News', 'providers']);
    // One provider: no provider switch.
    expect(browseEntries(groups, [], providers.slice(0, 1)).some((e) => e.kind === 'provider')).toBe(false);
  });

  it('shows only Search, the merged lists and the providers in "All providers"', () => {
    expect(mergedBrowseEntries(2, 0, providers).map((e) => e.key)).toEqual([
      'heading:providers',
      providerEntryKey(ALL_PROVIDERS),
      providerEntryKey(A),
      providerEntryKey(B),
      'search',
      FAVOURITES_GROUP,
      RECENTS_GROUP,
      'providers',
    ]);
  });

  it('opens on Favourites, or on Recently watched when only that has channels', () => {
    expect(mergedDefaultGroup(1, 1, null)).toBe(FAVOURITES_GROUP);
    expect(mergedDefaultGroup(0, 3, null)).toBe(RECENTS_GROUP);
    expect(mergedDefaultGroup(0, 0, null)).toBe(FAVOURITES_GROUP);
    expect(mergedDefaultGroup(5, 3, RECENTS_GROUP)).toBe(RECENTS_GROUP);
    expect(mergedDefaultGroup(5, 3, 'g:News')).toBe(FAVOURITES_GROUP);
  });
});
