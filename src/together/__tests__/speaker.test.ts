/**
 * "Sound plays on" (speaker.ts): the pure rule, the wire messages, and a
 * host with two guests on the simulated network (room.ts + follower.ts).
 */
import { Follower } from '../follower';
import { decode, encode, type Member, type Message } from '../protocol';
import { HostRoom, MEMBERS_EVERY } from '../room';
import { keepChoice, mutedHere, muteSession, soundDevice, speakerLabel, speakerNote, validChoice } from '../speaker';
import { FakePlayer, VirtualClock } from '../test-utils/sim';

const anchor = { playing: true, rate: 1, hostTime: 10, position: 1 };
const members = [{ id: 'a' }, { id: 'b', away: true }];

describe('speaker rule', () => {
  it('every device by default', () => {
    expect(soundDevice(null, members, 'h')).toBeNull();
    expect(mutedHere(null, 'a')).toBe(false);
  });

  it('one chosen device: the others are muted', () => {
    expect(soundDevice('a', members, 'h')).toBe('a');
    expect(mutedHere('a', 'a')).toBe(false);
    expect(mutedHere('a', 'h')).toBe(true);
    expect(mutedHere('h', 'a')).toBe(true);
  });

  it('a chosen member that left gives way to the host', () => {
    expect(keepChoice('gone', members, 'h')).toBe('h');
    expect(soundDevice('gone', members, 'h')).toBe('h');
    expect(keepChoice('h', [], 'h')).toBe('h');
  });

  it('a chosen member that is away: the host plays, the choice stays', () => {
    expect(keepChoice('b', members, 'h')).toBe('b');
    expect(soundDevice('b', members, 'h')).toBe('h');
  });

  it('a session with no host id falls back to every device', () => {
    expect(soundDevice('gone', members, null)).toBeNull();
  });

  it('valid choices: every device, the host, a member that is here', () => {
    expect(validChoice(null, members, 'h')).toBe(true);
    expect(validChoice('h', members, 'h')).toBe(true);
    expect(validChoice('a', members, 'h')).toBe(true);
    expect(validChoice('b', members, 'h')).toBe(false);
    expect(validChoice('x', members, 'h')).toBe(false);
  });

  it('labels and notes', () => {
    const names = { hostName: 'Jane · iPhone', members: [{ id: 'a', name: 'Sam · iPad' }] };
    expect(speakerLabel({ target: null, selfId: 'a', hostId: 'h' }, names)).toBe('Every device');
    expect(speakerLabel({ target: 'a', selfId: 'a', hostId: 'h' }, names)).toBe('This device');
    expect(speakerLabel({ target: 'h', selfId: 'a', hostId: 'h' }, names)).toBe('Jane · iPhone');
    expect(speakerLabel({ target: 'a', selfId: 'h', hostId: 'h' }, names)).toBe('Sam · iPad');
    expect(speakerNote({ target: null, selfId: 'a', hostId: 'h' }, names)).toBe('Sound plays on every device now.');
    expect(speakerNote({ target: 'a', selfId: 'a', hostId: 'h' }, names)).toBe('Sound plays on this device now.');
  });

  it('mutes only the audio of a nearby session', () => {
    const speaker = { target: 'a', selfId: 'b', hostId: 'h' };
    expect(muteSession({ mode: 'nearby', kind: 'audio', speaker })).toBe(true);
    expect(muteSession({ mode: 'nearby', kind: 'video', speaker })).toBe(false);
    expect(muteSession({ mode: 'none', kind: 'audio', speaker: null })).toBe(false);
    expect(muteSession({ mode: 'nearby', kind: 'audio', speaker: { ...speaker, target: null } })).toBe(false);
  });
});

describe('speaker wire', () => {
  it('round-trips the message and the welcome field', () => {
    const msgs: Message[] = [
      { t: 'speaker', target: 'a' },
      { t: 'speaker', target: null },
      { t: 'speaker', target: 'h', fallback: true },
      { t: 'welcome', sessionId: 's', item: null, stream: null, onlyHostControls: false, anchor, speaker: 'a' },
    ];
    for (const m of msgs) expect(decode(encode(m))).toEqual(m);
  });

  it('drops a bad shape', () => {
    expect(decode(JSON.stringify({ v: 1, t: 'speaker', target: 3 }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'speaker', target: '' }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'speaker' }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, t: 'welcome', sessionId: 's', item: null, stream: null, onlyHostControls: false, anchor, speaker: 5 }))).toBeNull();
  });

  it('a welcome with no speaker (an older host) means every device', () => {
    const f = new Follower({ send: () => undefined, now: () => 0, timers: new VirtualClock() });
    f.receive({ t: 'speaker', target: 'a' }, 0);
    f.receive({ t: 'welcome', sessionId: 's', item: null, stream: null, onlyHostControls: false, anchor }, 0);
    expect(f.speaker).toBeNull();
  });
});

/** A listen-together host ("h") and two guests ("a", "b") with a 5 ms link. */
function car(opts: { speaker?: string | null; members?: Member[]; hostId?: string } = {}) {
  const clock = new VirtualClock();
  const wire = (m: Message) => decode(encode(m))!;
  const followers = new Map<string, Follower>();
  const hostNotes: { target: string | null; fallback: boolean }[] = [];
  const guestNotes: Record<string, { target: string | null; fallback: boolean }[]> = { a: [], b: [] };
  const room = new HostRoom(
    {
      send: (m, to) => {
        for (const peer of to ?? [...followers.keys()]) clock.setTimeout(() => followers.get(peer)?.receive(wire(m), clock.t), 5);
      },
      now: () => clock.t,
      player: new FakePlayer(clock),
      timers: clock,
      onSpeaker: (target, fallback) => hostNotes.push({ target, fallback }),
    },
    {
      sessionId: 's',
      item: { id: 't1', name: 'Track', type: 'Audio' },
      stream: null,
      onlyHostControls: false,
      kind: 'audio',
      hostId: opts.hostId ?? 'h',
      speaker: opts.speaker,
      members: opts.members,
    },
  );
  const join = (id: 'a' | 'b') => {
    const f = new Follower({
      send: (m) => clock.setTimeout(() => room.receive(id, wire(m), clock.t), 5),
      now: () => clock.t,
      timers: clock,
      onSpeaker: (target, fallback) => guestNotes[id].push({ target, fallback }),
    });
    followers.set(id, f);
    f.start(`Guest ${id}`, [], { memberId: id });
    clock.advance(50);
    return f;
  };
  return { clock, room, followers, join, hostNotes, guestNotes };
}

describe('speaker in a session', () => {
  it('every device plays until the host picks one; then every guest knows', () => {
    const c = car();
    const a = c.join('a');
    const b = c.join('b');
    expect(a.speaker).toBeNull();
    expect(c.room.setSpeaker('a')).toBe(true);
    c.clock.advance(20);
    expect(a.speaker).toBe('a');
    expect(b.speaker).toBe('a');
    expect(mutedHere(a.speaker, 'a')).toBe(false);
    expect(mutedHere(b.speaker, 'b')).toBe(true);
    expect(c.guestNotes.b).toEqual([{ target: 'a', fallback: false }]);
    // The host picks itself, then every device again.
    c.room.setSpeaker('h');
    c.clock.advance(20);
    expect(b.speaker).toBe('h');
    c.room.setSpeaker(null);
    c.clock.advance(20);
    expect(a.speaker).toBeNull();
    expect(b.speaker).toBeNull();
  });

  it('refuses a device that is not in the session', () => {
    const c = car();
    c.join('a');
    expect(c.room.setSpeaker('zzz')).toBe(false);
    expect(c.room.speaker.target).toBeNull();
  });

  it('a guest that joins later gets the choice in its welcome', () => {
    const c = car();
    c.join('a');
    c.room.setSpeaker('a');
    const b = c.join('b');
    expect(b.speaker).toBe('a');
  });

  it('the chosen device leaves: the host plays the sound and everyone hears why', () => {
    const c = car();
    const a = c.join('a');
    const b = c.join('b');
    c.room.setSpeaker('a');
    c.clock.advance(20);
    a.leave();
    c.clock.advance(MEMBERS_EVERY + 20);
    expect(c.room.speaker).toEqual({ choice: 'h', target: 'h' });
    expect(b.speaker).toBe('h');
    expect(c.guestNotes.b.at(-1)).toEqual({ target: 'h', fallback: true });
    expect(c.hostNotes.at(-1)).toEqual({ target: 'h', fallback: true });
  });

  it('the chosen device drops its link: the host plays until it comes back', () => {
    const c = car();
    c.join('a');
    const b = c.join('b');
    c.room.setSpeaker('a');
    c.clock.advance(20);
    c.room.removeMember('a');
    c.clock.advance(20);
    expect(c.room.speaker).toEqual({ choice: 'a', target: 'h' });
    expect(b.speaker).toBe('h');
    expect(c.guestNotes.b.at(-1)?.fallback).toBe(true);
    // It comes back: the sound goes back to it.
    const a2 = c.join('a');
    c.clock.advance(20);
    expect(a2.speaker).toBe('a');
    expect(b.speaker).toBe('a');
  });

  it('a host that changes nothing sends nothing', () => {
    const c = car();
    c.join('a');
    c.room.setSpeaker('a');
    c.clock.advance(20);
    const notes = c.guestNotes.a.length;
    c.room.setSpeaker('a');
    c.room.receive('a', { t: 'buffering', buffering: true, local: false }, c.clock.t);
    c.clock.advance(MEMBERS_EVERY + 20);
    expect(c.guestNotes.a.length).toBe(notes);
  });

  it('a new host keeps the choice of a member, and takes the sound when the old host had it', () => {
    const away: Member[] = [{ id: 'b', name: 'Guest b', local: false }];
    const kept = car({ hostId: 'a', speaker: 'b', members: away });
    // "b" is away until it comes back to the new host.
    expect(kept.room.speaker).toEqual({ choice: 'b', target: 'a' });
    const b = kept.join('b');
    expect(b.speaker).toBe('b');

    const oldHost = car({ hostId: 'a', speaker: 'h', members: away });
    expect(oldHost.room.speaker).toEqual({ choice: 'a', target: 'a' });
  });
});
