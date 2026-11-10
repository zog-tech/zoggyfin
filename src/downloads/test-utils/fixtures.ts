import { DOWNLOAD_SCHEMA_VERSION, type DownloadRecord } from '../types';

export function rec(over: Partial<DownloadRecord> = {}): DownloadRecord {
  const itemId = over.itemId ?? 'item-1';
  return {
    schemaVersion: DOWNLOAD_SCHEMA_VERSION,
    itemId,
    source: { kind: 'jellyfin' },
    serverId: 'server-1',
    userId: 'user-1',
    kind: 'audio',
    item: { Id: itemId, Name: 'Sample Song', Type: 'Audio' },
    group: { id: 'album-1', name: 'Sample Album', type: 'MusicAlbum' },
    sort: 0,
    state: 'queued',
    bytesTotal: null,
    bytesDone: 0,
    speed: 0,
    progressAt: null,
    attempts: 0,
    retryAt: null,
    error: null,
    dir: `downloads/${itemId}`,
    mediaFile: '',
    mediaSourceId: itemId,
    method: 'original',
    quality: 0,
    images: {},
    subtitles: [],
    hasLyrics: false,
    order: 0,
    createdAt: 1000,
    completedAt: null,
    ...over,
  };
}
