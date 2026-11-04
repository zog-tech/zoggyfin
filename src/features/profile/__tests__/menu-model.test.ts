import { initialTogether } from '@/together/store';

import { connectionPlace, downloadsDetail, type MenuInput, menuRows, roomPeople } from '../menu-model';

const base: MenuInput = { admin: false, pendingInvites: null, together: true, roomPeople: null, remote: true, downloads: true, downloadCount: 0, active: [] };
const ids = (i: MenuInput) => menuRows(i).map((r) => r.id);

describe('profile menu rows', () => {
  it('has the order of the spec, with the admin rows only for an admin', () => {
    expect(ids({ ...base, admin: true })).toEqual(['invite', 'together', 'remote', 'downloads', 'admin', 'extensions', 'settings', 'signout']);
    expect(ids(base)).toEqual(['together', 'remote', 'downloads', 'extensions', 'settings', 'signout']);
    // Not known yet: no admin rows (they come when the check answers).
    expect(ids({ ...base, admin: null })).not.toContain('admin');
    expect(ids({ ...base, admin: null })).not.toContain('invite');
  });

  it('leaves out Together, Remote and Downloads where they cannot run', () => {
    expect(ids({ ...base, together: false, remote: false, downloads: false })).toEqual(['extensions', 'settings', 'signout']);
  });

  it('shows the pending invites', () => {
    const row = (n: number | null) => menuRows({ ...base, admin: true, pendingInvites: n }).find((r) => r.id === 'invite')!.detail;
    expect(row(2)).toBe('2 pending');
    expect(row(0)).toBeNull();
    expect(row(null)).toBeNull();
  });

  it('shows an open room', () => {
    const row = (n: number | null) => menuRows({ ...base, roomPeople: n }).find((r) => r.id === 'together')!.detail;
    expect(row(null)).toBeNull();
    expect(row(3)).toBe('In a session · 3 people');
    expect(row(1)).toBe('In a session · 1 person');
    expect(row(0)).toBe('In a session');
  });

  it('shows the download progress, else the count', () => {
    expect(downloadsDetail(0, [])).toBeNull();
    expect(downloadsDetail(4, [])).toBe('4');
    expect(downloadsDetail(4, [{ done: 45, total: 100 }])).toBe('45%');
    expect(downloadsDetail(4, [{ done: 50, total: 100 }, { done: 0, total: 100 }])).toBe('2 downloading · 25%');
    expect(downloadsDetail(4, [{ done: 50, total: null }])).toBe('1 downloading');
    expect(menuRows(base).find((r) => r.id === 'signout')!.destructive).toBe(true);
  });
});

describe('room people', () => {
  it('counts the room of each kind', () => {
    expect(roomPeople(initialTogether)).toBeNull();
    const two = [
      { id: 'a', name: 'Sam', local: false },
      { id: 'b', name: 'Kim', local: false },
    ];
    expect(roomPeople({ ...initialTogether, mode: 'nearby', phase: { name: 'hosting', sessionId: 's' }, members: two })).toBe(3);
    expect(roomPeople({ ...initialTogether, mode: 'nearby', phase: { name: 'browsing' } })).toBeNull();
    const group = { id: 'g', name: 'G', state: 'Idle', participants: ['Sam', 'Kim'] };
    expect(roomPeople({ ...initialTogether, syncplay: { ...initialTogether.syncplay, group } })).toBe(2);
    expect(roomPeople({ ...initialTogether, syncplay: { ...initialTogether.syncplay, group: { ...group, stale: true } } })).toBe(0);
  });
});

describe('connection place', () => {
  const info = (url: string, kind: 'internal' | 'external') => ({ status: 'connected' as const, checking: false, url, kind, wanted: null, results: {}, checkedAt: 1 });
  it('names the network', () => {
    expect(connectionPlace(info('http://10.0.0.5:8096', 'internal')).text).toBe('Home network');
    expect(connectionPlace(info('https://jf.example.com', 'external')).text).toBe('Internet');
    expect(connectionPlace(info('http://100.101.102.103:8096', 'external')).text).toBe('Tailscale');
    expect(connectionPlace({ ...info('x', 'external'), status: 'unreachable' }).tone).toBe('warning');
    expect(connectionPlace(null).text).toBe('Not checked yet');
  });
});
