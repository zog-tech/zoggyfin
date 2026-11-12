/**
 * The one download-state indicator for rows and tiles. Downloaded: an
 * arrow. Downloading or queued: a progress ring. Paused: a pause glyph.
 * Failed: a warning glyph in `danger` (never colour alone).
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { type DownloadStatus, useDownloadStatus } from '@/downloads';
import { type PopInOptions, usePopIn } from '@/lib/use-pop-in';
import { iconSize, mediaColors, scaled, sizes, useTheme } from '@/theme';

import { downloadFinished } from './download-arrival';
import { Icon } from './icon';
import { ProgressRing } from './progress-ring';

/** The words for a screen reader: "downloaded", "downloading 45 percent". */
export function downloadLabel(st: DownloadStatus): string | null {
  switch (st.state) {
    case 'completed':
      return 'downloaded';
    case 'downloading':
      return `downloading ${Math.round(st.progress * 100)} percent`;
    case 'queued':
      return 'waiting to download';
    case 'paused':
      return 'download paused';
    case 'failed':
      return 'download failed';
    default:
      return null;
  }
}

/**
 * A finished download is a rare good moment, so its glyph arrives with a
 * small overshoot (0.85 to 1) and a fade. No haptic: the user did not cause it.
 */
const ARRIVAL: PopInOptions = { from: 0.85, spring: { duration: 400, dampingRatio: 0.7 }, fade: true };

/**
 * The style for the completed glyph: it plays when this item's download
 * completes on screen, never on mount. `id` keeps a recycled cell quiet.
 */
export function useDownloadArrival(id: string | null | undefined, state: DownloadStatus['state']) {
  return usePopIn(state, downloadFinished, ARRIVAL, id);
}

/**
 * A row glyph (16 pt), next to the time or the title. Renders nothing for items that are not downloaded.
 * `status`: a row that already reads the status (for its screen-reader label) passes it, so the row
 * keeps one store subscription.
 */
export const DownloadGlyph = memo(function DownloadGlyph({ id, size = 16, status }: { id: string | null | undefined; size?: number; status?: DownloadStatus }) {
  const own = useDownloadStatus(status ? null : id);
  const st = status ?? own;
  const { c } = useTheme();
  const arrival = useDownloadArrival(id, st.state);
  if (st.state === 'none') return null;
  const s = scaled(size);
  if (st.state === 'completed') {
    return (
      <Animated.View style={arrival}>
        <Icon name="arrow.down.circle.fill" size={s} color={c.success} />
      </Animated.View>
    );
  }
  if (st.state === 'failed') return <Icon name="exclamationmark.triangle" size={s} color={c.danger} />;
  if (st.state === 'paused') return <Icon name="pause.circle" size={s} color={c.text3} />;
  return <ProgressRing size={s - 2} width={2} progress={st.progress} color={st.state === 'downloading' ? c.accent : c.text3} track={c.surface3} />;
});

/**
 * The tile badge (22 pt, black 60 %, top trailing): it takes the badge slot when an item is downloaded.
 * `id`: the item, so a recycled tile never plays the arrival of another item.
 */
export function DownloadBadge({ status, id }: { status: DownloadStatus; id?: string | null }) {
  const arrival = useDownloadArrival(id, status.state);
  if (status.state === 'none') return null;
  const box = scaled(sizes.badge);
  return (
    <View style={[styles.badge, { width: box, height: box, borderRadius: box / 2 }]} pointerEvents="none">
      {status.state === 'completed' ? (
        <Animated.View style={arrival}>
          <Icon name="arrow.down" size={iconSize.xs} color={mediaColors.white} weight="bold" />
        </Animated.View>
      ) : status.state === 'failed' ? (
        <Icon name="exclamationmark.triangle" size={iconSize.xs} color={mediaColors.white} weight="bold" />
      ) : status.state === 'paused' ? (
        <Icon name="pause.fill" size={iconSize.xs - 2} color={mediaColors.white} />
      ) : (
        <ProgressRing size={box - 6} width={2} progress={status.progress} color={mediaColors.white} track="rgba(255,255,255,0.3)" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: sizes.badgeInset,
    right: sizes.badgeInset,
    backgroundColor: mediaColors.badgeFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
