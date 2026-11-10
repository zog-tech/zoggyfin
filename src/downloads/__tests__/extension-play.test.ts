/**
 * A completed extension download plays from the device through the
 * player's external path: the local file, the saved subtitles, the title
 * and art of the record, and the position kept on the device. Offline
 * reports: only `stop` and `finished` wait in the outbox. The Downloads tab
 * shows an account only its own extension downloads.
 */
import { extensionMediaState, localPlayRequest, type LocalPlayDeps, type QueuedReport } from '../extension-media';
import { buildExtensionSections, buildLists, jellyfinOnly, searchDownloads, visibleTo } from '../lists';
import { newExtensionRecord } from '../extension-media';
import { rec } from '../test-utils/fixtures';
import { BASE, EXT_ID, fakeDeps, mediaExtension } from '../test-utils/extension-fakes';
import type { DownloadRecord } from '../types';

const DOCS = 'file:///docs/';

function done(mediaId: string, account: { serverId: string; userId: string }, over: Partial<DownloadRecord> = {}): DownloadRecord {
  const r = newExtensionRecord(
    { extension: EXT_ID, mediaId, download: `${BASE}/api/${mediaId}/download`, title: `Entry ${mediaId}`, subtitle: 'Example Media', image: `/img/${mediaId}.jpg`, duration: 600 },
    { ...account, baseUrl: BASE, kind: 'video', order: 0, now: 1 },
  );
  return { ...r, state: 'completed', mediaFile: 'media.mp4', bytesDone: 500, bytesTotal: 500, completedAt: 100, ...over };
}

const A = { serverId: 'server-1', userId: 'user-1' };
const B = { serverId: 'server-1', userId: 'user-2' };

function playDeps() {
  const fake = fakeDeps(() => mediaExtension(), {});
  const saved: { id: string; position: number | null }[] = [];
  const queued: { account: string; report: QueuedReport }[] = [];
  const deps: LocalPlayDeps = {
    ...fake.deps,
    savePosition: (id, position) => saved.push({ id, position }),
    queueReport: (account, report) => queued.push({ account, report }),
  };
  return { deps, saved, queued, fake };
}

describe('localPlayRequest', () => {
  const record = (() => {
    const r = done('e1', A, { subtitles: [{ index: 0, label: 'English', language: 'en', isDefault: false, isForced: false, file: 'subtitle-0.vtt' }] });
    return { ...r, source: { ...r.source, position: 95, label: '720p', report: { url: `${BASE}/api/e1/progress`, intervalSeconds: 10 } } } as DownloadRecord;
  })();

  it('maps the record to the external path with the local file', async () => {
    const { deps } = playDeps();
    const req = localPlayRequest(record, DOCS, deps)!;
    expect(req.items).toEqual([{ id: 'e1', kind: 'film', title: 'Entry e1', subtitle: 'Example Media', duration: 600, poster: `${BASE}/img/e1.jpg` }]);
    expect(req.source.itemId!(req.items[0]!)).toBe('ext:org.example.media:e1');
    expect(req.source.providerId).toBe('ext:org.example.media');
    const stream = await req.source.resolve(req.items[0]!);
    expect(stream.candidates).toEqual([{ url: `file:///docs/${record.dir}/media.mp4`, isHls: false }]);
    expect(stream.headers).toBeUndefined();
    expect(stream.resume).toBe(95);
    expect(stream.duration).toBe(600);
    expect(stream.title).toBe('Entry e1');
    expect(stream.subtitles).toEqual([{ id: '0', label: 'English', language: 'en', url: `file:///docs/${record.dir}/subtitle-0.vtt` }]);
    expect(stream.progress?.intervalMs).toBe(10_000);
  });

  it('keeps the position on the device, and forgets it at the end', () => {
    const { deps, saved } = playDeps();
    const req = localPlayRequest(record, DOCS, deps)!;
    req.source.savePosition!(req.items[0]!, 120, 600, false);
    req.source.savePosition!(req.items[0]!, 598, 600, false);
    req.source.savePosition!(req.items[0]!, 600, 600, true);
    expect(saved).toEqual([
      { id: record.itemId, position: 120 },
      { id: record.itemId, position: null },
      { id: record.itemId, position: null },
    ]);
  });

  it('sends reports with the extension headers, and keeps only stop and finished when offline', async () => {
    const { deps, queued, fake } = playDeps();
    const req = localPlayRequest(record, DOCS, deps)!;
    const stream = await req.source.resolve(req.items[0]!);
    const snap = { position: 30, duration: 600, rate: 1, quality: null };
    await stream.progress!.send('progress', snap);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]!.url).toBe(`${BASE}/api/e1/progress`);
    expect((fake.posts[0]!.init.headers as Record<string, string>)['X-Api-Key']).toBe('abc');
    expect(JSON.parse(fake.posts[0]!.init.body as string)).toMatchObject({ event: 'progress', mediaId: 'e1', position: 30, offline: true, quality: '720p' });

    fake.setPostStatus('offline');
    await stream.progress!.send('progress', snap);
    await stream.progress!.send('pause', snap);
    await stream.progress!.send('stop', { ...snap, position: 40 });
    await stream.progress!.send('finished', { ...snap, position: 600 });
    expect(queued.map((q) => [q.account, q.report.body.event, q.report.body.position])).toEqual([
      ['server-1.user-1', 'stop', 40],
      ['server-1.user-1', 'finished', 600],
    ]);
    expect(queued[0]!.report.url).toBe(`${BASE}/api/e1/progress`);

    // An answer with an error status is not kept.
    queued.length = 0;
    fake.setPostStatus(404);
    await stream.progress!.send('stop', snap);
    expect(queued).toEqual([]);
  });

  it('plays with no report URL, and refuses a record that is not complete', async () => {
    const { deps } = playDeps();
    const plain = done('e2', A);
    const req = localPlayRequest(plain, DOCS, deps)!;
    expect((await req.source.resolve(req.items[0]!)).progress).toBeUndefined();
    expect(localPlayRequest({ ...plain, state: 'paused' }, DOCS, deps)).toBeNull();
    expect(localPlayRequest(plain, null, deps)).toBeNull();
    expect(localPlayRequest(rec({ state: 'completed', mediaFile: 'media.mp3' }), DOCS, deps)).toBeNull();
  });
});

describe('extensionMediaState', () => {
  it('gives the button state of the signed-in account only', () => {
    const r = done('e1', A);
    const records = { [r.itemId]: r };
    expect(extensionMediaState(records, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'done' });
    expect(extensionMediaState(records, EXT_ID, 'e1', 'server-1.user-2')).toEqual({ state: 'none' });
    expect(extensionMediaState(records, EXT_ID, 'e1', null)).toEqual({ state: 'none' });
    expect(extensionMediaState(records, EXT_ID, 'other', 'server-1.user-1')).toEqual({ state: 'none' });
    const running = { [r.itemId]: { ...r, state: 'downloading' as const, bytesDone: 250, bytesTotal: 1000 } };
    expect(extensionMediaState(running, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'downloading', progress: 0.25 });
    expect(extensionMediaState({ [r.itemId]: { ...r, state: 'paused', bytesDone: 500, bytesTotal: 1000 } }, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'paused', progress: 0.5 });
    expect(extensionMediaState({ [r.itemId]: { ...r, state: 'queued' } }, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'queued' });
    expect(extensionMediaState({ [r.itemId]: { ...r, state: 'failed', error: 'No space' } }, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'failed', error: 'No space' });
  });
});

describe('lists per account', () => {
  const mine = done('e1', A, { completedAt: 200 });
  const mine2 = done('e2', A, { completedAt: 300 });
  const theirs = done('e3', B);
  const running = { ...done('e4', B), state: 'downloading' as const, completedAt: null };
  const movie = rec({ itemId: 'm1', state: 'completed', kind: 'video', item: { Id: 'm1', Name: 'Entry Movie', Type: 'Movie' }, group: { id: 'm1', name: 'Entry Movie', type: 'Single' } });
  const records = Object.fromEntries([mine, mine2, theirs, running, movie].map((r) => [r.itemId, r]));

  it('shows an account its own extension downloads, newest first, in a section per extension', () => {
    const secs = buildExtensionSections(records, 'server-1.user-1');
    expect(secs).toHaveLength(1);
    expect(secs[0]!.extId).toBe(EXT_ID);
    expect(secs[0]!.records.map((r) => r.itemId)).toEqual([mine2.itemId, mine.itemId]);
    expect(secs[0]!.count).toBe(2);
    expect(secs[0]!.bytes).toBe(1000);
    expect(buildExtensionSections(records, 'server-1.user-2')[0]!.records.map((r) => r.itemId)).toEqual([theirs.itemId]);
    expect(buildExtensionSections(records, null)).toEqual([]);
  });

  it('hides another account’s extension downloads in progress, and keeps them out of the server lists and search', () => {
    expect(buildLists(visibleTo(records, 'server-1.user-1'), {}).inProgress).toEqual([]);
    expect(buildLists(visibleTo(records, 'server-1.user-2'), {}).inProgress.map((r) => r.itemId)).toEqual([running.itemId]);
    expect(Object.keys(jellyfinOnly(records))).toEqual(['m1']);
    expect(searchDownloads(records, 'entry').map((i) => i.Id)).toEqual(['m1']);
  });
});
