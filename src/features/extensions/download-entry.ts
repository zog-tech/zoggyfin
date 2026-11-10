/**
 * The one entry point for downloads of extension media: the Download button
 * of an entry page and the Download row of an entry's long press menu call
 * `downloadMedia`, and nothing else.
 *
 * Keep the signature: the downloads change replaces only the body (read the
 * download description at `target.media.download`, let the user pick an
 * option when it has some, then start the download). The callers show
 * Download only when the entry has `media.download`, the user's `downloads`
 * grant is on (`hasGrant`) and the platform saves files (`features.downloads`).
 * Until then it shows a short note.
 */
import type { DetailDescription, FeedEntry } from '@/extensions/feeds';
import type { InstalledExtension } from '@/extensions/store';
import { toast } from '@/lib/toast';

/**
 * Downloads the media of a feed entry or of a detail description
 * (`target.media`, with a `download` URL on the extension's origin).
 * `target.title` and `target.imageUrl` name the download while its
 * description loads.
 */
export async function downloadMedia(extension: InstalledExtension, target: FeedEntry | DetailDescription): Promise<void> {
  void extension;
  void target;
  toast('Downloads arrive in a later update', { icon: 'arrow.down.circle' });
}
