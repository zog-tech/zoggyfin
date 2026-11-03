import {
  canPlayRemotely,
  controllableSessions,
  deviceKind,
  mediaTypeOf,
  nowPlayingLine,
  progressAt,
  remoteCommands,
  type RemoteSession,
  seekTarget,
  seekToFraction,
  sessionDetail,
  sessionName,
  sessionsFor,
  startTicksFor,
  TICKS_PER_SECOND,
  volumeStep,
} from '../logic';

const T = TICKS_PER_SECOND;

function session(over: Partial<RemoteSession> = {}): RemoteSession {
  return {
    Id: 's1',
    DeviceId: 'dev-1',
    DeviceName: 'Living room',
    Client: 'Jellyfin Web',
    SupportsRemoteControl: true,
    SupportsMediaControl: true,
    LastActivityDate: '2026-11-02T10:00:00Z',
    ...over,
  };
}

const movie = { Id: 'm1', Name: 'Big Buck Bunny', Type: 'Movie', RunTimeTicks: 600 * T };

describe('controllableSessions', () => {
  it('keeps only remote-controllable sessions of other devices', () => {
    const list = [
      session({ Id: 'a' }),
      session({ Id: 'own', DeviceId: 'me' }),
      session({ Id: 'b', SupportsRemoteControl: false }),
      session({ Id: null }),
    ];
    expect(controllableSessions(list, 'me').map((s) => s.Id)).toEqual(['a']);
  });

  it('puts playing sessions first, then the most recently active', () => {
    const list = [
      session({ Id: 'old', LastActivityDate: '2026-11-02T09:00:00Z' }),
      session({ Id: 'new', LastActivityDate: '2026-11-02T11:00:00Z' }),
      session({ Id: 'playing', LastActivityDate: '2026-11-01T09:00:00Z', NowPlayingItem: movie }),
    ];
    expect(controllableSessions(list, null).map((s) => s.Id)).toEqual(['playing', 'new', 'old']);
  });

  it('does not change the input', () => {
    const list = [session({ Id: 'b', LastActivityDate: '2026-11-01T00:00:00Z' }), session({ Id: 'a' })];
    controllableSessions(list, null);
    expect(list.map((s) => s.Id)).toEqual(['b', 'a']);
  });
});

describe('sessionsFor and media types', () => {
  it('maps item types to a media type', () => {
    expect(mediaTypeOf({ Type: 'MusicAlbum' })).toBe('Audio');
    expect(mediaTypeOf({ Type: 'Series' })).toBe('Video');
    expect(mediaTypeOf({ Type: 'Playlist', MediaType: 'Audio' })).toBe('Audio');
  });

  it('keeps sessions that play the media type, or list none', () => {
    const list = [
      session({ Id: 'v', PlayableMediaTypes: ['Video'] }),
      session({ Id: 'a', PlayableMediaTypes: ['Audio'] }),
      session({ Id: 'any', PlayableMediaTypes: [] }),
    ];
    expect(sessionsFor(list, { Type: 'Movie' }).map((s) => s.Id)).toEqual(['v', 'any']);
    expect(sessionsFor(list, { Type: 'Audio' }).map((s) => s.Id)).toEqual(['a', 'any']);
  });

  it('offers Play on for playable items with an Id', () => {
    expect(canPlayRemotely({ Id: 'x', Type: 'Episode' })).toBe(true);
    expect(canPlayRemotely({ Id: 'x', Type: 'Person' })).toBe(false);
    expect(canPlayRemotely({ Type: 'Movie' })).toBe(false);
  });
});

describe('names', () => {
  it('names the device, else the client', () => {
    expect(sessionName(session())).toBe('Living room');
    expect(sessionName(session({ DeviceName: ' ' }))).toBe('Jellyfin Web');
    expect(sessionName(session({ DeviceName: null, Client: null }))).toBe('Unknown device');
  });

  it('spots TV clients', () => {
    expect(deviceKind(session({ DeviceName: 'Shield', Client: 'Jellyfin Android TV' }))).toBe('tv');
    expect(deviceKind(session({ DeviceName: 'Living room', Client: 'Kodi' }))).toBe('tv');
    expect(deviceKind(session({ DeviceName: 'Firefox', Client: 'Jellyfin Web' }))).toBe('device');
  });

  it('describes what plays', () => {
    expect(nowPlayingLine(session())).toBe('Nothing playing');
    expect(nowPlayingLine(session({ NowPlayingItem: movie }))).toBe('Playing Big Buck Bunny');
    expect(nowPlayingLine(session({ NowPlayingItem: movie, PlayState: { IsPaused: true } }))).toBe('Paused Big Buck Bunny');
    const ep = { Name: 'Pilot', Type: 'Episode', SeriesName: 'The Show' };
    expect(nowPlayingLine(session({ NowPlayingItem: ep }))).toBe('Playing The Show: Pilot');
    expect(sessionDetail(session())).toBe('Jellyfin Web · Nothing playing');
    expect(sessionDetail(session({ DeviceName: null }))).toBe('Nothing playing');
  });
});

describe('remoteCommands', () => {
  it('shows no playstate commands when nothing plays', () => {
    expect(remoteCommands(session())).toEqual({ playPause: false, seek: false, skip: false, stop: false, volume: false, mute: false });
  });

  it('follows CanSeek, the queue and SupportedCommands', () => {
    const s = session({
      NowPlayingItem: movie,
      PlayState: { CanSeek: true },
      NowPlayingQueue: [{}, {}],
      SupportedCommands: ['SetVolume', 'ToggleMute'],
    });
    expect(remoteCommands(s)).toEqual({ playPause: true, seek: true, skip: true, stop: true, volume: true, mute: true });
    const t = session({ NowPlayingItem: movie, PlayState: { CanSeek: false }, NowPlayingQueue: [{}], SupportedCommands: ['Mute'] });
    expect(remoteCommands(t)).toMatchObject({ playPause: true, seek: false, skip: false, volume: false, mute: true });
  });

  it('cannot seek live items with no runtime', () => {
    const s = session({ NowPlayingItem: { ...movie, RunTimeTicks: null }, PlayState: { CanSeek: true } });
    expect(remoteCommands(s).seek).toBe(false);
  });

  it('shows nothing for a session without media control', () => {
    const s = session({ SupportsMediaControl: false, NowPlayingItem: movie, SupportedCommands: ['SetVolume'] });
    expect(Object.values(remoteCommands(s)).some(Boolean)).toBe(false);
  });
});

describe('progress', () => {
  it('moves on while playing and stays still while paused', () => {
    const playing = session({ NowPlayingItem: movie, PlayState: { PositionTicks: 60 * T } });
    expect(progressAt(playing, 1000, 3000).positionTicks).toBe(62 * T);
    expect(progressAt(playing, 1000, 3000).fraction).toBeCloseTo(62 / 600);
    const paused = session({ NowPlayingItem: movie, PlayState: { PositionTicks: 60 * T, IsPaused: true } });
    expect(progressAt(paused, 1000, 3000).positionTicks).toBe(60 * T);
  });

  it('never passes the runtime and has no fraction without one', () => {
    const end = session({ NowPlayingItem: movie, PlayState: { PositionTicks: 599 * T } });
    expect(progressAt(end, 0, 10_000).positionTicks).toBe(600 * T);
    const live = session({ NowPlayingItem: { Name: 'News', RunTimeTicks: null }, PlayState: { PositionTicks: 5 * T } });
    expect(progressAt(live, 0, 0).fraction).toBeNull();
  });

  it('ignores a clock that goes back', () => {
    const s = session({ NowPlayingItem: movie, PlayState: { PositionTicks: 60 * T } });
    expect(progressAt(s, 5000, 1000).positionTicks).toBe(60 * T);
  });

  it('keeps seek targets inside the item', () => {
    expect(seekTarget(5 * T, -10, 600 * T)).toBe(0);
    expect(seekTarget(595 * T, 30, 600 * T)).toBe(600 * T);
    expect(seekTarget(60 * T, 30, 600 * T)).toBe(90 * T);
    expect(seekTarget(60 * T, 30, 0)).toBe(90 * T);
    expect(seekToFraction(0.5, 600 * T)).toBe(300 * T);
    expect(seekToFraction(2, 600 * T)).toBe(600 * T);
  });
});

describe('volume and start position', () => {
  it('steps the volume inside 0..100', () => {
    expect(volumeStep(95, 10)).toBe(100);
    expect(volumeStep(3, -10)).toBe(0);
    expect(volumeStep(null, 10)).toBe(60);
  });

  it('resumes started films and episodes only', () => {
    expect(startTicksFor({ Type: 'Movie', UserData: { PlaybackPositionTicks: 42 } })).toBe(42);
    expect(startTicksFor({ Type: 'Movie', UserData: { PlaybackPositionTicks: 0 } })).toBeUndefined();
    expect(startTicksFor({ Type: 'MusicAlbum', UserData: { PlaybackPositionTicks: 42 } })).toBeUndefined();
  });
});
