import { INDEX_BACK_MS, INDEX_KEEP_MS, MIN_REBUILD_GAP_MS, ProgrammeIndexBuilder, migrateProgrammeIndex, needsIndexRefresh, sliceIndex } from '../programme-index';
import { XmltvWindowParser, parseXmltv } from '../xmltv';
import { bigXmltv, inChunks, xmltvTime } from '../test-utils/fixtures';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

describe('programme index', () => {
  it('collect sees every programme in its window, not capped by maxPerChannel', async () => {
    const builder = new ProgrammeIndexBuilder('p1', T0 - INDEX_BACK_MS, T0 + INDEX_KEEP_MS);
    const { guide } = await parseXmltv(inChunks(bigXmltv(3, 72, T0 - 6 * HOUR), 1000), { from: T0, to: T0 + 4 * HOUR, maxPerChannel: 3, collect: builder });
    const index = builder.build(T0);
    expect(index.channels['ch1.example'].length / 3).toBe(49);
    expect(guide.channels['ch1.example'].length).toBe(3);
  });

  it('collect respects keep, including name-matched channels', () => {
    const xml = [
      '<tv>',
      '<channel id="x1"><display-name>Sky Sports Main Event</display-name></channel>',
      `<programme start="${xmltvTime(T0)}" stop="${xmltvTime(T0 + HOUR)}" channel="x1"><title>A</title></programme>`,
      `<programme start="${xmltvTime(T0)}" stop="${xmltvTime(T0 + HOUR)}" channel="x2"><title>B</title></programme>`,
      '</tv>',
    ].join('\n');
    const builder = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    const p = new XmltvWindowParser({ from: T0, to: T0 + HOUR, keep: new Set(), matchNames: new Set(['sky sports main event']), collect: builder });
    p.push(xml);
    p.end();
    expect(Object.keys(builder.build(T0).channels)).toEqual(['x1']);
  });

  it('titles are stored once', () => {
    const b = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    for (const ch of ['a', 'b']) for (let i = 0; i < 10; i++) b.add(ch, T0 + i * HOUR, T0 + (i + 1) * HOUR, 'Live Football');
    expect(b.build(T0).titles).toEqual(['Live Football']);
  });

  it('drops duplicate starts and sets to from the latest stop', () => {
    const b = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    expect(b.build(T0).to).toBe(T0);
    b.add('a', T0 + HOUR, T0 + 2 * HOUR, 'B');
    b.add('a', T0, T0 + HOUR, 'A');
    b.add('a', T0, T0 + HOUR, 'A2');
    const i = b.build(T0);
    expect(i.channels.a).toEqual([0, 60, 1, 60, 120, 0]);
    expect(i.to).toBe(T0 + 2 * HOUR);
  });

  it('slice keeps a programme that started before the slice and is still on', () => {
    const start = Date.UTC(2026, 10, 4, 22, 30);
    const stop = Date.UTC(2026, 10, 5, 0, 45);
    const b = new ProgrammeIndexBuilder('p1', Date.UTC(2026, 10, 4, 22, 0), Date.UTC(2026, 10, 6));
    b.add('c', start, stop, 'LIVE: Arsenal v Slavia Praha');
    const out = sliceIndex(b.build(T0), Date.UTC(2026, 10, 4, 23, 59), Date.UTC(2026, 10, 5, 2));
    expect(out).toEqual([{ guideId: 'c', start, stop, title: 'LIVE: Arsenal v Slavia Praha', folded: ' live arsenal v slavia praha ' }]);
    expect(sliceIndex(b.build(T0), stop, stop + HOUR)).toEqual([]);
  });

  it('migrateProgrammeIndex', () => {
    const b = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    b.add('a', T0, T0 + HOUR, 'X');
    const index = b.build(T0);
    expect(migrateProgrammeIndex(JSON.parse(JSON.stringify(index)))).toEqual(index);
    for (const bad of [null, undefined, {}, { schemaVersion: 99 }, 'text', 5, { ...index, channels: { a: [1, 2] } }, { ...index, titles: 'x' }]) {
      expect(migrateProgrammeIndex(bad)).toBeNull();
    }
  });

  it('needsIndexRefresh', () => {
    const now = T0;
    expect(needsIndexRefresh(null, now)).toBe(true);
    expect(needsIndexRefresh({ builtAt: now - HOUR, to: now + 30 * HOUR, failedAt: null }, now)).toBe(false);
    expect(needsIndexRefresh({ builtAt: now - 21 * HOUR, to: now + 23 * HOUR, failedAt: null }, now)).toBe(true);
    expect(needsIndexRefresh({ builtAt: null, to: null, failedAt: now - 11 * HOUR }, now)).toBe(false);
    expect(needsIndexRefresh({ builtAt: null, to: null, failedAt: now - 13 * HOUR }, now)).toBe(true);
    expect(needsIndexRefresh({ builtAt: now - 48 * HOUR, to: now + 30 * HOUR, failedAt: now - HOUR }, now)).toBe(false);
  });

  it('a short guide is not rebuilt until 20 hours after a good build', () => {
    expect(MIN_REBUILD_GAP_MS).toBe(20 * HOUR);
    // The guide ends 20 hours ahead: less than the 24 hours wanted.
    const ledger = { builtAt: T0, to: T0 + 20 * HOUR, failedAt: null };
    expect(needsIndexRefresh(ledger, T0 + HOUR)).toBe(false);
    expect(needsIndexRefresh(ledger, T0 + 12 * HOUR)).toBe(false);
    expect(needsIndexRefresh(ledger, T0 + 20 * HOUR)).toBe(true);
  });

  it('a time in the future (the clock moved back) counts as expired', () => {
    // A failure "in the future" does not block the next try.
    expect(needsIndexRefresh({ builtAt: null, to: null, failedAt: T0 + 5 * HOUR }, T0)).toBe(true);
    // A build "in the future" does not count as fresh.
    expect(needsIndexRefresh({ builtAt: T0 + 5 * HOUR, to: T0 + 50 * HOUR, failedAt: null }, T0)).toBe(true);
  });

  it('collect skips a programme with no title; the guide window keeps it as "No title"', () => {
    const xml = [
      '<tv>',
      `<programme start="${xmltvTime(T0)}" stop="${xmltvTime(T0 + HOUR)}" channel="x1"></programme>`,
      `<programme start="${xmltvTime(T0 + HOUR)}" stop="${xmltvTime(T0 + 2 * HOUR)}" channel="x1"><title></title></programme>`,
      `<programme start="${xmltvTime(T0 + 2 * HOUR)}" stop="${xmltvTime(T0 + 3 * HOUR)}" channel="x1"><title>Real</title></programme>`,
      '</tv>',
    ].join('\n');
    const builder = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    const p = new XmltvWindowParser({ from: T0, to: T0 + 4 * HOUR, collect: builder });
    p.push(xml);
    const guide = p.end();
    const index = builder.build(T0);
    expect(index.titles).toEqual(['Real']);
    expect(index.channels.x1).toHaveLength(3);
    expect(guide.channels.x1.map((x) => x.title)).toEqual(['No title', 'No title', 'Real']);
  });

  it('builds 2000 channels x 48 programmes and slices in under 500 ms', () => {
    const t = Date.now();
    const b = new ProgrammeIndexBuilder('p1', T0, T0 + INDEX_KEEP_MS);
    for (let c = 0; c < 2000; c++) for (let h = 0; h < 48; h++) b.add(`ch${c}`, T0 + h * HOUR, T0 + (h + 1) * HOUR, `Show ${h}`);
    const out = sliceIndex(b.build(T0), T0 + 5 * HOUR, T0 + 7 * HOUR);
    expect(out.length).toBe(2000 * 2);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
