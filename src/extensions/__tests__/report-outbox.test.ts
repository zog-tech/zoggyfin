/**
 * The extension report outbox: bounded per account, 30 days at most, sent
 * oldest first, and an extension that does not answer keeps its reports in
 * order while the others send.
 */
import { addReport, createReportOutbox, EMPTY_OUTBOX, MAX_AGE_MS, MAX_PER_ACCOUNT, OUTBOX_VERSION, readOutbox, replay, type ReportEntry, type ReportOutbox } from '../media/outbox';
import { buildReport } from '../media/report';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function entry(extId: string, mediaId: string, at: number, event: 'stop' | 'finished' = 'stop'): ReportEntry {
  return { extId, url: `https://${extId}.example.org/api/progress`, at, body: buildReport({ event, mediaId, position: 10, offline: true }) };
}

describe('readOutbox', () => {
  it('reads nothing or a damaged value as empty, and drops bad entries', () => {
    expect(readOutbox(null, NOW)).toEqual(EMPTY_OUTBOX);
    expect(readOutbox('x', NOW)).toEqual(EMPTY_OUTBOX);
    expect(readOutbox({ version: 99, accounts: {} }, NOW)).toEqual(EMPTY_OUTBOX);
    const out = readOutbox(
      {
        version: OUTBOX_VERSION,
        accounts: {
          'srv.u1': [entry('a', 'm1', NOW - 1000), { extId: 'a' }, null, { ...entry('a', 'm2', NOW), url: 'file:///x' }, 'x'],
          'srv.u2': 'not a list',
        },
      },
      NOW,
    );
    expect(out.accounts).toEqual({ 'srv.u1': [entry('a', 'm1', NOW - 1000)] });
  });

  it('drops reports older than 30 days', () => {
    const box: ReportOutbox = { version: OUTBOX_VERSION, accounts: { 'srv.u1': [entry('a', 'old', NOW - MAX_AGE_MS - 1), entry('a', 'new', NOW - 29 * DAY)] } };
    expect(readOutbox(box, NOW).accounts['srv.u1']!.map((e) => e.body.mediaId)).toEqual(['new']);
    expect(readOutbox({ version: OUTBOX_VERSION, accounts: { 'srv.u1': [entry('a', 'old', NOW - 31 * DAY)] } }, NOW).accounts).toEqual({});
  });
});

describe('addReport', () => {
  it('keeps each account apart and at most MAX_PER_ACCOUNT reports, the oldest going first', () => {
    let box = EMPTY_OUTBOX;
    for (let i = 0; i < MAX_PER_ACCOUNT + 5; i++) box = addReport(box, 'srv.u1', entry('a', `m${i}`, NOW - 10_000 + i), NOW);
    box = addReport(box, 'srv.u2', entry('a', 'other', NOW), NOW);
    const list = box.accounts['srv.u1']!;
    expect(list).toHaveLength(MAX_PER_ACCOUNT);
    expect(list[0]!.body.mediaId).toBe('m5');
    expect(list[list.length - 1]!.body.mediaId).toBe(`m${MAX_PER_ACCOUNT + 4}`);
    expect(box.accounts['srv.u2']!.map((e) => e.body.mediaId)).toEqual(['other']);
  });
});

describe('replay', () => {
  it('sends oldest first and keeps the reports of an extension that does not answer, in order', async () => {
    const sent: string[] = [];
    const entries = [entry('a', '1', 1), entry('b', '2', 2), entry('a', '3', 3), entry('b', '4', 4), entry('a', '5', 5)];
    const left = await replay(entries, async (e) => {
      sent.push(`${e.extId}:${e.body.mediaId}`);
      return e.extId === 'a';
    });
    // b failed once; its later report is not tried.
    expect(sent).toEqual(['a:1', 'b:2', 'a:3', 'a:5']);
    expect(left.map((e) => e.body.mediaId)).toEqual(['2', '4']);
  });

  it('counts a sender that throws as no answer', async () => {
    const left = await replay([entry('a', '1', 1)], async () => {
      throw new Error('boom');
    });
    expect(left).toHaveLength(1);
  });
});

describe('createReportOutbox', () => {
  function setup(account: string | null = 'srv.u1') {
    let saved: unknown = null;
    const storage = { read: () => saved, write: (v: ReportOutbox) => void (saved = JSON.parse(JSON.stringify(v))) };
    const answers = new Map<string, boolean>();
    const sent: string[] = [];
    let clock = NOW;
    const box = createReportOutbox(
      storage,
      {
        account: () => account,
        send: async (e) => {
          sent.push(e.body.mediaId);
          return answers.get(e.extId) ?? true;
        },
      },
      () => clock,
    );
    return { box, sent, answers, advance: (ms: number) => (clock += ms), saved: () => saved };
  }

  it('sends only the signed-in account, removes what was sent and keeps what was not', async () => {
    const t = setup();
    t.box.add('srv.u1', { extId: 'a', url: 'https://a.example.org/p', body: buildReport({ event: 'stop', mediaId: 'm1', position: 1 }) });
    t.advance(10);
    t.box.add('srv.u1', { extId: 'b', url: 'https://b.example.org/p', body: buildReport({ event: 'finished', mediaId: 'm2', position: 2 }) });
    t.box.add('srv.u2', { extId: 'a', url: 'https://a.example.org/p', body: buildReport({ event: 'stop', mediaId: 'other', position: 3 }) });
    t.answers.set('b', false);
    await t.box.flush();
    expect(t.sent).toEqual(['m1', 'm2']);
    expect(t.box.pending('srv.u1').map((e) => e.body.mediaId)).toEqual(['m2']);
    expect(t.box.pending('srv.u2').map((e) => e.body.mediaId)).toEqual(['other']);

    t.answers.set('b', true);
    await t.box.flush();
    expect(t.box.pending('srv.u1')).toEqual([]);
  });

  it('drops a report that waited more than 30 days without sending it', async () => {
    const t = setup();
    t.box.add('srv.u1', { extId: 'a', url: 'https://a.example.org/p', body: buildReport({ event: 'stop', mediaId: 'm1', position: 1 }) });
    t.advance(MAX_AGE_MS + 1);
    await t.box.flush();
    expect(t.sent).toEqual([]);
    expect(t.box.pending('srv.u1')).toEqual([]);
  });

  it('does nothing with no account signed in', async () => {
    const t = setup(null);
    t.box.add('srv.u1', { extId: 'a', url: 'https://a.example.org/p', body: buildReport({ event: 'stop', mediaId: 'm1', position: 1 }) });
    await t.box.flush();
    expect(t.sent).toEqual([]);
    expect(t.box.pending('srv.u1')).toHaveLength(1);
  });

  it('stops sending when the account changes during a run: account A reports never go with account B', async () => {
    let saved: unknown = null;
    const storage = { read: () => saved, write: (v: ReportOutbox) => void (saved = JSON.parse(JSON.stringify(v))) };
    let account = 'srv.u1';
    const sent: { mediaId: string; account: string }[] = [];
    const box = createReportOutbox(
      storage,
      {
        account: () => account,
        send: async (e) => {
          sent.push({ mediaId: e.body.mediaId, account });
          // The user switches accounts while the first report is on its way.
          account = 'srv.u2';
          return true;
        },
      },
      () => NOW,
    );
    box.add('srv.u1', entry('a', 'm1', NOW - 2000));
    box.add('srv.u1', entry('b', 'm2', NOW - 1000));
    await box.flush();
    expect(sent).toEqual([{ mediaId: 'm1', account: 'srv.u1' }]);
    expect(box.pending('srv.u1').map((e) => e.body.mediaId)).toEqual(['m2']);
  });
});
