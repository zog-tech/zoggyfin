/**
 * The "preparing" wait of extension media: the extension makes the file
 * first. The state rules, the reply parser, the saved form (a state every
 * app version knows) and the button state.
 */
import { parsePreparing, PREPARING_RETRY_DEFAULT } from '@/extensions/media/download';

import { extensionMediaState, newExtensionRecord } from '../extension-media';
import { migrateSnapshot, storedRecords } from '../migrate';
import {
  clampRetryAfter,
  dueForPoll,
  isActive,
  PREPARE_LIMIT_MS,
  PREPARE_RETRY_MAX_S,
  PREPARE_RETRY_MIN_S,
  PREPARE_TOO_LONG,
  transition,
} from '../state-machine';
import { recordStatus } from '../store';
import { DOWNLOAD_SCHEMA_VERSION, type DownloadRecord } from '../types';

jest.mock('@/storage/kv', () => {
  const m = new Map<string, string>();
  return { storage: { getString: (k: string) => m.get(k), set: (k: string, v: string) => m.set(k, v), remove: (k: string) => m.delete(k), clearAll: () => m.clear() } };
});

const EXT_ID = 'org.example.media';
const BASE = 'https://media.example.org';

function extRecord(over: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    ...newExtensionRecord(
      { extension: EXT_ID, mediaId: 'e1', download: `${BASE}/api/e1/download`, title: 'An entry' },
      { serverId: 'server-1', userId: 'user-1', baseUrl: BASE, kind: 'video', order: 0, now: 1 },
    ),
    ...over,
  };
}

const prepare = (now: number, retryAfter = 5, progress: number | null = null) => ({ type: 'prepare' as const, progress, retryAfter, now });

describe('transition: preparing', () => {
  it('a running ask that gets "preparing" waits, with no transfer slot', () => {
    const running = transition(extRecord(), { type: 'start', now: 0 });
    const r = transition(running, prepare(1000, 5, 0.42));
    expect(r.state).toBe('preparing');
    expect(r.retryAt).toBe(6000);
    expect(r.prepare).toEqual({ since: 1000, progress: 0.42 });
    expect(isActive(r.state)).toBe(true);
  });

  it('asks again at retryAt, and keeps the first "preparing" time across asks', () => {
    let r = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(1000));
    expect(transition(r, { type: 'poll', now: 5999 })).toBe(r);
    r = transition(r, { type: 'poll', now: 6000 });
    expect(r.state).toBe('queued');
    expect(r.retryAt).toBeNull();
    r = transition(transition(r, { type: 'start', now: 6000 }), prepare(7000, 10, 0.5));
    expect(r.prepare).toEqual({ since: 1000, progress: 0.5 });
    expect(r.retryAt).toBe(17_000);
  });

  it('keeps the ask-again time between the bounds', () => {
    expect(clampRetryAfter(0.1)).toBe(PREPARE_RETRY_MIN_S);
    expect(clampRetryAfter(600)).toBe(PREPARE_RETRY_MAX_S);
    expect(clampRetryAfter(Number.NaN)).toBeGreaterThanOrEqual(PREPARE_RETRY_MIN_S);
    const r = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0, 3600));
    expect(r.retryAt).toBe(PREPARE_RETRY_MAX_S * 1000);
  });

  it('fails after the limit, with no automatic retry', () => {
    let r = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0));
    r = transition(transition(transition(r, { type: 'poll', now: PREPARE_LIMIT_MS }), { type: 'start', now: PREPARE_LIMIT_MS }), prepare(PREPARE_LIMIT_MS));
    expect(r.state).toBe('failed');
    expect(r.error).toBe(PREPARE_TOO_LONG);
    expect(r.retryAt).toBeNull();
    expect(r.prepare).toBeUndefined();
    // A retry by hand starts a new wait.
    const again = transition(r, { type: 'retry' });
    expect(again.state).toBe('queued');
    expect(transition(transition(again, { type: 'start', now: PREPARE_LIMIT_MS + 1 }), prepare(PREPARE_LIMIT_MS + 1)).state).toBe('preparing');
  });

  it('pause stops the wait; resume starts a new one', () => {
    const r = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0));
    const paused = transition(r, { type: 'pause' });
    expect(paused.state).toBe('paused');
    expect(paused.retryAt).toBeNull();
    expect(paused.prepare).toBeUndefined();
    expect(transition(paused, { type: 'poll', now: 1e9 })).toBe(paused);
    expect(transition(paused, prepare(1))).toBe(paused);
    expect(transition(paused, { type: 'resume' }).state).toBe('queued');
  });

  it('cancel ends the wait; other events leave it alone', () => {
    const r = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0));
    expect(transition(r, { type: 'cancel' }).state).toBe('cancelled');
    expect(transition(r, { type: 'start', now: 1 })).toBe(r);
    expect(transition(r, { type: 'complete', bytes: 1, now: 1 })).toBe(r);
    expect(transition(r, { type: 'fail', error: 'x', now: 1 })).toBe(r);
    expect(transition(r, prepare(2))).toBe(r);
  });

  it('dueForPoll lists only preparing records whose time has come', () => {
    const waiting = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0, 5));
    expect(dueForPoll([waiting, extRecord()], 4999)).toEqual([]);
    expect(dueForPoll([waiting, extRecord()], 5000)).toEqual([waiting]);
  });
});

describe('parsePreparing', () => {
  it('reads progress and retryAfter, and nothing else', () => {
    expect(parsePreparing({ preparing: { progress: 0.42, retryAfter: 5 } })).toEqual({ progress: 0.42, retryAfter: 5 });
    expect(parsePreparing({ preparing: {} })).toEqual({ progress: null, retryAfter: PREPARING_RETRY_DEFAULT });
    expect(parsePreparing({ preparing: true })).toEqual({ progress: null, retryAfter: PREPARING_RETRY_DEFAULT });
    expect(parsePreparing({ preparing: { progress: 7, retryAfter: -1 } })).toEqual({ progress: 1, retryAfter: PREPARING_RETRY_DEFAULT });
    expect(parsePreparing({ url: '/files/e1.mp4' })).toBeNull();
    expect(parsePreparing({ preparing: 'soon' })).toBeNull();
    expect(parsePreparing(null)).toBeNull();
    expect(parsePreparing([])).toBeNull();
  });
});

describe('the saved form', () => {
  const waiting = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(1000, 5, 0.3));
  const save = (records: Record<string, DownloadRecord>) => JSON.parse(JSON.stringify({ schemaVersion: DOWNLOAD_SCHEMA_VERSION, records: storedRecords(records), collections: {} }));

  it('is queued (a state every app version knows), and loads back as preparing', () => {
    const saved = save({ [waiting.itemId]: waiting });
    expect(saved.records[waiting.itemId].state).toBe('queued');
    const back = migrateSnapshot(saved).records[waiting.itemId]!;
    expect(back.state).toBe('preparing');
    expect(back.retryAt).toBe(waiting.retryAt);
    expect(back.prepare).toEqual({ since: 1000, progress: 0.3 });
  });

  it('leaves the other records as they are', () => {
    const records = { [extRecord().itemId]: extRecord() };
    expect(storedRecords(records)).toBe(records);
    const back = migrateSnapshot(save(records)).records[extRecord().itemId]!;
    expect(back.state).toBe('queued');
    expect(back.prepare).toBeUndefined();
  });

  it('drops a damaged prepare field, and never prepares a Jellyfin record', () => {
    const saved = save({ [waiting.itemId]: waiting });
    saved.records[waiting.itemId].prepare = { since: 'yesterday' };
    const back = migrateSnapshot(saved).records[waiting.itemId]!;
    expect(back.state).toBe('queued');
    expect(back.prepare).toBeUndefined();
    const jf = { ...waiting, itemId: 'item-1', source: { kind: 'jellyfin' as const } };
    expect(migrateSnapshot(save({ 'item-1': jf })).records['item-1']!.state).toBe('queued');
  });
});

describe('what the buttons show', () => {
  const waiting = transition(transition(extRecord(), { type: 'start', now: 0 }), prepare(0, 5, 0.25));

  it('an entry button shows preparing with the progress', () => {
    expect(extensionMediaState({ [waiting.itemId]: waiting }, EXT_ID, 'e1', 'server-1.user-1')).toEqual({ state: 'preparing', progress: 0.25 });
  });

  it('a download status shows it as waiting', () => {
    expect(recordStatus(waiting)).toEqual({ state: 'queued', progress: 0 });
  });
});
