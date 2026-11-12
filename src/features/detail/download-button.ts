/**
 * The Download button of an item page (movie, episode, album, playlist,
 * season, show): its icon, label and screen-reader words for each download
 * state. A container (album, playlist) counts its items while it downloads
 * ("3 of 12"), like a music app; a single item shows its percent.
 *
 * What a press does stays with the item action (download, open Downloads,
 * or remove with a confirm). Pure, so it is unit-tested.
 */
import type { CollectionCounts, DownloadStatus } from '@/downloads';

export type DownloadButtonTint = 'success' | 'danger' | null;

export interface DownloadButtonView {
  icon: 'arrow.down.circle' | 'arrow.down.circle.fill' | 'exclamationmark.triangle';
  label: string;
  a11y: string;
  tint: DownloadButtonTint;
  /** A progress ring around the button, 0..1, while it downloads or waits. */
  ring?: number;
}

export function downloadButtonView(st: DownloadStatus, counts: CollectionCounts | null): DownloadButtonView {
  switch (st.state) {
    case 'none':
      return { icon: 'arrow.down.circle', label: 'Download', a11y: 'Download', tint: null };
    case 'completed':
      return {
        icon: 'arrow.down.circle.fill',
        label: 'Downloaded',
        a11y: counts ? `Downloaded, ${counts.total} ${counts.total === 1 ? 'item' : 'items'}. Remove the download` : 'Downloaded. Remove the download',
        tint: 'success',
      };
    case 'failed':
      if (st.missing) return { icon: 'arrow.down.circle', label: 'Download again', a11y: 'The downloaded file is missing. Download it again', tint: 'danger' };
      return {
        icon: 'exclamationmark.triangle',
        label: 'Failed',
        a11y: counts ? `Download failed, ${counts.done} of ${counts.total} downloaded. Open Downloads` : 'Download failed. Open Downloads',
        tint: 'danger',
      };
    default: {
      const pct = Math.round(st.progress * 100);
      const label = st.state === 'paused' ? 'Paused' : counts ? `${counts.done} of ${counts.total}` : `${pct}%`;
      const what = st.state === 'paused' ? 'Download paused' : st.state === 'queued' ? 'Waiting to download' : 'Downloading';
      const a11y = counts ? `${what}, ${counts.done} of ${counts.total} downloaded. Open Downloads` : `${what}, ${pct} percent. Open Downloads`;
      return { icon: 'arrow.down.circle', label, a11y, tint: null, ring: st.progress };
    }
  }
}
