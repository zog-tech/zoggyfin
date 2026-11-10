/**
 * The store writes both keys on a save: the v3 snapshot, and the v2 copy of
 * the Jellyfin records under the old key (downgrade safety, `migrate.ts`).
 */
const mockKv = new Map<string, string>();
jest.mock('@/storage/json', () => ({
  readJson: (k: string, fb: unknown) => (mockKv.has(k) ? JSON.parse(mockKv.get(k)!) : fb),
  writeJson: (k: string, v: unknown) => void mockKv.set(k, JSON.stringify(v)),
}));

// eslint-disable-next-line import/first
import { putRecord, STORE_KEY, STORE_KEY_V3 } from '../store';
// eslint-disable-next-line import/first
import { rec } from '../test-utils/fixtures';

it('saves the v3 snapshot and a v2 copy with the Jellyfin records only', () => {
  putRecord(rec({ itemId: 'song-1' }));
  putRecord(rec({ itemId: 'ext:org.example.media:e1', source: { kind: 'extension', extId: 'org.example.media', mediaId: 'e1', account: 'server-1.user-1', download: 'https://media.example.org/d', title: 'An entry' } }));
  const v3 = JSON.parse(mockKv.get(STORE_KEY_V3)!);
  const v2 = JSON.parse(mockKv.get(STORE_KEY)!);
  expect(v3.schemaVersion).toBe(3);
  expect(Object.keys(v3.records).sort()).toEqual(['ext:org.example.media:e1', 'song-1']);
  expect(v2.schemaVersion).toBe(2);
  expect(Object.keys(v2.records)).toEqual(['song-1']);
  expect(v2.records['song-1'].schemaVersion).toBe(2);
});
