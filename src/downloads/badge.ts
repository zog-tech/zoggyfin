/**
 * The Downloads badge: the number of active downloads (queued or
 * downloading), or "!" when none is active and one has failed. The Downloads
 * tab shows it, and so does the Downloads tile in the Library grid when an
 * extension page takes the place of the Downloads tab on a phone. One rule
 * for both, so the two never disagree.
 *
 * Pure, so it is unit-tested. The hook is `useDownloadsBadge` (`use-badge.ts`).
 */
import type { DownloadState } from './types';

export function downloadsBadge(records: Iterable<{ state: DownloadState }>): string | null {
  let active = 0;
  let failed = 0;
  for (const r of records) {
    if (r.state === 'downloading' || r.state === 'queued') active++;
    else if (r.state === 'failed') failed++;
  }
  return active ? String(active) : failed ? '!' : null;
}
