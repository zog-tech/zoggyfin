/**
 * Moves the downloads of a reinstalled server (old Id) to the new server:
 * fetches the items of the new server, matches them (`relink.ts`), and
 * writes the downloads and the outbox.
 */
import type { Api } from '@jellyfin/sdk';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';

import type { BaseItemKind } from '@/api/types';

import { outboxStore } from './outbox-store';
import { buildIndex, relinkDownloads, remapOutbox } from './relink';
import { downloadsState, persist, useDownloadsStore } from './store';

/** The number of downloads of the old server, so the app asks only when there is something to move. */
export function downloadsOf(serverId: string): number {
  return Object.values(downloadsState().records).filter((r) => r.serverId === serverId && r.source?.kind !== 'extension').length;
}

export async function moveDownloadsToServer(api: Api, oldServerId: string, to: { serverId: string; userId: string }): Promise<{ moved: number; total: number }> {
  const { records } = downloadsState();
  const old = Object.values(records).filter((r) => r.serverId === oldServerId && r.source?.kind !== 'extension');
  if (!old.length) return { moved: 0, total: 0 };
  const types = [...new Set(old.map((r) => r.item.Type).filter((t): t is BaseItemKind => !!t))];
  const res = await getLibraryApi(api).getItems({
    userId: to.userId,
    recursive: true,
    includeItemTypes: types,
    fields: ['ProviderIds', 'Path'],
    enableImages: false,
    enableUserData: false,
  });
  const idx = buildIndex(res.data.Items ?? []);
  // Read again: the fetch took time, and the store may have changed.
  const now = downloadsState();
  const r = relinkDownloads(now.records, now.collections, idx, { serverId: oldServerId }, to);
  useDownloadsStore.setState({ records: r.records, collections: r.collections });
  persist(true);
  outboxStore.write(remapOutbox(outboxStore.read(), oldServerId, r.moved, to));
  return { moved: Object.keys(r.moved).length, total: r.total };
}
