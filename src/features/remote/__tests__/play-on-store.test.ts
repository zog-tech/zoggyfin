import { beginPlayOn, closePlayOn, endPlayOn, openPlayOn, usePlayOn } from '../play-on-store';

const phase = () => usePlayOn.getState().phase;

beforeEach(() => closePlayOn());

describe('play on sheet', () => {
  it('opens only for an item with an Id', () => {
    openPlayOn({ Name: 'no id' });
    expect(phase().name).toBe('closed');
    openPlayOn({ Id: 'a' });
    expect(phase()).toMatchObject({ name: 'choosing', item: { Id: 'a' } });
  });

  it('closes on success and goes back to choosing on a failure', () => {
    openPlayOn({ Id: 'a' });
    let run = beginPlayOn('tv')!;
    expect(beginPlayOn('phone')).toBeNull();
    expect(endPlayOn(run.token, false)).toBe(true);
    expect(phase().name).toBe('choosing');
    run = beginPlayOn('tv')!;
    expect(endPlayOn(run.token, true)).toBe(true);
    expect(phase().name).toBe('closed');
  });

  it('a late result after Cancel does not close the next open', () => {
    openPlayOn({ Id: 'a' });
    const old = beginPlayOn('tv')!;
    closePlayOn();
    openPlayOn({ Id: 'b' });
    expect(endPlayOn(old.token, true)).toBe(false);
    expect(phase()).toMatchObject({ name: 'choosing', item: { Id: 'b' } });
  });
});
