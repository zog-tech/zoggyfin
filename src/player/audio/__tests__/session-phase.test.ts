import { resumedByItself, type SessionPhase, transition } from '../session-phase';

const status = (o: Partial<{ playing: boolean; buffering: boolean; loaded: boolean; finished: boolean }>) => ({
  type: 'status' as const,
  playing: false,
  buffering: false,
  loaded: true,
  finished: false,
  ...o,
});

describe('audio session phase', () => {
  it('a pause the app did not ask for loses the session', () => {
    expect(transition('playing', status({ playing: false }))).toBe('lost');
  });

  it('buffering, a track that is not loaded and the end of the queue do not lose it', () => {
    expect(transition('playing', status({ buffering: true }))).toBe('playing');
    expect(transition('playing', status({ loaded: false }))).toBe('playing');
    expect(transition('playing', status({ finished: true }))).toBe('idle');
  });

  it("the app's own pause does not lose it, and a pause keeps a lost session lost", () => {
    expect(transition('playing', { type: 'pause' })).toBe('idle');
    expect(transition('idle', status({ playing: false }))).toBe('idle');
    expect(transition('lost', { type: 'pause' })).toBe('lost');
  });

  it('restoring makes a lost session idle; a play makes it playing', () => {
    expect(transition('lost', { type: 'restored' })).toBe('idle');
    expect(transition('idle', { type: 'play' })).toBe('playing');
    expect(transition('lost', { type: 'play' })).toBe('playing');
  });

  it('a player that plays again by itself after a loss is detected', () => {
    const next = transition('lost', status({ playing: true }));
    expect(next).toBe('playing');
    expect(resumedByItself('lost', next)).toBe(true);
    expect(resumedByItself('idle', transition('idle', status({ playing: true })))).toBe(false);
  });

  it('returns the same value when an event does not apply', () => {
    const phases: SessionPhase[] = ['idle', 'playing'];
    for (const p of phases) expect(transition(p, { type: 'restored' })).toBe(p);
    expect(transition('playing', { type: 'play' })).toBe('playing');
    expect(transition('idle', { type: 'pause' })).toBe('idle');
  });
});
