import { readEntry, type FeedEntry } from '@/extensions/feeds';
import { parseManifest } from '@/extensions/schema';
import type { InstalledExtension } from '@/extensions/store';
import { rawV2 } from '@/extensions/test-utils/fixtures';

import { downloadMedia } from '../download-entry';
import { openMedia, runEntryMenu } from '../open-entry';

const mockPlayMedia = jest.fn();
const mockToast = jest.fn();
const mockPush = jest.fn();
const mockExtensions = new Map<string, InstalledExtension>();

jest.mock('@/player', () => ({ playMedia: (...a: unknown[]) => mockPlayMedia(...a) }));
jest.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => mockToast(...a) }));
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) }, useSegments: () => [] }));
jest.mock('@/lib/navigation', () => ({ useOpenItem: () => jest.fn() }));
jest.mock('@/extensions/store', () => ({ getExtension: (id: string) => mockExtensions.get(id) }));
jest.mock('@/platform/tv', () => ({ features: { extensionPanels: true, downloads: true }, isTV: false }));


const BASE = 'https://media.example.org';

function installed(grants: { playback: boolean; downloads: boolean }, permissions?: string[]): InstalledExtension {
  const r = parseManifest(permissions ? { ...rawV2, permissions } : rawV2);
  if (!r.ok) throw new Error(r.error);
  return { manifestUrl: `${BASE}/zoggyfin-extension.json`, manifest: r.manifest, enabled: true, grants: { itemPath: false, jellyfinToken: false, ...grants }, installedAt: 1 };
}

const entry = readEntry(
  { id: 'e1', title: 'An entry', progress: 0.5, detail: '/api/e1', media: { id: 'm1', duration: 60, playback: '/api/e1/play', download: '/api/e1/download' } },
  0,
  BASE,
) as FeedEntry;

beforeEach(() => {
  mockPlayMedia.mockReset();
  mockToast.mockReset();
  mockPush.mockReset();
  mockExtensions.clear();
});

describe('openMedia', () => {
  it('plays with the grant on', async () => {
    await openMedia(installed({ playback: true, downloads: true }), entry);
    expect(mockPlayMedia).toHaveBeenCalledWith({ extension: 'org.example.media', mediaId: 'm1', playback: `${BASE}/api/e1/play`, title: 'An entry', duration: 60 });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('says how to turn playback on when the grant is off', async () => {
    await openMedia(installed({ playback: false, downloads: true }), entry);
    expect(mockPlayMedia).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Playback is turned off for Example Media. Turn it on in Settings → Extensions.', expect.anything());
  });

  it('refuses an extension with no playback permission', async () => {
    await openMedia(installed({ playback: true, downloads: true }, ['network']), entry);
    expect(mockPlayMedia).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('This extension cannot play media.', expect.anything());
  });

  it('starts over with startSeconds 0', async () => {
    await openMedia(installed({ playback: true, downloads: true }), entry, { startSeconds: 0 });
    expect(mockPlayMedia.mock.calls[0][0].startSeconds).toBe(0);
  });
});

describe('long press menu rows', () => {
  it('runs Play, Play from the beginning, Open and Download', async () => {
    mockExtensions.set('org.example.media', installed({ playback: true, downloads: true }));
    runEntryMenu('org.example.media', entry, 'play', '(home)');
    runEntryMenu('org.example.media', entry, 'play-start', '(home)');
    await Promise.resolve();
    expect(mockPlayMedia.mock.calls.map((c) => c[0].startSeconds)).toEqual([undefined, 0]);
    runEntryMenu('org.example.media', entry, 'open', '(library)');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/(library)/ext/[ext]/entry/[entry]',
      params: { ext: 'org.example.media', entry: 'e1', detail: `${BASE}/api/e1`, title: 'An entry' },
    });
    runEntryMenu('org.example.media', entry, 'download', '(home)');
    await Promise.resolve();
    expect(mockToast).toHaveBeenCalledWith('Downloads arrive in a later update', expect.anything());
  });
});

describe('downloadMedia (stub)', () => {
  it('shows the note for an entry and for a detail', async () => {
    const ext = installed({ playback: true, downloads: true });
    await downloadMedia(ext, entry);
    await downloadMedia(ext, { title: 'A detail', lines: [], actions: [], sections: [] });
    expect(mockToast).toHaveBeenCalledTimes(2);
  });
});
