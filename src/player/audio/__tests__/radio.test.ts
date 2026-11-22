import { appendAutoplay, dropAutoplay, playNow, queueSections, restoreQueue, setShuffle, type QueueDeps } from '../queue';
import { pickRadio, RADIO_HISTORY, radioSeeds, radioWanted, rememberPlayed, type RadioItem } from '../radio';

let n = 0;
const deps: QueueDeps = { makeKey: () => `k${n++}`, random: () => 0.5 };
const song = (id: string, extra: Partial<RadioItem> = {}): RadioItem => ({ Id: id, Type: 'Audio', MediaType: 'Audio', ...extra });
const on = { enabled: true, longForm: false, together: false };

describe('radioWanted', () => {
  const q = (count: number, index: number) => playNow(Array.from({ length: count }, (_, i) => song(`s${i}`)), index, {}, deps);

  it('asks when 2 songs or fewer are left', () => {
    expect(radioWanted(q(10, 6), on)).toBe(false);
    expect(radioWanted(q(10, 7), on)).toBe(true);
    expect(radioWanted(q(1, 0), on)).toBe(true);
  });

  it('never asks when off, for long-form items, in a together session or with Repeat', () => {
    expect(radioWanted(q(3, 2), { ...on, enabled: false })).toBe(false);
    expect(radioWanted(q(3, 2), { ...on, longForm: true })).toBe(false);
    expect(radioWanted(q(3, 2), { ...on, together: true })).toBe(false);
    expect(radioWanted({ ...q(3, 2), repeat: 'all' }, on)).toBe(false);
    expect(radioWanted({ ...q(3, 2), repeat: 'one' }, on)).toBe(false);
  });

  it('never asks for an empty queue', () => {
    expect(radioWanted(playNow([], 0, {}, deps), on)).toBe(false);
  });
});

describe('radioSeeds', () => {
  it('tries the last song, the current song, then the artist of the last song', () => {
    const q = playNow([song('a'), song('b', { AlbumArtists: [{ Id: 'art1', Name: 'Jane' }] })], 0, {}, deps);
    expect(radioSeeds(q, () => true).map((s) => [s.Id, s.Type])).toEqual([
      ['b', 'Audio'],
      ['a', 'Audio'],
      ['art1', 'MusicArtist'],
    ]);
  });

  it('skips songs the server cannot mix from and repeats no seed', () => {
    const q = playNow([song('a'), song('cat')], 0, {}, deps);
    expect(radioSeeds(q, (i) => i.Id !== 'cat').map((s) => s.Id)).toEqual(['a']);
  });
});

describe('pickRadio', () => {
  it('drops songs in the queue, recent songs, duplicates and non-songs, up to the limit', () => {
    const q = playNow([song('a'), song('b')], 1, {}, deps);
    const mix = [song('b'), song('c'), song('c'), song('d'), { Id: 'v', Type: 'Video', MediaType: 'Video' }, song('e'), song('f')];
    expect(pickRadio(mix, q, ['d']).map((s) => s.Id)).toEqual(['c', 'e', 'f']);
    expect(pickRadio(mix, q, [], 2).map((s) => s.Id)).toEqual(['c', 'd']);
  });
});

describe('rememberPlayed', () => {
  it('puts the song first once and keeps the list short', () => {
    expect(rememberPlayed(['a', 'b'], 'b')).toEqual(['b', 'a']);
    const long = Array.from({ length: RADIO_HISTORY }, (_, i) => `x${i}`);
    expect(rememberPlayed(long, 'new')).toHaveLength(RADIO_HISTORY);
  });
});

describe('autoplay entries in the queue', () => {
  it('go after the context, in their own section', () => {
    const q = appendAutoplay(playNow([song('a'), song('b')], 0, {}, deps), [song('c'), song('d')], deps);
    const s = queueSections(q);
    expect(s.rest.map((r) => r.entry.item.Id)).toEqual(['b']);
    expect(s.autoplay.map((r) => r.entry.item.Id)).toEqual(['c', 'd']);
    expect(s.autoplay[0]?.index).toBe(2);
  });

  it('stay when shuffle goes on and off', () => {
    const q = appendAutoplay(playNow([song('a'), song('b')], 0, {}, deps), [song('c')], deps);
    const back = setShuffle(setShuffle(q, true, deps), false, deps);
    expect(back.entries.map((e) => e.item.Id).sort()).toEqual(['a', 'b', 'c']);
    expect(back.entries.find((e) => e.item.Id === 'c')?.autoplay).toBe(true);
  });

  it('keep their mark after a restart', () => {
    const q = appendAutoplay(playNow([song('a')], 0, {}, deps), [song('c')], deps);
    const restored = restoreQueue(JSON.parse(JSON.stringify(q)), (v): v is RadioItem => !!v && typeof v === 'object');
    expect(restored?.entries.map((e) => e.autoplay ?? false)).toEqual([false, true]);
  });

  it('are not added to an empty queue', () => {
    const empty = playNow<RadioItem>([], 0, {}, deps);
    expect(appendAutoplay(empty, [song('c')], deps)).toBe(empty);
  });
});

describe('dropAutoplay', () => {
  it('removes the waiting autoplay songs and keeps the current one', () => {
    const base = appendAutoplay(playNow([song('a')], 0, {}, deps), [song('c'), song('d')], deps);
    const playingC = { ...base, index: 1 };
    const out = dropAutoplay(playingC);
    expect(out.entries.map((e) => e.item.Id)).toEqual(['a', 'c']);
    expect(out.original).toHaveLength(2);
    const plain = playNow([song('a')], 0, {}, deps);
    expect(dropAutoplay(plain)).toBe(plain);
  });
});
