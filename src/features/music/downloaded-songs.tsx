/**
 * The Downloaded tab of a music library: every song on this device from the
 * active server, the newest download first. It reads the download records
 * only, so it works with no connection. Songs play from the file (the audio
 * session finds the completed download). The web and TV keep no downloads,
 * so they say so instead of showing an empty list.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { BaseItemDto } from '@/api/types';
import { ItemActionSheet } from '@/components/action-sheet';
import { EmptyState } from '@/components/states';
import { downloadsSupported, useDownloadedSongs } from '@/downloads';
import { TrackRow } from '@/features/detail/rows';
import { flashScroll, useTvPageScroll } from '@/features/tv/page-scroll';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { usePlayer } from '@/player';
import { isTV } from '@/platform/tv';
import { spacing } from '@/theme';

import { SongListHeader } from './song-list-header';

const CONTEXT: BaseItemDto = { Name: 'Downloaded' };

export function DownloadedSongs() {
  if (!downloadsSupported) {
    return (
      <EmptyState
        icon="arrow.down.circle"
        title={isTV ? 'Downloads are not on TV' : 'Downloads are not on the web'}
        message="Use the iPhone, iPad, Android or Mac app to keep songs on the device."
      />
    );
  }
  return <DownloadedList />;
}

function DownloadedList() {
  const records = useDownloadedSongs();
  const items = useMemo(() => records.map((r) => r.item), [records]);
  const player = usePlayer();
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);
  const bottomPad = useTabBottomPadding(spacing.huge * 2, { autoInset: false });
  const list = useRef<FlashListRef<BaseItemDto>>(null);
  const tvScroll = useTvPageScroll(useCallback(() => flashScroll(list.current?.getNativeScrollRef()), []));

  if (!items.length) {
    return <EmptyState icon="arrow.down.circle" title="No downloaded songs" message="Download a song, album or playlist to play it with no connection." />;
  }

  return (
    <>
      <FlashList
        ref={list}
        {...tvScroll.props}
        data={items}
        keyExtractor={(it, i) => it.Id ?? String(i)}
        renderItem={({ item, index }) => (
          <TrackRow
            item={item}
            index={index}
            showArt
            last={index === items.length - 1}
            onPress={() => player.play({ item, list: items, index, context: CONTEXT })}
            onLongPress={setMenu}
            queue="both"
          />
        )}
        ListHeaderComponent={<SongListHeader count={items.length} songs={() => items} context={CONTEXT} />}
        contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: spacing.sm }}
      />
      <ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />
    </>
  );
}
