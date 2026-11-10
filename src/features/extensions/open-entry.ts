/**
 * Opens an extension entry in the tap order of `section-view.ts`: a
 * Jellyfin item page, the entry page, playback (`openMedia`), a panel or a
 * link in the browser.
 */
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import type { FeedEntry } from '@/extensions/feeds';
import { getExtension, type InstalledExtension } from '@/extensions/store';
import { useOpenItem } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';

import { entryHref, type ExtGroup, useExtGroup } from './nav';
import { entryTap } from './section-view';

/**
 * Plays the media of an entry (`entry.media`, with a `playback` URL on the
 * extension's origin).
 *
 * The one entry point for extension playback: tiles, the entry page and
 * later the panel bridge call it. Keep the signature: the player change
 * replaces only the body (read the stream description at
 * `entry.media.playback`, then start the external source). Until then it
 * shows a short note.
 */
export async function openMedia(extension: InstalledExtension, entry: FeedEntry): Promise<void> {
  void extension;
  void entry;
  toast('Playback arrives in a later update', { icon: 'play.rectangle' });
}

/** Opens one entry. Returns false when the entry does nothing. */
export function openEntry(extId: string, entry: FeedEntry, item: BaseItemDto | undefined, group: ExtGroup, openItem: (item: BaseItemDto) => void): boolean {
  const ext = getExtension(extId);
  if (!ext) return false;
  const tap = entryTap(entry, { hasItem: !!item, panels: features.extensionPanels });
  if (!tap) return false;
  switch (tap.kind) {
    case 'item':
      if (item) openItem(item);
      return true;
    case 'detail':
      router.push(entryHref(group, extId, { key: entry.key, detail: tap.url, title: entry.title }));
      return true;
    case 'media':
      void openMedia(ext, entry);
      return true;
    case 'panel':
      router.push({ pathname: '/extension-panel', params: { ext: extId, panel: tap.panel } });
      return true;
    case 'link':
      void Linking.openURL(tap.url);
      return true;
    case 'no-panel':
      toast(`${ext.manifest.name} opens this on a phone, a tablet or a computer.`, { icon: 'info.circle' });
      return true;
  }
}

/** True when a tap on the entry does something on this platform. */
export function entryIsPressable(entry: FeedEntry, hasItem: boolean): boolean {
  return entryTap(entry, { hasItem, panels: features.extensionPanels }) !== null;
}

/** A stable press handler for the entries of one extension, in the current stack. */
export function useOpenEntry(extId: string): (entry: FeedEntry, item?: BaseItemDto) => void {
  const group = useExtGroup();
  const openItem = useOpenItem();
  return useCallback((entry: FeedEntry, item?: BaseItemDto) => void openEntry(extId, entry, item, group, openItem), [extId, group, openItem]);
}
