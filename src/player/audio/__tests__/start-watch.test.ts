import { START_MAX_KICKS, START_WATCH_MS, startVerdict, type StartStatus, type StartWatch } from '../start-watch';

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
});
