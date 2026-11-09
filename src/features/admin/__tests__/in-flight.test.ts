import { endAction, startAction } from '../logic';

describe('actions in flight', () => {
  it('runs different actions side by side', () => {
    const a = startAction(new Set(), 'stop-1')!;
    const b = startAction(a, 'stop-2')!;
    expect([...b]).toEqual(['stop-1', 'stop-2']);
  });

  it('refuses a second run of the same action', () => {
    const a = startAction(new Set(), 'restart')!;
    expect(startAction(a, 'restart')).toBeNull();
  });

  it('keeps the other spinner when one action ends', () => {
    const both = startAction(startAction(new Set(), 'a')!, 'b')!;
    const left = endAction(both, 'a');
    expect(left.has('b')).toBe(true);
    expect(left.has('a')).toBe(false);
    expect(startAction(left, 'a')).not.toBeNull();
  });

  it('returns the same set when the id is not in flight', () => {
    const s = new Set(['a']);
    expect(endAction(s, 'x')).toBe(s);
  });
});
