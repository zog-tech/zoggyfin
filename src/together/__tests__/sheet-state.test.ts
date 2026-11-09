import { shouldDismiss } from '@/components/sheet-dismiss';
import { IDLE } from '../machine';
import { closeTogetherSheet, initialTogether, openTogetherSheet, pastLobby, releaseTogetherSheet, togetherState, useTogetherStore } from '../store';

beforeEach(() => useTogetherStore.setState(initialTogether, true));

describe('the together sheet open state', () => {
  it('opens again after a close (swipe, Done, scrim or back all call close)', () => {
    openTogetherSheet('player', null);
    const first = togetherState().sheet.seq;
    closeTogetherSheet();
    expect(togetherState().sheet.open).toBe(false);
    openTogetherSheet('player', null);
    expect(togetherState().sheet).toMatchObject({ open: true, where: 'player' });
    expect(togetherState().sheet.seq).toBeGreaterThan(first);
  });

  it('gives each open a new sequence number, even when it is already open', () => {
    openTogetherSheet('player', null);
    const a = togetherState().sheet.seq;
    openTogetherSheet('player', null);
    expect(togetherState().sheet.seq).toBe(a + 1);
  });

  it('closes when the screen that shows it goes away', () => {
    openTogetherSheet('player', null);
    releaseTogetherSheet('player');
    expect(togetherState().sheet.open).toBe(false);
  });

  it('does not close a sheet that another screen shows', () => {
    openTogetherSheet('music', null);
    releaseTogetherSheet('player');
    expect(togetherState().sheet).toMatchObject({ open: true, where: 'music' });
  });
});

describe('pastLobby', () => {
  it('is false in the lobby and true from a join request to the end screen', () => {
    const st = (patch: Partial<ReturnType<typeof togetherState>>) => ({ ...initialTogether, ...patch });
    expect(pastLobby(initialTogether)).toBe(false);
    expect(pastLobby(st({ mode: 'nearby', phase: { name: 'browsing' } }))).toBe(false);
    expect(pastLobby(st({ mode: 'nearby', phase: { name: 'requesting', hostPeerId: 'p', hostName: 'Sam' } }))).toBe(true);
    expect(pastLobby(st({ mode: 'nearby', phase: { name: 'hosting', sessionId: 's' } }))).toBe(true);
    expect(pastLobby(st({ mode: 'nearby', phase: { name: 'ended', reason: 'error', message: 'x' } }))).toBe(true);
    // A phase left over in mode 'none' does not count.
    expect(pastLobby(st({ mode: 'none', phase: { name: 'hosting', sessionId: 's' } }))).toBe(false);
  });

  it('is true in a SyncPlay group, whatever the nearby phase', () => {
    const group = { id: 'g', name: 'Group', state: 'Idle', participants: [] };
    expect(pastLobby({ ...initialTogether, mode: 'syncplay', phase: IDLE, syncplay: { ...initialTogether.syncplay, group } })).toBe(true);
  });
});

describe('shouldDismiss', () => {
  it('closes after a long drag or a fast flick down', () => {
    expect(shouldDismiss(120, 0)).toBe(true);
    expect(shouldDismiss(30, 1500)).toBe(true);
  });
  it('springs back after a short, slow drag or a tap', () => {
    expect(shouldDismiss(40, 200)).toBe(false);
    expect(shouldDismiss(5, 2000)).toBe(false);
  });
});
