import {
  allowedBy,
  capabilitiesFor,
  orderByIds,
  parseMessage,
  type PlanItem,
  playPlan,
  type RemoteAction,
  supportedCommands,
  targetSupport,
  type TargetEnv,
} from '../rules';

const USER = 'aaaabbbbccccdddd1111222233334444';

const base: TargetEnv = { nativeTV: false, web: false, tvPreview: false, desktop: false, touchOnly: false, inAppVolume: false };

describe('targetSupport', () => {
  it('is off on phones and tablets', () => {
    expect(targetSupport(base)).toBeNull();
  });

  it('is off in a touch-only browser', () => {
    expect(targetSupport({ ...base, web: true, touchOnly: true, inAppVolume: true })).toBeNull();
  });

  it('is on for a TV, with mute only', () => {
    expect(targetSupport({ ...base, nativeTV: true })).toEqual({ volume: false, mute: true });
  });

  it('is on for the Mac app and a desktop browser, with the app volume', () => {
    expect(targetSupport({ ...base, web: true, desktop: true, inAppVolume: true })).toEqual({ volume: true, mute: true });
    expect(targetSupport({ ...base, web: true, inAppVolume: true })).toEqual({ volume: true, mute: true });
  });

  it('is on for the web TV preview, even on a touch screen', () => {
    expect(targetSupport({ ...base, web: true, tvPreview: true, touchOnly: true })).toEqual({ volume: false, mute: true });
  });
});

describe('capabilities', () => {
  it('lists the volume commands only with the app volume', () => {
    expect(supportedCommands({ volume: false, mute: true })).not.toContain('SetVolume');
    expect(supportedCommands({ volume: true, mute: true })).toEqual(
      expect.arrayContaining(['SetVolume', 'VolumeUp', 'VolumeDown', 'ToggleMute', 'SetAudioStreamIndex', 'DisplayMessage']),
    );
  });

  it('plays video and audio and accepts media control', () => {
    const caps = capabilitiesFor({ volume: false, mute: true }, true);
    expect(caps.PlayableMediaTypes).toEqual(['Video', 'Audio']);
    expect(caps.SupportsMediaControl).toBe(true);
  });
});

describe('parseMessage', () => {
  const msg = (MessageType: string, Data: unknown) => parseMessage({ MessageType, Data }, USER);

  it('reads a Play with a start index and position', () => {
    expect(msg('Play', { ItemIds: ['a', 'b'], StartIndex: 1, StartPositionTicks: 50, PlayCommand: 'PlayNow' })).toEqual({
      kind: 'play',
      command: 'PlayNow',
      itemIds: ['a', 'b'],
      startIndex: 1,
      startPositionTicks: 50,
    });
  });

  it('defaults a Play: PlayNow, first item, no position', () => {
    expect(msg('Play', { ItemIds: ['a'], StartIndex: 7, StartPositionTicks: 0, PlayCommand: 'Dance' })).toEqual({
      kind: 'play',
      command: 'PlayNow',
      itemIds: ['a'],
      startIndex: 0,
      startPositionTicks: undefined,
    });
  });

  it('ignores a Play with no items', () => {
    expect(msg('Play', { ItemIds: [] })).toBeNull();
    expect(msg('Play', {})).toBeNull();
  });

  it('reads every playstate command', () => {
    expect(msg('Playstate', { Command: 'Stop' })).toEqual({ kind: 'stop' });
    expect(msg('Playstate', { Command: 'Pause' })).toEqual({ kind: 'pause' });
    expect(msg('Playstate', { Command: 'Unpause' })).toEqual({ kind: 'unpause' });
    expect(msg('Playstate', { Command: 'PlayPause' })).toEqual({ kind: 'playPause' });
    expect(msg('Playstate', { Command: 'Seek', SeekPositionTicks: 120_000_000 })).toEqual({ kind: 'seek', positionTicks: 120_000_000 });
    expect(msg('Playstate', { Command: 'NextTrack' })).toEqual({ kind: 'next' });
    expect(msg('Playstate', { Command: 'PreviousTrack' })).toEqual({ kind: 'previous' });
    expect(msg('Playstate', { Command: 'Rewind' })).toEqual({ kind: 'skip', seconds: -10 });
    expect(msg('Playstate', { Command: 'FastForward' })).toEqual({ kind: 'skip', seconds: 30 });
  });

  it('ignores a seek with no position', () => {
    expect(msg('Playstate', { Command: 'Seek' })).toBeNull();
  });

  it('reads the general commands, with string arguments', () => {
    expect(msg('GeneralCommand', { Name: 'SetVolume', Arguments: { Volume: '35' } })).toEqual({ kind: 'setVolume', level: 0.35 });
    expect(msg('GeneralCommand', { Name: 'SetVolume', Arguments: { Volume: '400' } })).toEqual({ kind: 'setVolume', level: 1 });
    expect(msg('GeneralCommand', { Name: 'VolumeDown' })).toEqual({ kind: 'volumeStep', steps: -1 });
    expect(msg('GeneralCommand', { Name: 'Mute' })).toEqual({ kind: 'mute', muted: true });
    expect(msg('GeneralCommand', { Name: 'Unmute' })).toEqual({ kind: 'mute', muted: false });
    expect(msg('GeneralCommand', { Name: 'ToggleMute' })).toEqual({ kind: 'mute', muted: 'toggle' });
    expect(msg('GeneralCommand', { Name: 'SetAudioStreamIndex', Arguments: { Index: '2' } })).toEqual({ kind: 'audioTrack', index: 2 });
    expect(msg('GeneralCommand', { Name: 'SetSubtitleStreamIndex', Arguments: { Index: '-1' } })).toEqual({ kind: 'subtitleTrack', index: null });
    expect(msg('GeneralCommand', { Name: 'SetSubtitleStreamIndex', Arguments: { Index: '3' } })).toEqual({ kind: 'subtitleTrack', index: 3 });
    expect(msg('GeneralCommand', { Name: 'DisplayMessage', Arguments: { Header: 'Hi', Text: 'Dinner is ready' } })).toEqual({
      kind: 'message',
      text: 'Hi: Dinner is ready',
    });
  });

  it('ignores unknown and malformed commands silently', () => {
    expect(msg('GeneralCommand', { Name: 'GoHome' })).toBeNull();
    expect(msg('GeneralCommand', { Name: 'SetVolume', Arguments: { Volume: 'loud' } })).toBeNull();
    expect(msg('GeneralCommand', { Name: 'DisplayMessage', Arguments: {} })).toBeNull();
    expect(msg('Playstate', { Command: 'Jump' })).toBeNull();
    expect(msg('Sessions', { Command: 'Stop' })).toBeNull();
    expect(msg('Playstate', null)).toBeNull();
    expect(msg('Playstate', 'Stop')).toBeNull();
  });

  it('takes commands from the same user only, in any Id form', () => {
    expect(msg('Playstate', { Command: 'Pause', ControllingUserId: 'AAAABBBB-CCCC-DDDD-1111-222233334444' })).toEqual({ kind: 'pause' });
    expect(msg('Playstate', { Command: 'Pause', ControllingUserId: 'ffff0000ffff0000ffff0000ffff0000' })).toBeNull();
  });
});

describe('allowedBy', () => {
  it('blocks the volume commands where the device did not list them', () => {
    const tv = { volume: false, mute: true };
    expect(allowedBy(tv, { kind: 'setVolume', level: 0.5 })).toBe(false);
    expect(allowedBy(tv, { kind: 'mute', muted: 'toggle' })).toBe(true);
    expect(allowedBy(tv, { kind: 'pause' })).toBe(true);
  });
});

describe('playPlan', () => {
  const song = (Id: string): PlanItem => ({ Id, Type: 'Audio', MediaType: 'Audio' });
  const film = (Id: string): PlanItem => ({ Id, Type: 'Movie', MediaType: 'Video' });
  const album: PlanItem = { Id: 'al', Type: 'MusicAlbum' };
  const isAudio = (i: PlanItem) => i.MediaType === 'Audio' || i.Type === 'MusicAlbum';
  const play = (itemIds: string[], extra: Partial<Extract<RemoteAction, { kind: 'play' }>> = {}): Extract<RemoteAction, { kind: 'play' }> => ({
    kind: 'play',
    command: 'PlayNow',
    itemIds,
    startIndex: 0,
    startPositionTicks: undefined,
    ...extra,
  });

  it('keeps the order of the ids and drops the missing ones', () => {
    expect(orderByIds([song('B'), song('a')], ['A', 'x', 'b']).map((i) => i.Id)).toEqual(['a', 'B']);
  });

  it('plays songs as a list from the start index', () => {
    const items = [song('a'), song('b'), song('c')];
    expect(playPlan(play(['a', 'b', 'c'], { startIndex: 1, startPositionTicks: 9 }), items, null, isAudio)).toEqual({
      kind: 'audio',
      item: items[1],
      list: items,
      index: 1,
      shuffle: false,
      startPositionTicks: 9,
    });
  });

  it('finds the start item when an earlier id was missing', () => {
    const items = [song('b'), song('c')];
    const plan = playPlan(play(['a', 'b', 'c'], { startIndex: 2 }), items, null, isAudio);
    expect(plan).toMatchObject({ kind: 'audio', item: items[1], index: 1 });
  });

  it('lets the player expand an album', () => {
    expect(playPlan(play(['al'], { command: 'PlayShuffle' }), [album], null, isAudio)).toEqual({
      kind: 'audio',
      item: album,
      list: null,
      index: 0,
      shuffle: true,
      startPositionTicks: undefined,
    });
  });

  it('plays video with the rest as its queue', () => {
    const items = [film('a'), film('b'), film('c')];
    expect(playPlan(play(['a', 'b', 'c'], { startPositionTicks: 5 }), items, 'audio', isAudio)).toEqual({
      kind: 'video',
      item: items[0],
      queue: [items[1], items[2]],
      startPositionTicks: 5,
    });
  });

  it('adds music to the queue that plays', () => {
    const items = [song('a'), film('f')];
    expect(playPlan(play(['a', 'f'], { command: 'PlayNext' }), items, 'audio', isAudio)).toEqual({ kind: 'queue', how: 'next', items: [items[0]] });
    expect(playPlan(play(['a'], { command: 'PlayLast' }), [song('a')], 'audio', isAudio)).toMatchObject({ kind: 'queue', how: 'last' });
  });

  it('plays a queue request now when nothing plays', () => {
    expect(playPlan(play(['a'], { command: 'PlayLast' }), [song('a')], null, isAudio)).toMatchObject({ kind: 'audio' });
  });

  it('refuses to queue video', () => {
    expect(playPlan(play(['f'], { command: 'PlayNext' }), [film('f')], 'video', isAudio)).toMatchObject({ kind: 'refuse' });
    expect(playPlan(play(['a'], { command: 'PlayNext' }), [song('a')], 'video', isAudio)).toMatchObject({ kind: 'refuse' });
  });

  it('makes an instant mix from the start item', () => {
    expect(playPlan(play(['a'], { command: 'PlayInstantMix' }), [song('a')], null, isAudio)).toEqual({ kind: 'mix', item: song('a') });
  });

  it('does nothing when the server returned no items', () => {
    expect(playPlan(play(['a']), [], null, isAudio)).toEqual({ kind: 'none' });
  });
});
