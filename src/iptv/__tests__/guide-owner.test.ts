/**
 * The guide owner: one current claim per provider, a request for the same
 * address joins it, another address waits for it, and a reset drops it.
 */
import { createGuideOwner } from '../guide-owner';

const A = 'https://epg.example.com/a.xml';
const B = 'https://epg.example.com/b.xml';

describe('guide owner', () => {
  it('starts a claim when nothing runs, and joins it for the same address', async () => {
    const owner = createGuideOwner();
    const first = owner.request('p1', A);
    expect(first.kind).toBe('start');
    if (first.kind !== 'start') return;
    const second = owner.request('p1', A);
    expect(second.kind).toBe('join');
    let joined = false;
    if (second.kind === 'join') void second.done.then(() => (joined = true));
    await Promise.resolve();
    expect(joined).toBe(false);
    first.claim.end();
    await Promise.resolve();
    expect(joined).toBe(true);
    expect(owner.request('p1', A).kind).toBe('start');
  });

  it('a request for another address waits for the running claim', async () => {
    const owner = createGuideOwner();
    const first = owner.request('p1', A);
    const other = owner.request('p1', B);
    expect(other.kind).toBe('wait');
    if (first.kind !== 'start' || other.kind !== 'wait') return;
    let waited = false;
    void other.done.then(() => (waited = true));
    first.claim.end();
    await Promise.resolve();
    expect(waited).toBe(true);
    expect(owner.request('p1', B).kind).toBe('start');
  });

  it('claim takes over: the running claim becomes stale and its end leaves the new one', () => {
    const owner = createGuideOwner();
    const first = owner.request('p1', A);
    if (first.kind !== 'start') throw new Error('expected a start');
    const build = owner.claim('p1', A);
    expect(first.claim.current()).toBe(false);
    expect(build.current()).toBe(true);
    first.claim.end();
    expect(owner.request('p1', A).kind).toBe('join');
    build.end();
    expect(owner.request('p1', A).kind).toBe('start');
  });

  it('reset makes the claim stale and lets a new load start at once', () => {
    const owner = createGuideOwner();
    const first = owner.request('p1', A);
    if (first.kind !== 'start') throw new Error('expected a start');
    owner.reset('p1');
    expect(first.claim.current()).toBe(false);
    const next = owner.request('p1', A);
    expect(next.kind).toBe('start');
    first.claim.end();
    expect(next.kind === 'start' && next.claim.current()).toBe(true);
  });

  it('keeps providers apart, and resetAll drops every claim', () => {
    const owner = createGuideOwner();
    const a = owner.claim('p1', A);
    const b = owner.claim('p2', A);
    expect(a.current() && b.current()).toBe(true);
    owner.resetAll();
    expect(a.current() || b.current()).toBe(false);
  });
});
