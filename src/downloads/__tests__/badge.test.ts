import { downloadsBadge } from '../badge';
import type { DownloadState } from '../types';

const recs = (...states: DownloadState[]) => states.map((state) => ({ state }));

describe('downloadsBadge', () => {
  it('is empty with no downloads or only finished ones', () => {
    expect(downloadsBadge([])).toBeNull();
    expect(downloadsBadge(recs('completed', 'paused', 'cancelled'))).toBeNull();
  });

  it('counts queued and downloading entries', () => {
    expect(downloadsBadge(recs('queued', 'downloading', 'completed', 'paused'))).toBe('2');
  });

  it('shows "!" for a failure only when nothing is active', () => {
    expect(downloadsBadge(recs('failed', 'completed'))).toBe('!');
    expect(downloadsBadge(recs('failed', 'downloading'))).toBe('1');
  });
});
