/**
 * The profile menu (the avatar button in the Home header): the rows and
 * their states. Pure, so it is unit-tested. The menu gives direct access to
 * the key features; each row opens an existing screen.
 */
import { addressNetwork } from '@/servers/addresses';
import type { ConnectionInfo } from '@/servers/status';
import type { TogetherState } from '@/together/store';
import { groupCount } from '@/together/syncplay-logic';

export type MenuRowId = 'invite' | 'together' | 'remote' | 'downloads' | 'admin' | 'extensions' | 'settings' | 'signout';

export interface MenuRow {
  id: MenuRowId;
  label: string;
  /** A short state on the right ("2 pending", "In a session · 3 people", "45%"), or null. */
  detail: string | null;
  icon: string;
  /** Sign out is destructive. */
  destructive?: boolean;
}

export interface MenuInput {
  /** The user is an administrator on the current server (null: not known yet). */
  admin: boolean | null;
  /** Pending invites of this server, or null when not known. */
  pendingInvites: number | null;
  /** Together can run on this platform. */
  together: boolean;
  /** People in the open room, or null when no room is open. A room with an unknown count: 0. */
  roomPeople: number | null;
  /** Remote control of other devices can run on this platform (not TV). */
  remote: boolean;
  /** Downloads can run on this platform. */
  downloads: boolean;
  /** Finished downloads on this device. */
  downloadCount: number;
  /** The active downloads: bytes done and total (null total: not known). */
  active: { done: number; total: number | null }[];
}

function people(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** The state of the Downloads row: the progress of the active downloads, else the count. */
export function downloadsDetail(count: number, active: MenuInput['active']): string | null {
  if (active.length) {
    const known = active.every((a) => a.total && a.total > 0);
    if (known) {
      const done = active.reduce((n, a) => n + a.done, 0);
      const total = active.reduce((n, a) => n + (a.total ?? 0), 0);
      const pct = Math.min(100, Math.floor((done / total) * 100));
      return active.length === 1 ? `${pct}%` : `${active.length} downloading · ${pct}%`;
    }
    return `${active.length} downloading`;
  }
  return count ? String(count) : null;
}

/** The rows, in order. Admin-only rows show only when the user is known to be an admin. */
export function menuRows(i: MenuInput): MenuRow[] {
  const rows: MenuRow[] = [];
  if (i.admin === true) {
    rows.push({ id: 'invite', label: 'Invite someone', icon: 'person.badge.plus', detail: i.pendingInvites ? `${i.pendingInvites} pending` : null });
  }
  if (i.together) {
    const detail = i.roomPeople === null ? null : i.roomPeople > 0 ? `In a session · ${people(i.roomPeople)}` : 'In a session';
    rows.push({ id: 'together', label: 'Together', icon: 'person.2', detail });
  }
  if (i.remote) rows.push({ id: 'remote', label: 'Control a device', icon: 'iphone', detail: null });
  if (i.downloads) rows.push({ id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle', detail: downloadsDetail(i.downloadCount, i.active) });
  if (i.admin === true) rows.push({ id: 'admin', label: 'Admin panel', icon: 'checkmark.shield', detail: null });
  rows.push({ id: 'extensions', label: 'Extensions', icon: 'square.grid.2x2', detail: null });
  rows.push({ id: 'settings', label: 'Settings', icon: 'gearshape', detail: null });
  rows.push({ id: 'signout', label: 'Sign out', icon: 'rectangle.portrait.and.arrow.right', detail: null, destructive: true });
  return rows;
}

/** Where the connection goes now: "Home network", "Internet", "Tailscale", or a state. */
export function connectionPlace(info: ConnectionInfo | null | undefined): { text: string; tone: 'ok' | 'warning' | 'muted' } {
  if (!info || info.status === 'unknown') return { text: info?.checking ? 'Checking' : 'Not checked yet', tone: 'muted' };
  if (info.status === 'unreachable') return { text: 'Not connected', tone: 'warning' };
  if (info.url && addressNetwork(info.url) === 'tailscale') return { text: 'Tailscale', tone: 'ok' };
  return { text: info.kind === 'internal' ? 'Home network' : 'Internet', tone: 'ok' };
}

/** People in the open room (this device too), 0 when the count is not known, or null with no room. */
export function roomPeople(st: Pick<TogetherState, 'mode' | 'phase' | 'members' | 'syncplay'>): number | null {
  if (st.syncplay.group) return groupCount(st.syncplay.group) ?? 0;
  if (st.mode !== 'nearby') return null;
  if (st.phase.name === 'hosting') return st.members.length + 1;
  if (st.phase.name === 'joined') return st.members.length + 2;
  if (st.phase.name === 'requesting' || st.phase.name === 'syncing' || st.phase.name === 'reconnecting') return 0;
  return null;
}
