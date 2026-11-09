/**
 * What a nearby session does when a device drops off. Pure functions, so
 * every rule is unit-tested.
 *
 * - Nobody pauses because a peer is gone: each device plays on with its own
 *   clock and the last group anchor.
 * - A guest that drops tries again for `RECONNECT_WINDOW` with the session
 *   key (no new approval), with the delays of `retryDelay`.
 * - When the host drops, the guests try the host for `ELECTION_GRACE`. Then
 *   they elect a new host with `electHost`: only a member that has all the
 *   media (its own downloads) and an open player can be host; the earliest
 *   joined wins; ties go to the lower member id. A member that closed its
 *   player (`noMedia`) cannot win: it has no position to continue from. Every member has the same member list (the host
 *   sent it), so every member elects the same device with no extra messages.
 * - The new host continues from its own player (it kept playing), so its
 *   position does not jump; `handoverAnchor` makes the anchor, and
 *   `handoverJump` measures the change against the old group anchor.
 * - With no candidate, the guests wait for the old host to come back. A host
 *   that comes back after a new host took over joins as a member.
 * - When the device that made the Wi-Fi drops, the network is gone:
 *   `afterNetworkLoss` gives the plan.
 */
import { positionAt } from './drift';
import type { Anchor, Member } from './protocol';

/** A guest tries to come back for this long, ms. */
export const RECONNECT_WINDOW = 120_000;
/** The guests try the old host for this long before they elect a new one, ms. */
export const ELECTION_GRACE = 6000;
/** A saved session can be joined again after an app restart for this long, ms. */
export const REJOIN_WINDOW = 10 * 60_000;

/** The wait before retry number `attempt` (0, 1, 2 …): 0.5 s, 1 s, 2 s, 4 s, 8 s, then 10 s. */
export function retryDelay(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** Math.max(0, Math.floor(attempt)));
}

/** True while a device that dropped at `since` must still try to come back. */
export function shouldRetry(since: number, now: number): boolean {
  return now - since < RECONNECT_WINDOW;
}

export interface ElectionMember {
  id: string;
  joinedAt?: number;
  canHost?: boolean;
  away?: boolean;
  /** The member closed its player or cannot play the item: it has no player to host from. */
  noMedia?: boolean;
}

/**
 * The member that becomes the host after `oldHostId` dropped, or null when
 * no member has the media. `members` holds every member that the old host
 * listed, plus this device. Members that are away, or that have no player
 * (`noMedia`), cannot be elected.
 */
export function electHost(members: readonly ElectionMember[], oldHostId: string): string | null {
  const candidates = members.filter((m) => m.id !== oldHostId && m.canHost === true && m.away !== true && m.noMedia !== true);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.joinedAt ?? Number.MAX_SAFE_INTEGER) - (b.joinedAt ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0]?.id ?? null;
}

/**
 * The anchor of the new host, on its own clock (`localNow`). When its
 * player plays (or holds a position), the anchor starts from the player, so
 * the new host does not jump. Else the old anchor carries on: `offset` is
 * the old host's clock minus this device's clock (ms).
 */
export function handoverAnchor(last: Anchor, offset: number, localNow: number, own: { position: number } | null): Anchor {
  const position = own ? own.position : positionAt(last, localNow + offset);
  return { playing: last.playing, rate: last.rate, hostTime: localNow, position };
}

/** Seconds that the group position moves at the handover (new minus old), at `localNow`. */
export function handoverJump(last: Anchor, offset: number, next: Anchor, localNow: number): number {
  return positionAt(next, localNow) - positionAt(last, localNow + offset);
}

export type HostLossDecision =
  /** Keep trying the old host. */
  | { kind: 'retry' }
  /** This device is the new host. */
  | { kind: 'become-host' }
  /** Look for the new host (same session, a higher epoch). */
  | { kind: 'follow'; hostId: string }
  /** No member has the media: pause and wait for the old host. */
  | { kind: 'wait-for-host' };

/** What a guest does `elapsed` ms after the link to the host was lost. */
export function afterHostLoss(input: { selfId: string; oldHostId: string; members: readonly ElectionMember[]; elapsed: number }): HostLossDecision {
  if (input.elapsed < ELECTION_GRACE) return { kind: 'retry' };
  const winner = electHost(input.members, input.oldHostId);
  if (winner === null) return { kind: 'wait-for-host' };
  return winner === input.selfId ? { kind: 'become-host' } : { kind: 'follow', hostId: winner };
}

export interface NetworkLossPlan {
  /** Devices with their own copy play on. */
  keepPlaying: boolean;
  /** This device streams: it plays until its buffer is empty. */
  streamEnds: boolean;
  /** Members that can make a new Wi-Fi network, best first (earliest joined), not the lost owner. */
  makers: string[];
  /** No other device can make the network: wait for the owner to come back. */
  waitForOwner: boolean;
}

/**
 * The plan when the device that made the Wi-Fi network (an Android local
 * hotspot) dropped: the network is gone for everyone. A new network comes
 * from another member that can make one (Bluetooth rendezvous again), else
 * from the same device when it comes back.
 */
export function afterNetworkLoss(input: { ownerId: string; selfId: string; members: readonly (ElectionMember & Pick<Member, 'maker'>)[]; local: boolean }): NetworkLossPlan {
  const makers = input.members
    .filter((m) => m.id !== input.ownerId && m.maker === true)
    .sort((a, b) => (a.joinedAt ?? Number.MAX_SAFE_INTEGER) - (b.joinedAt ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : 1))
    .map((m) => m.id);
  return { keepPlaying: true, streamEnds: !input.local, makers, waitForOwner: makers.length === 0 };
}
