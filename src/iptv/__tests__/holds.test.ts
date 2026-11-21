import { createChannelHolds } from '../holds';

function rig(lite = true) {
  const timers: { fn: () => void; ms: number }[] = [];
  const release = jest.fn();
  const state = { lite };
  const holds = createChannelHolds({
    release,
    enabled: () => state.lite,
    delayMs: 100,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const fire = () => timers.splice(0).forEach((t) => t.fn());
  return { holds, release, fire, timers, state };
}

describe('createChannelHolds', () => {
  it('releases the lists after the last page leaves, in Lite mode', () => {
    const { holds, release, fire } = rig();
    const a = holds.hold();
    const b = holds.hold();
    a();
    fire();
    expect(release).not.toHaveBeenCalled();
    b();
    fire();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the lists when a page comes back within the wait', () => {
    const { holds, release, fire, timers } = rig();
    holds.hold()();
    expect(timers).toHaveLength(1);
    const again = holds.hold();
    expect(timers).toHaveLength(0);
    fire();
    expect(release).not.toHaveBeenCalled();
    again();
  });

  it('does nothing outside Lite mode, and an end called twice counts once', () => {
    const off = rig(false);
    off.holds.hold()();
    off.holds.idle();
    off.fire();
    expect(off.release).not.toHaveBeenCalled();

    const { holds, release, fire } = rig();
    const a = holds.hold();
    const b = holds.hold();
    a();
    a();
    fire();
    expect(release).not.toHaveBeenCalled();
    b();
    fire();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases after a background job when no page holds the lists', () => {
    const { holds, release, fire } = rig();
    holds.idle();
    fire();
    expect(release).toHaveBeenCalledTimes(1);
    const page = holds.hold();
    holds.idle();
    fire();
    expect(release).toHaveBeenCalledTimes(1);
    page();
  });
});
