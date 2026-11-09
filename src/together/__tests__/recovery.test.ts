import { waitForGapless } from '../audio-binding';
import { positionAt } from '../drift';
import { Follower } from '../follower';
import { decode, encode, type Member, type Message, type SharedQueue } from '../protocol';
import { afterHostLoss, afterNetworkLoss, ELECTION_GRACE, electHost, handoverAnchor, handoverJump, retryDelay, RECONNECT_WINDOW, shouldRetry } from '../recovery';
import { AWAY_LIMIT, HostRoom, type RoomQueue } from '../room';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

jest.mock('@/player/audio/session', () => ({ audioSession: () => ({}) }));
jest.mock('@/player/audio/store', () => ({ useAudioStore: { getState: () => ({}), subscribe: () => () => undefined } }));
jest.mock('@/player/store', () => ({ playerState: () => ({}), usePlayerStore: { subscribe: () => () => undefined } }));

const item = { id: 'item1', name: 'Film', type: 'Movie' };
const wire = (m: Message) => decode(encode(m))!;

describe('retries', () => {
  it('waits longer each time, up to 10 s, for two minutes', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
    expect(shouldRetry(0, RECONNECT_WINDOW - 1)).toBe(true);
    expect(shouldRetry(0, RECONNECT_WINDOW)).toBe(false);
  });
});

describe('electHost', () => {
  const m = (id: string, joinedAt: number | undefined, canHost: boolean, away = false) => ({ id, joinedAt, canHost, away });

  it('picks the earliest member that has the media', () => {
    expect(electHost([m('b', 20, true), m('a', 30, true), m('c', 10, false)], 'host')).toBe('b');
  });

  it('breaks a tie with the lower id', () => {
    expect(electHost([m('z', 10, true), m('y', 10, true)], 'host')).toBe('y');
  });

  it('never elects the old host, a member that is away, or a member with no media', () => {
    expect(electHost([m('host', 1, true), m('a', 5, true, true), m('b', 9, false)], 'host')).toBeNull();
  });

  it('puts members with no join time last', () => {
    expect(electHost([m('a', undefined, true), m('b', 99, true)], 'host')).toBe('b');
  });

  it('gives the same answer on every member (the same list in another order)', () => {
    const list = [m('c', 30, true), m('a', 10, false), m('b', 20, true), m('d', 20, true)];
    expect(electHost(list, 'h')).toBe('b');
    expect(electHost([...list].reverse(), 'h')).toBe('b');
  });
});

describe('afterHostLoss', () => {
  const members = [
    { id: 'me', joinedAt: 10, canHost: true },
    { id: 'other', joinedAt: 5, canHost: false },
  ];
  it('tries the old host first', () => {
    expect(afterHostLoss({ selfId: 'me', oldHostId: 'h', members, elapsed: ELECTION_GRACE - 1 })).toEqual({ kind: 'retry' });
  });
  it('becomes the host when elected', () => {
    expect(afterHostLoss({ selfId: 'me', oldHostId: 'h', members, elapsed: ELECTION_GRACE })).toEqual({ kind: 'become-host' });
  });
  it('follows the elected member', () => {
    expect(afterHostLoss({ selfId: 'other', oldHostId: 'h', members, elapsed: ELECTION_GRACE })).toEqual({ kind: 'follow', hostId: 'me' });
  });
  it('does not elect a guest that has the download but closed its player', () => {
    const closed = [
      { id: 'me', joinedAt: 5, canHost: true, noMedia: true },
      { id: 'other', joinedAt: 10, canHost: true },
    ];
    expect(afterHostLoss({ selfId: 'me', oldHostId: 'h', members: closed, elapsed: ELECTION_GRACE })).toEqual({ kind: 'follow', hostId: 'other' });
    expect(afterHostLoss({ selfId: 'other', oldHostId: 'h', members: closed, elapsed: ELECTION_GRACE })).toEqual({ kind: 'become-host' });
    expect(afterHostLoss({ selfId: 'me', oldHostId: 'h', members: [closed[0]!], elapsed: ELECTION_GRACE })).toEqual({ kind: 'wait-for-host' });
  });
  it('waits for the host when no member has the media', () => {
    expect(afterHostLoss({ selfId: 'other', oldHostId: 'h', members: [{ id: 'other', canHost: false }], elapsed: 60_000 })).toEqual({ kind: 'wait-for-host' });
  });
});

describe('afterNetworkLoss (the device that made the Wi-Fi drops)', () => {
  it('plays on, ends a stream at the end of its buffer, and picks another maker', () => {
    const members = [
      { id: 'owner', maker: true, joinedAt: 1 },
      { id: 'b', maker: true, joinedAt: 9 },
      { id: 'a', maker: true, joinedAt: 3 },
      { id: 'c', maker: false, joinedAt: 2 },
    ];
    expect(afterNetworkLoss({ ownerId: 'owner', selfId: 'c', members, local: false })).toEqual({ keepPlaying: true, streamEnds: true, makers: ['a', 'b'], waitForOwner: false });
  });
  it('waits for the owner when no other device can make a network', () => {
    expect(afterNetworkLoss({ ownerId: 'owner', selfId: 'c', members: [{ id: 'owner', maker: true }, { id: 'c', maker: false }], local: true })).toEqual({
      keepPlaying: true,
      streamEnds: false,
      makers: [],
      waitForOwner: true,
    });
  });
});

describe('handover anchor', () => {
  it('starts from the new host player, so it does not jump', () => {
    const last = { playing: true, rate: 1, hostTime: 1000, position: 10 };
    // The new host's clock is 500 ms behind the old host (offset +500); its player is 20 ms behind the plan.
    const now = 3000;
    const expected = positionAt(last, now + 500);
    const next = handoverAnchor(last, 500, now, { position: expected - 0.02 });
    expect(next).toEqual({ playing: true, rate: 1, hostTime: now, position: expected - 0.02 });
    expect(handoverJump(last, 500, next, now)).toBeCloseTo(-0.02, 6);
  });
  it('carries the old anchor on when the player has no position', () => {
    const last = { playing: false, rate: 1.5, hostTime: 1000, position: 42 };
    expect(handoverAnchor(last, 0, 9000, null)).toEqual({ playing: false, rate: 1.5, hostTime: 9000, position: 42 });
  });
});

/** A host and guests on one virtual clock, with a link per guest that can drop. */
function group(guests: { id: string; canHost: boolean; offset: number }[]) {
  const clock = new VirtualClock();
  const hostNow = () => clock.t + 50_000;
  const hostPlayer = new FakePlayer(clock, 40);
  const links = new Map<string, boolean>();
  const followers = new Map<string, Follower>();
  const players = new Map<string, FakePlayer>();
  let room: HostRoom;
  hostPlayer.play();
  clock.advance(2000);
  room = new HostRoom(
    {
      send: (m, to) => {
        for (const g of guests) {
          if (to && !to.includes(`peer-${g.id}`)) continue;
          if (!links.get(g.id)) continue;
          clock.setTimeout(() => followers.get(g.id)?.receive(wire(m), clock.t + g.offset), 10);
        }
      },
      now: hostNow,
      player: hostPlayer,
      timers: clock,
    },
    { sessionId: 's1', item, stream: null, onlyHostControls: false, key: 'k'.repeat(20), hostId: 'host' },
  );
  for (const g of guests) {
    links.set(g.id, true);
    const p = new FakePlayer(clock, 60);
    players.set(g.id, p);
    const f = new Follower({
      send: (m) => links.get(g.id) && clock.setTimeout(() => room.receive(`peer-${g.id}`, wire(m), hostNow()), 10),
      now: () => clock.t + g.offset,
      timers: clock,
    });
    followers.set(g.id, f);
    f.start(g.id, g.canHost ? ['item1'] : [], { memberId: g.id, canHost: g.canHost });
    clock.advance(200);
    f.attach(p, g.canHost);
    clock.advance(1500);
  }
  clock.advance(3000);
  return { clock, room: () => room, setRoom: (r: HostRoom) => (room = r), hostPlayer, players, followers, links, hostNow };
}

describe('drops (simulated)', () => {
  it('a guest that drops does not stop the others, and comes back with the same place', () => {
    const g = group([
      { id: 'a', canHost: true, offset: 1000 },
      { id: 'b', canHost: false, offset: -700 },
    ]);
    const joinedA = g.room().memberList.find((m) => m.id === 'a')!.joinedAt;
    // a drops.
    g.links.set('a', false);
    g.room().removeMember('peer-a');
    expect(g.room().memberList.find((m) => m.id === 'a')).toMatchObject({ away: true });
    expect(g.room().state.waiting).toBe(false);
    g.clock.advance(5000);
    expect(g.hostPlayer.isPlaying()).toBe(true);
    expect(g.players.get('b')!.isPlaying()).toBe(true);
    // a keeps playing on its own clock.
    expect(g.players.get('a')!.isPlaying()).toBe(true);
    expect(Math.abs(g.players.get('a')!.position() - g.hostPlayer.position())).toBeLessThan(0.1);
    // a comes back with its member id (a new socket).
    g.links.set('a', true);
    const fa = g.followers.get('a')!;
    fa.relink((m) => g.clock.setTimeout(() => g.room().receive('peer-a', wire(m), g.hostNow()), 10), false);
    g.clock.advance(3000);
    const back = g.room().memberList.find((m) => m.id === 'a')!;
    expect(back.away).toBe(false);
    expect(back.joinedAt).toBe(joinedA);
    expect(g.room().memberList).toHaveLength(2);
    expect(Math.abs(g.players.get('a')!.position() - g.hostPlayer.position())).toBeLessThan(0.06);
  });

  it('a member that comes back and buffers does not pause the group (it catches up)', () => {
    const g = group([
      { id: 'a', canHost: false, offset: 300 },
      { id: 'b', canHost: false, offset: -200 },
    ]);
    g.links.set('a', false);
    g.room().removeMember('peer-a');
    g.clock.advance(3000);
    // a comes back, but its player waits for data (a streaming guest that switches source).
    const pa = g.players.get('a')!;
    pa.setBuffering(true);
    g.links.set('a', true);
    g.followers.get('a')!.relink((m) => g.clock.setTimeout(() => g.room().receive('peer-a', wire(m), g.hostNow()), 10), false);
    const host = g.hostPlayer.position();
    g.clock.advance(2000);
    expect(g.room().state.waiting).toBe(false);
    expect(g.hostPlayer.isPlaying()).toBe(true);
    expect(g.hostPlayer.position() - host).toBeGreaterThan(1.9);
    expect(g.players.get('b')!.isPlaying()).toBe(true);
    // a has data again and catches up.
    pa.setBuffering(false);
    g.clock.advance(4000);
    expect(Math.abs(pa.position() - g.hostPlayer.position())).toBeLessThan(0.06);
    // From now on a counts again: when it buffers, the group waits.
    pa.setBuffering(true);
    g.clock.advance(1000);
    expect(g.room().state.waiting).toBe(true);
  });

  it('forgets a member that stays away too long', () => {
    const g = group([{ id: 'a', canHost: false, offset: 0 }]);
    g.links.set('a', false);
    g.room().removeMember('peer-a');
    g.clock.advance(AWAY_LIMIT + 10);
    expect(g.room().memberList).toEqual([]);
  });

  it('elects a new host when the host drops; the position moves by less than 100 ms', () => {
    const g = group([
      { id: 'a', canHost: true, offset: 1000 },
      { id: 'b', canHost: false, offset: -700 },
    ]);
    const fa = g.followers.get('a')!;
    const fb = g.followers.get('b')!;
    const members: Member[] = fa.allMembers;
    expect(members.map((m) => m.id).sort()).toEqual(['a', 'b']);
    // The host drops: no more messages; everyone plays on.
    g.links.set('a', false);
    g.links.set('b', false);
    g.room().dispose();
    g.hostPlayer.pause();
    g.clock.advance(ELECTION_GRACE);
    const decisionA = afterHostLoss({ selfId: 'a', oldHostId: 'host', members, elapsed: ELECTION_GRACE });
    const decisionB = afterHostLoss({ selfId: 'b', oldHostId: 'host', members: fb.allMembers, elapsed: ELECTION_GRACE });
    expect(decisionA).toEqual({ kind: 'become-host' });
    expect(decisionB).toEqual({ kind: 'follow', hostId: 'a' });
    // a takes over from its own player.
    const pa = g.players.get('a')!;
    const last = fa.groupAnchor!;
    const offset = fa.offset!;
    const aNow = () => g.clock.t + 1000;
    const anchor = handoverAnchor(last, offset, aNow(), { position: pa.position() });
    const jump = handoverJump(last, offset, anchor, aNow());
    expect(Math.abs(jump)).toBeLessThan(0.1);
    fa.release();
    const newRoom = new HostRoom(
      {
        send: (m, to) => {
          if (to && !to.includes('peer-b')) return;
          g.clock.setTimeout(() => fb.receive(wire(m), g.clock.t - 700), 10);
        },
        now: aNow,
        player: pa,
        timers: g.clock,
      },
      { sessionId: 's1', item, stream: null, onlyHostControls: false, key: 'k'.repeat(20), epoch: 1, hostId: 'a', anchor, members: members.filter((m) => m.id !== 'a') },
    );
    expect(newRoom.memberList).toMatchObject([{ id: 'b', away: true }]);
    // b follows the new host (a new clock).
    const pb = g.players.get('b')!;
    const before = pb.position();
    fb.relink((m) => g.clock.setTimeout(() => newRoom.receive('peer-b', wire(m), aNow()), 10), true);
    g.clock.advance(4000);
    expect(newRoom.memberList).toMatchObject([{ id: 'b', away: false }]);
    expect(pa.isPlaying()).toBe(true);
    expect(pb.isPlaying()).toBe(true);
    expect(pb.position()).toBeGreaterThan(before);
    expect(Math.abs(pa.position() - pb.position())).toBeLessThan(0.06);
  });
});

/** An audio player: a FakePlayer that knows its queue entry. */
class FakeAudio extends FakePlayer {
  key = 'e1';
  track(): string {
    return this.key;
  }
}

describe('audio queues (simulated)', () => {
  const queue: SharedQueue = {
    entries: [
      { key: 'e1', item: { id: 't1', name: 'One', type: 'Audio', path: '/x/1.m4a' } },
      { key: 'e2', item: { id: 't2', name: 'Two', type: 'Audio', path: '/x/2.m4a' } },
    ],
    index: 0,
    shuffle: false,
    repeat: 'off',
    longForm: false,
  };

  it('tags the state with the track, and tells a guest on another track', () => {
    const clock = new VirtualClock();
    const host = new FakeAudio(clock, 30);
    const guest = new FakeAudio(clock, 30);
    let trackListener: (k: string) => void = () => undefined;
    let q = queue;
    const rq: RoomQueue = {
      snapshot: () => q,
      track: () => host.key,
      onTrack: (l) => ((trackListener = l), () => undefined),
      onQueue: () => () => undefined,
      apply: (c) => {
        if (c.action === 'next') {
          host.key = 'e2';
          host.seek(0);
          q = { ...q, index: 1 };
          trackListener('e2');
        }
      },
    };
    const mismatches: string[] = [];
    let follower: Follower;
    host.play();
    const room = new HostRoom(
      { send: (m) => clock.setTimeout(() => follower.receive(wire(m), clock.t), 5), now: () => clock.t, player: host, timers: clock },
      { sessionId: 's', item: queue.entries[0]!.item, stream: null, onlyHostControls: false, kind: 'audio', queue: rq },
    );
    follower = new Follower({
      send: (m) => clock.setTimeout(() => room.receive('g', wire(m), clock.t), 5),
      now: () => clock.t,
      timers: clock,
      onTrackMismatch: (t) => mismatches.push(t),
    });
    follower.start('g', []);
    clock.advance(500);
    expect(follower.queue).toEqual(queue);
    expect(follower.groupTrack).toBe('e1');
    follower.attach(guest, false);
    clock.advance(3000);
    expect(Math.abs(host.position() - guest.position())).toBeLessThan(0.06);
    // The guest presses Next: the host moves; the guest is told to move too.
    follower.request({ action: 'next' });
    clock.advance(1000);
    expect(host.key).toBe('e2');
    expect(follower.groupTrack).toBe('e2');
    expect(mismatches).toContain('e2');
    // The guest moves; the follower corrects again.
    guest.key = 'e2';
    guest.seek(positionAt(follower.groupAnchor!, clock.t));
    clock.advance(4000);
    expect(Math.abs(host.position() - guest.position())).toBeLessThan(0.06);
  });

  it('waits for the gapless change near the end of the track', () => {
    expect(waitForGapless({ queue, playerTrack: 'e1', groupTrack: 'e2', remaining: 0.8, rate: 1 })).toBe(1300);
    expect(waitForGapless({ queue, playerTrack: 'e1', groupTrack: 'e2', remaining: 30, rate: 1 })).toBeNull();
    expect(waitForGapless({ queue, playerTrack: 'e2', groupTrack: 'e1', remaining: 0.5, rate: 1 })).toBeNull();
    expect(waitForGapless({ queue: null, playerTrack: 'e1', groupTrack: 'e2', remaining: 0.5, rate: 1 })).toBeNull();
  });
});
