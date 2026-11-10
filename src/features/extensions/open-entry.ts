/**
 * Opens an extension entry in the tap order of `section-view.ts`: a
 * Jellyfin item page, the entry page, playback (`openMedia`), a panel or a
 * link in the browser. Also the rows of the long press menu.
 */
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import type { FeedEntry } from '@/extensions/feeds';
import { playRefusal } from '@/extensions/media/source';
import { getExtension, type InstalledExtension } from '@/extensions/store';
import { useOpenItem } from '@/lib/navigation';
import { toast } from '@/lib/toast';
import { features } from '@/platform/tv';
import { playMedia } from '@/player';

import { type EntryMenuId, type PlayableSource, playRequestOf } from './detail-view';
import { downloadMedia } from './download-entry';
import { entryHref, type ExtGroup, useExtGroup } from './nav';
import { entryTap } from './section-view';

/**
 * Plays the media of an entry or a detail (`media.playback`, a URL on the
 * extension's origin).
 *
 * The one entry point for extension playback: tiles, the long press menu,
 * the entry page and the panel bridge call it. It checks the user's
 * `playback` grant first and says how to turn it on; the player checks it
 * again. `startSeconds` 0 starts over; left out, the extension's resume
 * position applies.
 */
export async function openMedia(extension: InstalledExtension, entry: PlayableSource, opts: { startSeconds?: number } = {}): Promise<void> {
  const why = playRefusal(extension);
  if (why) {
    toast(why, { icon: 'exclamationmark.triangle' });
    return;
  }
  const request = playRequestOf(extension.manifest.id, entry, opts.startSeconds);
  if (!request) {
    toast(`${extension.manifest.name} sent nothing to play.`, { icon: 'exclamationmark.triangle' });
    return;
  }
  playMedia(request);
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

/** Runs a row of an entry's long press menu (`entryMenu`). */
export function runEntryMenu(extId: string, entry: FeedEntry, id: EntryMenuId, group: ExtGroup): void {
  const ext = getExtension(extId);
  if (!ext) return;
  switch (id) {
    case 'play':
      void openMedia(ext, entry);
      return;
    case 'play-start':
      void openMedia(ext, entry, { startSeconds: 0 });
      return;
    case 'open':
      if (entry.detail) router.push(entryHref(group, extId, { key: entry.key, detail: entry.detail, title: entry.title }));
      return;
    case 'download':
      void downloadMedia(ext, entry);
      return;
  }
}

/** A stable press handler for the entries of one extension, in the current stack. */
export function useOpenEntry(extId: string): (entry: FeedEntry, item?: BaseItemDto) => void {
  const group = useExtGroup();
  const openItem = useOpenItem();
  return useCallback((entry: FeedEntry, item?: BaseItemDto) => void openEntry(extId, entry, item, group, openItem), [extId, group, openItem]);
}
