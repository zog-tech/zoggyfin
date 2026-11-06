import { channelsByGuideId, programmePlayList, type ProgrammeHit, searchProgrammes, type ProgrammeSource } from '../programme-search';
import { foldText } from '../search';
import type { SlicedProgramme } from '../programme-index';
import type { Channel } from '../types';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 4, 20, 30);

function prog(guideId: string, title: string, start: number, stop: number): SlicedProgramme {
  return { guideId, start, stop, title, folded: ` ${foldText(title)} ` };
}
function ch(id: string, name: string, epgId?: string): Channel {
  return { id, name, group: '', epgId };
}
function source(providerId: string, programmes: SlicedProgramme[], channels: Channel[], names: Map<string, string> | null = null): ProgrammeSource {
  return { providerId, programmes, channelsByGuideId: channelsByGuideId(channels, names) };
}

const MATCH = 'UEFA Champions League: Arsenal v Slavia Praha';
const START = NOW - 30 * MIN;
const STOP = NOW + 105 * MIN;

describe('searchProgrammes', () => {
  it('finds a match on now across two providers in provider order', () => {
    const a = source('A', [prog('x.uk', MATCH, START, STOP)], [ch('1', 'Sport A', 'x.uk')]);
    const b = source('B', [prog('x.uk', MATCH, START, STOP)], [ch('2', 'Sport B', 'x.uk')]);
    const hits = searchProgrammes([a, b], 'arsenal', NOW);
    expect(hits.map((h) => h.providerId)).toEqual(['A', 'B']);
    expect(hits.every((h) => h.onNow)).toBe(true);
    expect(hits[0].key).toBe(`A:x.uk:${START}`);
  });

  it('groups streams that share a guide id', () => {
    const channels = ['TNT Sports 1 HD', 'TNT Sports 1 FHD', 'TNT Sports 1 Backup'].map((n, i) => ch(String(i), n, 'tnt1.uk'));
    const s = source('A', [prog('tnt1.uk', MATCH, START, STOP)], channels);
    const hits = searchProgrammes([s], 'arsenal', NOW);
    expect(hits).toHaveLength(1);
    expect(hits[0].channels.map((c) => c.name)).toEqual(['TNT Sports 1 HD', 'TNT Sports 1 FHD', 'TNT Sports 1 Backup']);
  });

  it('links by display name when a channel has no epg id', () => {
    const names = new Map([['sky sports main event', 'ssme.uk']]);
    const s = source('A', [prog('ssme.uk', MATCH, START, STOP)], [ch('1', ' Sky Sports Main Event ')], names);
    expect(searchProgrammes([s], 'arsenal', NOW)).toHaveLength(1);
  });

  it('window', () => {
    const channels = [ch('1', 'One', 'g')];
    const s = (p: SlicedProgramme[]) => source('A', p, channels);
    const soon = searchProgrammes([s([prog('g', 'Match', NOW + 59 * MIN, NOW + 120 * MIN)])], 'match', NOW);
    expect(soon).toHaveLength(1);
    expect(soon[0].onNow).toBe(false);
    expect(searchProgrammes([s([prog('g', 'Match', NOW + 61 * MIN, NOW + 120 * MIN)])], 'match', NOW)).toEqual([]);
    expect(searchProgrammes([s([prog('g', 'Match', NOW - 90 * MIN, NOW - MIN)])], 'match', NOW)).toEqual([]);
    const order = searchProgrammes(
      [s([prog('g', 'Match later', NOW + 10 * MIN, NOW + 60 * MIN), prog('g', 'Match live', NOW - 10 * MIN, NOW + 5 * MIN)])],
      'match',
      NOW,
    );
    expect(order.map((h) => h.title)).toEqual(['Match live', 'Match later']);
  });

  it('every word must match, accents and case folded', () => {
    const s = source(
      'A',
      [prog('g', MATCH, START, STOP), prog('g', 'Atlético Madrid v Porto', START, STOP)],
      [ch('1', 'One', 'g')],
    );
    expect(searchProgrammes([s], 'slavia ARSENAL', NOW)).toHaveLength(1);
    expect(searchProgrammes([s], 'arsenal chelsea', NOW)).toEqual([]);
    expect(searchProgrammes([s], 'atletico', NOW).map((h) => h.title)).toEqual(['Atlético Madrid v Porto']);
  });

  it('short or empty query', () => {
    const s = source('A', [prog('g', 'A Show', START, STOP)], [ch('1', 'One', 'g')]);
    expect(searchProgrammes([s], 'a', NOW)).toEqual([]);
    expect(searchProgrammes([s], '  ', NOW)).toEqual([]);
  });

  it('drops programmes whose guide id has no channel', () => {
    const s = source('A', [prog('other', MATCH, START, STOP)], [ch('1', 'One', 'g')]);
    expect(searchProgrammes([s], 'arsenal', NOW)).toEqual([]);
  });

  it('stops at the limit', () => {
    const p = Array.from({ length: 10 }, (_, i) => prog('g', `Match ${i}`, START + i, STOP));
    const s = source('A', p, [ch('1', 'One', 'g')]);
    expect(searchProgrammes([s], 'match', NOW, 3)).toHaveLength(3);
  });

  it('searches 5 x 20 000 programmes in under 50 ms', () => {
    const channels = [ch('1', 'One', 'g')];
    const sources = Array.from({ length: 5 }, (_, k) =>
      source(
        `P${k}`,
        Array.from({ length: 20_000 }, (_, i) => prog('g', i % 1000 === 0 ? `Arsenal ${i}` : `Show number ${i}`, START + i, STOP)),
        channels,
      ),
    );
    const t = performance.now();
    const hits = searchProgrammes(sources, 'arsenal', NOW);
    expect(performance.now() - t).toBeLessThan(50);
    expect(hits.length).toBe(50);
  });
});

describe('programmePlayList', () => {
  const hit = (providerId: string, channels: Channel[], start: number): ProgrammeHit => ({
    key: `${providerId}:g:${start}`,
    providerId,
    title: 'Match',
    start,
    stop: start + 60 * MIN,
    onNow: true,
    channels,
  });

  it('takes the first stream of each hit, in hit order, each channel once', () => {
    const a = ch('1', 'Sport 1 HD');
    const a2 = ch('2', 'Sport 1 FHD');
    const b = ch('3', 'Sport 2');
    const list = programmePlayList([hit('p1', [a, a2], NOW), hit('p2', [b], NOW), hit('p1', [a], NOW + 30 * MIN), hit('p2', [], NOW)]);
    expect(list.map((x) => x.key)).toEqual(['p1|1', 'p2|3']);
    expect(list[0].channel).toBe(a);
  });

  it('keeps the same channel id of two providers apart', () => {
    const list = programmePlayList([hit('p1', [ch('1', 'A')], NOW), hit('p2', [ch('1', 'A')], NOW)]);
    expect(list.map((x) => x.key)).toEqual(['p1|1', 'p2|1']);
  });
});
