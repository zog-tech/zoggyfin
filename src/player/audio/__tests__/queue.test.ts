import {
  addToQueue,
  advance,
  back,
  clearUpcoming,
  currentEntry,
  jumpTo,
  moveEntry,
  nextRepeat,
  playNext,
  playNow,
  type QueueDeps,
  queueSections,
  type QueueState,
  removeEntry,
  replaceItem,
  restoreQueue,
  setShuffle,
  shuffled,
  upcomingEntry,
} from '../queue';

type T = { Id: string };
const items = (...ids: string[]): T[] => ids.map((Id) => ({ Id }));

/** Deterministic keys and a seeded random (mulberry32). */
function deps(seed = 1): QueueDeps {
  let n = 0;
  let a = seed;
  return {
    makeKey: () => `k${n++}`,
    random: () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

const ids = (q: QueueState<T>) => q.entries.map((e) => e.item.Id);
const cur = (q: QueueState<T> | null) => (q ? currentEntry(q)?.item.Id : null);

describe('playNow', () => {
  it('starts at the chosen item in album order', () => {
    const q = playNow(items('a', 'b', 'c'), 1, {}, deps());
    expect(ids(q)).toEqual(['a', 'b', 'c']);
    expect(cur(q)).toBe('b');
    expect(upcomingEntry(q)?.item.Id).toBe('c');
  });

  it('with shuffle plays the chosen item first and shuffles the rest', () => {
    const q = playNow(items('a', 'b', 'c', 'd', 'e'), 2, { shuffle: true }, deps(7));
    expect(q.index).toBe(0);
    expect(cur(q)).toBe('c');
    expect([...ids(q)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(q.original.length).toBe(5);
  });

  it('gives an empty queue for no items', () => {
    expect(playNow([], 0, {}, deps()).index).toBe(-1);
  });
});

describe('shuffled', () => {
  it('keeps every element', () => {
    const out = shuffled([1, 2, 3, 4, 5, 6, 7, 8], deps(3).random);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('play next and add to queue', () => {
  it('play next goes right after the current entry; add to queue goes after the Up next block', () => {
    const d = deps();
    let q = playNow(items('a', 'b', 'c'), 0, {}, d);
    q = addToQueue(q, items('x'), d);
    q = playNext(q, items('y'), d);
    q = addToQueue(q, items('z'), d);
    expect(ids(q)).toEqual(['a', 'y', 'x', 'z', 'b', 'c']);
    const s = queueSections(q);
    expect(s.upNext.map((r) => r.entry.item.Id)).toEqual(['y', 'x', 'z']);
    expect(s.rest.map((r) => r.entry.item.Id)).toEqual(['b', 'c']);
  });

  it('on an empty queue they start one', () => {
    const q = addToQueue<T>({ entries: [], index: -1, original: [], shuffle: false, repeat: 'all', source: null }, items('a'), deps());
    expect(cur(q)).toBe('a');
    expect(q.repeat).toBe('all');
  });

  it('the same song can be queued twice with its own key', () => {
    const d = deps();
    let q = playNow(items('a'), 0, {}, d);
    q = addToQueue(q, items('a'), d);
    expect(new Set(q.entries.map((e) => e.key)).size).toBe(2);
  });
});

describe('move, remove, clear, jump', () => {
  const base = () => playNow(items('a', 'b', 'c', 'd'), 1, {}, deps());

  it('moves an upcoming entry and never touches the played part', () => {
    expect(ids(moveEntry(base(), 3, 2))).toEqual(['a', 'b', 'd', 'c']);
    // Targets before the current entry are clamped to just after it.
    expect(ids(moveEntry(base(), 3, 0))).toEqual(['a', 'b', 'd', 'c']);
    // The current entry and played entries cannot move.
    expect(ids(moveEntry(base(), 1, 3))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveEntry(base(), 0, 3))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes an upcoming or played entry but not the current one', () => {
    const q = base();
    const c = q.entries[2]?.key ?? '';
    expect(ids(removeEntry(q, c))).toEqual(['a', 'b', 'd']);
    const a = removeEntry(q, q.entries[0]?.key ?? '');
    expect(ids(a)).toEqual(['b', 'c', 'd']);
    expect(cur(a)).toBe('b');
    expect(removeEntry(q, q.entries[1]?.key ?? '')).toBe(q);
  });

  it('puts another item in an entry, which keeps its key and place', () => {
    const q = base();
    const cur0 = currentEntry(q);
    const r = replaceItem(q, cur0?.key ?? '', { Id: 'real-b' });
    expect(ids(r)).toEqual(['a', 'real-b', 'c', 'd']);
    expect(currentEntry(r)?.key).toBe(cur0?.key);
    expect(r.index).toBe(q.index);
    expect(r.original).toBe(q.original);
    expect(ids(q)).toEqual(['a', 'b', 'c', 'd']);
    expect(replaceItem(q, 'missing', { Id: 'x' })).toBe(q);
  });

  it('clear keeps the played part and the current entry', () => {
    const q = clearUpcoming(base());
    expect(ids(q)).toEqual(['a', 'b']);
    expect(upcomingEntry(q)).toBeNull();
  });

  it('jumps to an entry', () => {
    const q = base();
    expect(cur(jumpTo(q, q.entries[3]?.key ?? ''))).toBe('d');
    expect(jumpTo(q, 'nope')).toBe(q);
  });
});

describe('repeat', () => {
  it('off: stops at the end', () => {
    const q = playNow(items('a', 'b'), 1, {}, deps());
    expect(upcomingEntry(q)).toBeNull();
    expect(advance(q)).toBeNull();
    expect(advance(q, true)).toBeNull();
  });

  it('all: wraps around both ways', () => {
    const q = playNow(items('a', 'b'), 1, { repeat: 'all' }, deps());
    expect(upcomingEntry(q)?.item.Id).toBe('a');
    expect(cur(advance(q))).toBe('a');
    expect(cur(back({ ...q, index: 0 }))).toBe('b');
  });

  it('one: replays the current entry when it ends, but Next moves on', () => {
    const q = playNow(items('a', 'b'), 0, { repeat: 'one' }, deps());
    expect(upcomingEntry(q)?.item.Id).toBe('a');
    expect(cur(advance(q))).toBe('a');
    expect(cur(advance(q, true))).toBe('b');
    expect(cur(advance({ ...q, index: 1 }, true))).toBe('a');
  });

  it('cycles off → all → one → off', () => {
    expect(nextRepeat('off')).toBe('all');
    expect(nextRepeat('all')).toBe('one');
    expect(nextRepeat('one')).toBe('off');
  });

  it('back stops at the start without repeat', () => {
    expect(back(playNow(items('a', 'b'), 0, {}, deps()))).toBeNull();
  });
});

describe('shuffle on and off', () => {
  it('shuffles only what comes after the Up next block', () => {
    const d = deps(11);
    let q = playNow(items('a', 'b', 'c', 'd', 'e', 'f'), 0, {}, d);
    q = playNext(q, items('x'), d);
    const on = setShuffle(q, true, d);
    expect(on.shuffle).toBe(true);
    expect(ids(on).slice(0, 2)).toEqual(['a', 'x']);
    expect([...ids(on).slice(2)].sort()).toEqual(['b', 'c', 'd', 'e', 'f']);
  });

  it('off restores album order around the current song', () => {
    const d = deps(5);
    let q = playNow(items('a', 'b', 'c', 'd', 'e'), 0, { shuffle: true }, d);
    q = advance(q) as QueueState<T>;
    const playing = cur(q);
    const off = setShuffle(q, false, d);
    expect(off.shuffle).toBe(false);
    expect(ids(off)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(cur(off)).toBe(playing);
  });

  it('off keeps Up next right after the current song', () => {
    const d = deps(9);
    let q = playNow(items('a', 'b', 'c', 'd'), 2, { shuffle: true }, d);
    q = playNext(q, items('x'), d);
    const off = setShuffle(q, false, d);
    expect(ids(off)).toEqual(['a', 'b', 'c', 'x', 'd']);
    expect(cur(off)).toBe('c');
  });

  it('off with a user entry playing keeps history and sorts the rest', () => {
    const d = deps(2);
    let q = playNow(items('a', 'b', 'c', 'd'), 0, { shuffle: true }, d);
    q = playNext(q, items('x'), d);
    q = advance(q) as QueueState<T>;
    expect(cur(q)).toBe('x');
    const off = setShuffle(q, false, d);
    expect(cur(off)).toBe('x');
    const rest = ids(off).slice(off.index + 1);
    expect(rest).toEqual([...rest].sort());
  });
});

describe('restoreQueue', () => {
  const isT = (v: unknown): v is T => !!v && typeof (v as T).Id === 'string';

  it('round-trips through JSON', () => {
    const d = deps();
    const q = addToQueue(playNow(items('a', 'b'), 1, { shuffle: false, repeat: 'all', source: { name: 'Album', id: '1', type: 'MusicAlbum' } }, d), items('x'), d);
    const back = restoreQueue(JSON.parse(JSON.stringify(q)), isT);
    expect(back).toEqual(q);
  });

  it('rejects malformed data and clamps the index', () => {
    expect(restoreQueue(null, isT)).toBeNull();
    expect(restoreQueue({ entries: 'x', index: 0 }, isT)).toBeNull();
    expect(restoreQueue({ entries: [{ key: 'k', item: { nope: 1 } }], index: 0 }, isT)).toBeNull();
    expect(restoreQueue({ entries: [], index: 0 }, isT)).toBeNull();
    const r = restoreQueue({ entries: [{ key: 'k', item: { Id: 'a' } }], index: 9, repeat: 'bogus', original: ['k', 'gone'] }, isT);
    expect(r?.index).toBe(0);
    expect(r?.repeat).toBe('off');
    expect(r?.original).toEqual(['k']);
  });
});
