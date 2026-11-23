import { initialUpdateState, laterKey, retryAction, type UpdateEvent, type UpdateOffer, updateReducer, type UpdateState } from '../machine';
import { checkForOta, laterOta, type OtaSource, restartOta, retryOta, setOtaSourceForTesting, snoozeOta, useOtaStore } from '../ota';
import {
  chooseUpdateCard,
  OTA_FOREGROUND_GAP_MS,
  otaManifestInfo,
  otaMessage,
  otaShadowed,
  playbackActive,
  restartNeedsConfirm,
  shortMessage,
  shouldCheckOta,
} from '../ota-rules';

const offer = (id = 'aaaa-1111', notes: string[] = ['Faster Home']): UpdateOffer => ({ version: '0.1.0', notes, date: null, id });
const run = (state: UpdateState, ...events: UpdateEvent[]) => events.reduce(updateReducer, state);
const start = initialUpdateState('Built-in version', null, null, 'ota');
const idle = { playing: false, playerOpen: false };

describe('OTA state machine', () => {
  it('downloads out of sight and opens the card only when ready', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer(), at: 1 });
    expect(found.phase.kind).toBe('available');
    expect(found.open).toBe(false);
    const downloading = updateReducer(found, { type: 'install' });
    expect(downloading.phase.kind).toBe('downloading');
    expect(downloading.open).toBe(false);
    const ready = updateReducer(downloading, { type: 'downloaded' });
    expect(ready.phase.kind).toBe('ready');
    expect(ready.open).toBe(true);
  });

  it('shows a manual check at once', () => {
    const s = run(start, { type: 'check', manual: true });
    expect(s.open).toBe(true);
    const found = updateReducer(s, { type: 'found', offer: offer(), at: 1 });
    expect(found.open).toBe(true);
    expect(run(s, { type: 'none', at: 2 }).phase.kind).toBe('current');
  });

  it('keeps a failed automatic check or download silent', () => {
    const check = run(start, { type: 'check', manual: false }, { type: 'failed', message: 'offline' });
    expect(check.phase.kind).toBe('idle');
    expect(check.open).toBe(false);
    const dl = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer(), at: 1 }, { type: 'install' }, { type: 'failed', message: 'x' });
    expect(dl.phase.kind).toBe('idle');
    expect(dl.offer).toBeNull();
    expect(dl.open).toBe(false);
  });

  it('shows a failed manual download', () => {
    const dl = run(start, { type: 'check', manual: true }, { type: 'found', offer: offer(), at: 1 }, { type: 'install' }, { type: 'failed', message: 'x' });
    expect(dl.phase).toEqual({ kind: 'error', step: 'download', message: 'x' });
    expect(retryAction(dl)).toBe('check');
  });

  it('remembers "Later" per update id', () => {
    const ready = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer('one'), at: 1 }, { type: 'install' }, { type: 'downloaded' });
    const later = updateReducer(ready, { type: 'later' });
    expect(later.open).toBe(false);
    expect(later.phase.kind).toBe('ready');
    expect(later.later).toBe('one');
    expect(laterKey(offer('one'))).toBe('one');
    // An automatic check while ready does nothing; a manual one opens the card.
    expect(updateReducer(later, { type: 'check', manual: false })).toBe(later);
    const reopened = updateReducer(later, { type: 'check', manual: true });
    expect(reopened.open).toBe(true);
    expect(reopened.manual).toBe(true);
  });

  it('does not open again for the same update after "Later", but does for a new one', () => {
    const base = { ...start, later: 'one' };
    const same = run(base, { type: 'check', manual: false }, { type: 'found', offer: offer('one'), at: 1 }, { type: 'install' }, { type: 'downloaded' });
    expect(same.phase.kind).toBe('ready');
    expect(same.open).toBe(false);
    const other = run(base, { type: 'check', manual: false }, { type: 'found', offer: offer('two'), at: 1 }, { type: 'install' }, { type: 'downloaded' });
    expect(other.open).toBe(true);
  });

  it('lets "Hide" close the card during the download', () => {
    const dl = run(start, { type: 'check', manual: true }, { type: 'found', offer: offer(), at: 1 }, { type: 'install' });
    const hidden = updateReducer(dl, { type: 'close' });
    expect(hidden.open).toBe(false);
    expect(hidden.phase.kind).toBe('downloading');
    expect(updateReducer(hidden, { type: 'downloaded' }).open).toBe(true);
  });

  it('goes back to ready after a failed restart', () => {
    const ready = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer(), at: 1 }, { type: 'install' }, { type: 'downloaded' });
    const restarting = updateReducer(ready, { type: 'restart' });
    expect(restarting.phase.kind).toBe('installing');
    const failed = updateReducer(restarting, { type: 'failed', message: 'no' });
    expect(failed.phase).toEqual({ kind: 'error', step: 'install', message: 'no' });
    expect(retryAction(failed)).toBe('restart');
    expect(updateReducer(failed, { type: 'later' }).phase.kind).toBe('ready');
    // "restart" applies only to a ready update.
    expect(updateReducer(start, { type: 'restart' })).toBe(start);
  });

  it('leaves the app source as before', () => {
    const app = initialUpdateState('0.1.0');
    expect(app.source).toBe('app');
    expect(updateReducer(app, { type: 'restart' })).toBe(app);
  });
});

describe('OTA rules', () => {
  it('throttles foreground checks to one per 30 minutes', () => {
    expect(shouldCheckOta('foreground', null, 1000)).toBe(true);
    expect(shouldCheckOta('foreground', 0, OTA_FOREGROUND_GAP_MS - 1)).toBe(false);
    expect(shouldCheckOta('foreground', 0, OTA_FOREGROUND_GAP_MS)).toBe(true);
    expect(shouldCheckOta('manual', 0, 1)).toBe(true);
    expect(shouldCheckOta('start', 0, 1)).toBe(true);
  });

  it('lets a new app win over an OTA update', () => {
    const ota = { ...start, open: true, phase: { kind: 'ready' as const }, offer: offer() };
    const app = initialUpdateState('0.1.0', null, 20);
    expect(chooseUpdateCard(null, ota, idle)).toBe('ota');
    expect(chooseUpdateCard(app, ota, idle)).toBe('ota');
    const appOffer = { ...app, offer: { version: '0.1.0', notes: [], date: null, build: 21 } };
    // Known but put off with "Later": still no OTA card.
    expect(chooseUpdateCard(appOffer, ota, idle)).toBeNull();
    expect(otaShadowed(appOffer)).toBe(true);
    expect(otaShadowed(null)).toBe(false);
    expect(chooseUpdateCard({ ...appOffer, open: true }, ota, idle)).toBe('app');
    expect(chooseUpdateCard(null, { ...ota, open: false }, idle)).toBeNull();
  });

  it('keeps the card quiet during playback unless the user opened it', () => {
    const ota = { ...start, open: true, phase: { kind: 'ready' as const }, offer: offer() };
    expect(chooseUpdateCard(null, ota, { playing: true, playerOpen: false })).toBeNull();
    expect(chooseUpdateCard(null, ota, { playing: false, playerOpen: true })).toBeNull();
    expect(chooseUpdateCard(null, { ...ota, manual: true }, { playing: true, playerOpen: false })).toBe('ota');
    expect(playbackActive(idle)).toBe(false);
    expect(restartNeedsConfirm({ playing: true, playerOpen: false })).toBe(true);
    expect(restartNeedsConfirm({ playing: false, playerOpen: true })).toBe(false);
  });

  it('shortens the message and drops links', () => {
    expect(shortMessage('  **Faster** Home.  See https://example.com/notes for more ')).toBe('Faster Home. See for more');
    expect(shortMessage('Fix [the player](https://x.y) on TV')).toBe('Fix the player on TV');
    expect(shortMessage('https://only.a.link')).toBeNull();
    expect(shortMessage(42)).toBeNull();
    expect(shortMessage('x'.repeat(300))).toHaveLength(120);
  });

  it('reads the message from the manifest', () => {
    expect(otaMessage({ metadata: { message: 'From metadata' } })).toBe('From metadata');
    expect(otaMessage({ metadata: {}, extra: { expoClient: { extra: { updateMessage: 'From config' } } } })).toBe('From config');
    expect(otaMessage({ metadata: {} })).toBeNull();
    expect(otaMessage(null)).toBeNull();
    expect(otaManifestInfo({ id: 'abc', createdAt: '2026-10-31T00:00:00Z' })).toEqual({ id: 'abc', date: '2026-10-31T00:00:00Z' });
    expect(otaManifestInfo({})).toEqual({ id: null, date: null });
  });
});

describe('OTA controller', () => {
  function fake(over: Partial<OtaSource> = {}): OtaSource & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      check: jest.fn(async () => {
        calls.push('check');
        return offer('srv-1');
      }),
      fetch: jest.fn(async () => {
        calls.push('fetch');
        return true;
      }),
      reload: jest.fn(async () => {
        calls.push('reload');
      }),
      ...over,
    };
  }
  const state = () => useOtaStore.getState().state;

  afterEach(() => setOtaSourceForTesting(null));

  it('checks, downloads and waits for the user', async () => {
    const src = fake();
    setOtaSourceForTesting(src);
    await checkForOta(false, 'start');
    expect(src.calls).toEqual(['check', 'fetch']);
    expect(state().phase.kind).toBe('ready');
    expect(state().open).toBe(true);
    expect(src.reload).not.toHaveBeenCalled();
    laterOta();
    expect(state().open).toBe(false);
    // Ready: no more server calls.
    await checkForOta(true);
    expect(src.calls).toEqual(['check', 'fetch']);
    expect(state().open).toBe(true);
    await restartOta();
    expect(src.reload).toHaveBeenCalledTimes(1);
  });

  it('throttles foreground checks', async () => {
    const src = fake({ check: jest.fn(async () => null) });
    setOtaSourceForTesting(src);
    await checkForOta(false, 'start');
    await checkForOta(false, 'foreground');
    expect(src.check).toHaveBeenCalledTimes(1);
    expect(state().open).toBe(false);
  });

  it('shows errors of a manual check only', async () => {
    const src = fake({ check: jest.fn(async () => Promise.reject(new Error('Network down'))) });
    setOtaSourceForTesting(src);
    await checkForOta(false, 'start');
    expect(state().open).toBe(false);
    await checkForOta(true);
    expect(state().phase).toEqual({ kind: 'error', step: 'check', message: 'Network down' });
  });

  it('retries a failed restart', async () => {
    let fail = true;
    const src = fake({
      reload: jest.fn(async () => {
        if (fail) throw new Error('no');
      }),
    });
    setOtaSourceForTesting(src);
    await checkForOta(false, 'start');
    await restartOta();
    expect(state().phase.kind).toBe('error');
    fail = false;
    retryOta();
    await Promise.resolve();
    expect(src.reload).toHaveBeenCalledTimes(2);
    expect(state().phase.kind).toBe('installing');
  });
});

describe('OTA snooze (TV)', () => {
  const ready = () => run(start, { type: 'check', manual: false }, { type: 'found', offer: offer(), at: 1 }, { type: 'install' }, { type: 'downloaded' });

  it('reopens a snoozed ready card, not as a manual open', () => {
    const snoozed = updateReducer(ready(), { type: 'later' });
    expect(snoozed.open).toBe(false);
    const reminded = updateReducer(snoozed, { type: 'remind' });
    expect(reminded.open).toBe(true);
    expect(reminded.manual).toBe(false);
    // Not manual: it still waits while something plays.
    expect(chooseUpdateCard(null, reminded, { playing: true, playerOpen: false })).toBeNull();
    expect(chooseUpdateCard(null, reminded, idle)).toBe('ota');
  });

  it('does nothing without a ready update, or when the card is open', () => {
    const r = ready();
    expect(updateReducer(r, { type: 'remind' })).toBe(r);
    expect(updateReducer(start, { type: 'remind' })).toBe(start);
  });

  it('opens the card again after the snooze time', async () => {
    jest.useFakeTimers();
    try {
      const fake: OtaSource = { check: async () => offer(), fetch: async () => true, reload: async () => undefined };
      setOtaSourceForTesting(fake);
      await checkForOta(false);
      expect(useOtaStore.getState().state.open).toBe(true);
      snoozeOta(1000);
      expect(useOtaStore.getState().state.open).toBe(false);
      jest.advanceTimersByTime(999);
      expect(useOtaStore.getState().state.open).toBe(false);
      jest.advanceTimersByTime(1);
      expect(useOtaStore.getState().state.open).toBe(true);
    } finally {
      jest.useRealTimers();
      setOtaSourceForTesting(null);
    }
  });
});
