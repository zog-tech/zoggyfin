import { createPagerLock } from '../pager-lock';

describe('createPagerLock', () => {
  it('does nothing before a pager attaches, and stops after it detaches', () => {
    const apply = jest.fn();
    const lock = createPagerLock();
    lock.hold();
    lock.release();
    const detach = lock.attach(apply);
    detach();
    lock.hold();
    expect(apply).not.toHaveBeenCalled();
  });

  it('turns paging off on the first hold and on after the last release', () => {
    const apply = jest.fn();
    const lock = createPagerLock();
    lock.attach(apply);
    lock.hold();
    lock.hold();
    expect(apply.mock.calls).toEqual([[false]]);
    lock.release();
    expect(apply.mock.calls).toEqual([[false]]);
    lock.release();
    expect(apply.mock.calls).toEqual([[false], [true]]);
  });

  it('ignores a release with no hold', () => {
    const apply = jest.fn();
    const lock = createPagerLock();
    lock.attach(apply);
    lock.release();
    lock.hold();
    expect(apply.mock.calls).toEqual([[false]]);
  });
});
