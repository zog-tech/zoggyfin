/**
 * The choices of the "Download quality" sheet for one video item. Pure, so
 * it is unit-tested.
 *
 * Rules:
 *   - "Original" always shows, with the file size when the server sent it.
 *   - 1080p, 720p and 480p show only when they are below the source's video
 *     height (a smaller copy of a 720p file at 1080p is the same file). With
 *     no known height, all three show.
 *   - A smaller copy shows an estimate: the same video bitrate as the
 *     download would ask for (`videoPlan`: the cap, or the source bitrate
 *     when that is lower) plus 192 kbps audio, times the runtime. With no
 *     runtime, or no media source data at all, there is no size.
 *   - The selected choice is the global "Download quality" setting, or
 *     Original when that height is not offered.
 */
import type { BaseItemDto } from '@/api/types';
import { formatBytes } from '@/lib/format';

import { DOWNLOAD_QUALITY_OPTIONS, isContainer, mediaKindOf, transcodeBitrate } from './plan';
import type { DownloadQuality } from './types';

/** The audio bitrate of a transcoded download (see `videoPlan`). */
const AUDIO_BITRATE = 192_000;

export interface QualityChoice {
  value: DownloadQuality;
  label: string;
  /** The file size, or an estimate ("about 1.2 GB"); null when unknown. */
  detail: string | null;
  bytes: number | null;
}

export interface QualityChoices {
  choices: QualityChoice[];
  selected: DownloadQuality;
}

type ItemFacts = Pick<BaseItemDto, 'MediaSources' | 'RunTimeTicks'>;

/**
 * True when Download asks for the quality: a single video item, not a
 * container or audio, with a smaller copy to offer. A film that is already
 * 480p has only Original, so it downloads at once.
 */
export function asksDownloadQuality(item: Pick<BaseItemDto, 'Type' | 'MediaType' | 'MediaSources' | 'RunTimeTicks'>): boolean {
  return !isContainer(item) && mediaKindOf(item) === 'video' && downloadQualityChoices(item, 0).choices.length > 1;
}

export function downloadQualityChoices(item: ItemFacts, defaultQuality: DownloadQuality): QualityChoices {
  const source = item.MediaSources?.[0];
  const height = source?.MediaStreams?.find((s) => s.Type === 'Video')?.Height ?? 0;
  const runtime = source?.RunTimeTicks ?? item.RunTimeTicks ?? 0;
  const seconds = source && runtime > 0 ? runtime / 10_000_000 : 0;
  const sourceBitrate = source?.Bitrate ?? 0;
  const size = source?.Size ?? 0;

  const choices: QualityChoice[] = [];
  for (const o of DOWNLOAD_QUALITY_OPTIONS) {
    if (o.value === 0) {
      choices.push({ value: 0, label: o.label, detail: size > 0 ? formatBytes(size) : null, bytes: size > 0 ? size : null });
      continue;
    }
    if (height > 0 && o.value >= height) continue;
    const cap = transcodeBitrate(o.value);
    const video = sourceBitrate > 0 ? Math.min(cap, sourceBitrate) : cap;
    const bytes = seconds > 0 ? Math.round(((video + AUDIO_BITRATE) * seconds) / 8) : null;
    choices.push({ value: o.value, label: o.label, detail: bytes ? `about ${formatBytes(bytes)}` : null, bytes });
  }
  const selected = choices.some((ch) => ch.value === defaultQuality) ? defaultQuality : 0;
  return { choices, selected };
}
