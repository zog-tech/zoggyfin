/**
 * The one entry point for downloads of extension media: the Download button
 * of an entry page and the Download row of an entry's long press menu call
 * `downloadMedia`, and nothing else.
 *
 * It reads the download description at `target.media.download`, lets the
 * user pick an option when the description has some, then starts the
 * download. The callers show Download only when the entry has
 * `media.download`, the user's `downloads` grant is on (`hasGrant`) and the
 * platform saves files (`features.downloads`).
 */
import type { DetailDescription, FeedEntry } from '@/extensions/feeds';
import { askChoice } from '@/extensions/prompts';
import type { InstalledExtension } from '@/extensions/store';
import { toast } from '@/lib/toast';

/**
 * Downloads the media of a feed entry or of a detail description
 * (`target.media`, with a `download` URL on the extension's origin).
 * `target.title` and `target.imageUrl` name the download while its
 * description loads.
 */
export async function downloadMedia(extension: InstalledExtension, target: FeedEntry | DetailDescription): Promise<void> {
  const media = target.media;
  if (!media?.download) return;
  // Loaded on first use: a page does not load the download manager (and its storage) before.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { downloadExtensionMedia, extensionDownloadOptions } = require('@/downloads') as typeof import('@/downloads');
  const title = target.title || extension.manifest.name;
  const facts = target as { subtitle?: string; eyebrow?: string };
  // A description with options needs a choice first; an empty list means one file.
  const listed = await extensionDownloadOptions({ extension, download: media.download });
  if (!listed.ok) {
    toast(listed.error, { icon: 'exclamationmark.triangle' });
    return;
  }
  let option: string | undefined;
  if (listed.options.length) {
    const picked = await askChoice({ title: 'Download quality', load: async () => listed.options.map((o) => ({ value: o.id, label: o.label })) });
    if (!picked) return;
    option = picked;
  }
  const r = await downloadExtensionMedia({
    extension, mediaId: media.id, download: media.download, playback: media.playback, kind: media.kind,
    title, subtitle: facts.subtitle ?? facts.eyebrow, image: target.imageUrl, duration: media.duration, option,
  });
  toast(r.ok ? `Downloading ${title}` : r.error, { icon: r.ok ? 'arrow.down.circle' : 'exclamationmark.triangle' });
}
