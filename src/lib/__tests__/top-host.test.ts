import { createHostStack } from '../top-host';

describe('createHostStack', () => {
  it('makes the host mounted last the top one', () => {
    const s = createHostStack();
    const root = s.newId();
    s.mount('playlist', root);
    expect(s.isTop('playlist', root)).toBe(true);
    const player = s.newId();
    s.mount('playlist', player);
    expect(s.isTop('playlist', root)).toBe(false);
    expect(s.isTop('playlist', player)).toBe(true);
  });

  it('gives the top back when the upper host goes', () => {
    const s = createHostStack();
    const root = s.newId();
    s.mount('playlist', root);
    const player = s.newId();
    s.mount('playlist', player);
    s.unmount('playlist', player);
    expect(s.isTop('playlist', root)).toBe(true);
    expect(s.isTop('playlist', player)).toBe(false);
  });

  it('keeps the names apart', () => {
    const s = createHostStack();
    const a = s.newId();
    s.mount('playlist', a);
    const b = s.newId();
    s.mount('quality', b);
    expect(s.isTop('playlist', a)).toBe(true);
    expect(s.isTop('quality', b)).toBe(true);
    expect(s.isTop('quality', a)).toBe(false);
  });

  it('has no top before a host is mounted', () => {
    const s = createHostStack();
    expect(s.isTop('playlist', 0)).toBe(false);
  });

  it('tells its listeners about each change, and only real ones', () => {
    const s = createHostStack();
    const seen = jest.fn();
    const stop = s.subscribe(seen);
    const id = s.newId();
    s.mount('playlist', id);
    s.unmount('playlist', id);
    s.unmount('playlist', id);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    s.mount('playlist', s.newId());
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
