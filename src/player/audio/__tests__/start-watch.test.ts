import { START_KICK_DELAY_MS, START_MAX_KICKS, START_STALL_KICK_MS, START_WATCH_MS, startCheckIn, startVerdict, type StartStatus, type StartWatch } from '../start-watch';

const watch = (o: Partial<StartWatch> = {}): StartWatch => ({ token: 1, kicks: 0, since: 0, ...o });
const status = (o: Partial<StartStatus> = {}): StartStatus => ({ playing: false, buffering: false, loaded: true, finished: false, ...o });

describe('start watch', () => {
  it('stops watching once sound comes', () => {
    expect(startVerdict(watch(), status({ playing: true }), 1000)).toBe('started');
  });

  it('waits while the track loads or buffers', () => {
    expect(startVerdict(watch(), status({ loaded: false }), 1000)).toBe('wait');
    expect(startVerdict(watch(), status({ buffering: true }), 1000)).toBe('wait');
  });

  it('plays again when the track is ready but silent', () => {
    expect(startVerdict(watch(), status(), 1000)).toBe('kick');
    expect(startVerdict(watch({ kicks: START_MAX_KICKS - 1 }), status(), 1000)).toBe('kick');
  });

  it('gives up after a few tries, after a long time, or at the end of the queue', () => {
    expect(startVerdict(watch({ kicks: START_MAX_KICKS }), status(), 1000)).toBe('give-up');
    expect(startVerdict(watch(), status(), START_WATCH_MS + 1)).toBe('give-up');
    expect(startVerdict(watch(), status({ finished: true }), 1000)).toBe('give-up');
  });

  it('a start that plays counts as started even after the tries ran out', () => {
    expect(startVerdict(watch({ kicks: START_MAX_KICKS }), status({ playing: true }), START_WATCH_MS * 2)).toBe('started');
  });

  it('plays again when a ready track keeps buffering with no sound (iOS waits and sends no status)', () => {
    const ready = watch({ readyAt: 1000 });
    const buffering = status({ buffering: true });
    expect(startVerdict(ready, buffering, 1000 + START_STALL_KICK_MS - 1)).toBe('wait');
    expect(startVerdict(ready, buffering, 1000 + START_STALL_KICK_MS)).toBe('kick');
    // Still loading: the ready status will come, so it waits.
    expect(startVerdict(ready, status({ loaded: false, buffering: true }), 1000 + START_STALL_KICK_MS * 5)).toBe('wait');
  });

  it('a stall counts toward the tries', () => {
    expect(startVerdict(watch({ readyAt: 0, kicks: START_MAX_KICKS }), status({ buffering: true }), START_STALL_KICK_MS)).toBe('give-up');
  });

  it('asks for a check when a ready track buffers, since no status may come', () => {
    const ready = watch({ readyAt: 1000 });
    expect(startCheckIn(ready, status({ buffering: true }), 2000)).toBe(1000 + START_STALL_KICK_MS - 2000);
    expect(startCheckIn(ready, status({ buffering: true }), 1000 + START_STALL_KICK_MS)).toBe(START_KICK_DELAY_MS);
    expect(startCheckIn(ready, status(), 2000)).toBe(START_KICK_DELAY_MS);
    expect(startCheckIn(ready, status({ playing: true }), 2000)).toBeNull();
    expect(startCheckIn(ready, status({ loaded: false }), 2000)).toBeNull();
    // Not seen ready yet: no check.
    expect(startCheckIn(watch(), status({ buffering: true }), 2000)).toBeNull();
  });
});
