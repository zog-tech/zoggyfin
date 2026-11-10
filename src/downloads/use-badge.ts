/** The Downloads badge from the downloads store (rule: `badge.ts`). */
import { downloadsBadge } from './badge';
import { useDownloadsStore } from './store';

export function useDownloadsBadge(): string | null {
  return useDownloadsStore((s) => downloadsBadge(Object.values(s.records)));
}
