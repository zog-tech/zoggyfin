/**
 * A playlist page: play and shuffle, download, rename and delete (in More),
 * swipe left on an entry to remove it, and Reorder mode to drag entries
 * (TV: a Move menu on each entry).
 * Audio and video playlists. Reorder and remove are optimistic (ops.ts).
 */
import { Stack } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import { useChildren } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { ItemActionSheet } from '@/components/action-sheet';
import { DownloadGlyph } from '@/components/download-indicator';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { ReorderList } from '@/components/reorder-list';
import { ErrorState, LoadingState } from '@/components/states';
import { SwipeRow } from '@/components/swipe-row';
import { Touchable } from '@/components/touchable';
import { canQueue, useQueueSwipe } from '@/features/actions/queue-swipe';
import { openRenamePlaylist } from '@/features/playlists/add-to-playlist';
import { moveItem, removeItems } from '@/features/playlists/ops';
import { episodeLabel, formatClock, formatDuration } from '@/lib/format';
import { rowSwipeScreenOptions } from '@/lib/stack-options';
import { features, isTV } from '@/platform/tv';
import { isAudioItem, usePlayer } from '@/player';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, scriptStyle, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { DetailScaffold } from './detail-scaffold';
import { TrackRow } from './rows';

const EDIT_ROW = 64;

interface ViewProps {
  item: BaseItemDto;
  onRefresh: () => unknown;
}

function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function PlaylistDetail({ item, onRefresh }: ViewProps) {
  const entries = useChildren(item.Id ?? undefined, 'playlist');
  const player = usePlayer();
  const s = useStyles(makeStyles);
  const l = useLayout();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<BaseItemDto | undefined>(undefined);
  const list = entries.data ?? [];
  const audio = list.length ? list.every(isAudioItem) : item.MediaType !== 'Video';
  const totalTicks = list.reduce((sum, t) => sum + (t.RunTimeTicks ?? 0), 0);
  const playlistId = item.Id ?? '';

  const playFrom = (index: number, from: BaseItemDto[] = list) => {
    const first = from[index];
    if (!first) return;
    if (audio) player.play({ item: first, list: from, index, context: item });
    else player.play({ item: first, queue: from.slice(index + 1) });
  };

  const remove = (entry: BaseItemDto) => void removeItems(playlistId, [entry]);
  const queueSwipe = useQueueSwipe();

  // Swipe left removes the entry; a song also gets "Add to queue" on a swipe right.
  const row = (t: BaseItemDto, i: number) => (
    <SwipeRow
      key={t.PlaylistItemId ?? `${t.Id}-${i}`}
      onSwipe={() => remove(t)}
      label="Remove"
      leading={canQueue(t) ? queueSwipe.addToQueue(t) : undefined}
      enabled={features.touchGestures}>
      <TrackRow item={t} index={i} showArt last={i === list.length - 1} onPress={() => playFrom(i)} onLongPress={setMenu} queue="add" />
    </SwipeRow>
  );

  return (
    <>
      <Stack.Screen options={rowSwipeScreenOptions} />
      <DetailScaffold
        item={item}
        meta={[
          audio ? 'Playlist' : 'Video playlist',
          list.length ? `${list.length} ${list.length === 1 ? 'item' : 'items'}` : null,
          formatDuration(totalTicks),
        ]}
        playable
        onPlay={() => playFrom(0)}
        onShuffle={() => playFrom(0, shuffled(list))}
        extraActions={[
          { icon: editing ? 'checkmark' : 'line.3.horizontal', label: editing ? 'Done' : 'Reorder', onPress: () => setEditing((e) => !e) },
          { icon: 'pencil', label: 'Rename', onPress: () => openRenamePlaylist(item) },
        ]}
        onRefresh={() => Promise.all([onRefresh(), entries.refetch()])}
        footer={<ItemActionSheet item={menu} visible={!!menu} onClose={() => setMenu(undefined)} />}
        beforeRows={
          <View style={{ marginTop: spacing.xl }}>
            {entries.isPending ? <LoadingState rows={6} /> : null}
            {entries.error && !entries.data ? <ErrorState error={entries.error} onRetry={entries.refetch} compact /> : null}
            {entries.data && list.length === 0 ? (
              <Text style={[s.message, { paddingHorizontal: l.gutter }]}>This playlist is empty. Use “Add to playlist” on any song or video.</Text>
            ) : null}
            {editing && list.length ? (
              <>
                <Text style={[s.hint, { paddingHorizontal: l.gutter }]}>
                  {isTV
                    ? 'Select the arrows on an entry to move it. Select the bin to remove it.'
                    : 'Drag the handles to change the order. Tap the bin to remove an entry.'}
                </Text>
                <ReorderList
                  rows={list}
                  rowKey={(t, i) => t.PlaylistItemId ?? `${t.Id}-${i}`}
                  rowHeight={EDIT_ROW}
                  label={(t) => t.Name ?? 'item'}
                  onMove={(from, to) => void moveItem(playlistId, from, to)}
                  renderRow={(t, _i, handle) => <EditRow item={t} handle={handle} onRemove={() => remove(t)} />}
                />
              </>
            ) : null}
          </View>
        }
        rows={editing ? [] : list}
        rowKey={(t, i) => t.PlaylistItemId ?? t.Id ?? String(i)}
        renderRow={row}
      />
    </>
  );
}

function EditRow({ item, handle, onRemove }: { item: BaseItemDto; handle: ReactNode; onRemove: () => void }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const { c } = useTheme();
  const sub = item.Type === 'Episode' ? [item.SeriesName, episodeLabel(item)].filter(Boolean).join(' · ') : (item.Artists?.join(', ') ?? item.AlbumArtist);
  return (
    <View style={[s.editRow, { paddingLeft: l.gutter, paddingRight: l.gutter - spacing.sm }]}>
      <ItemImage item={item} variant="square" width={scaled(44)} aspectRatio={1} rounded={radius.sm} hideArtTitle />
      <View style={s.flex}>
        <Text style={[s.title, scriptStyle(item.Name, s.title)]} numberOfLines={1}>
          {item.Name}
        </Text>
        {sub ? (
          <Text style={[s.sub, { color: c.text2 }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <DownloadGlyph id={item.Id} />
      <Text style={s.time}>{formatClock(item.RunTimeTicks)}</Text>
      {/* Remove works with a pointer, a remote and VoiceOver; swipe is touch only. */}
      <Touchable onPress={onRemove} radius={radius.pill} hitSlop={6} style={s.remove} accessibilityRole="button" accessibilityLabel={`Remove ${item.Name ?? 'item'}`}>
        <Icon name="trash" size={scaled(iconSize.sm)} color={c.danger} />
      </Touchable>
      {handle}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1, minWidth: 0 },
  message: { ...font(type.subheadline), color: c.text2, marginTop: spacing.md },
  hint: { ...font(type.footnote), color: c.text2, marginBottom: spacing.sm },
  editRow: {
    height: EDIT_ROW,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderBottomWidth: sizes.hairline,
    borderBottomColor: c.separator,
  },
  title: { ...font(type.callout), color: c.text },
  sub: { ...font(type.footnote), marginTop: 1 },
  remove: { width: scaled(36), height: scaled(36), alignItems: 'center' as const, justifyContent: 'center' as const },
  time: { ...font(type.footnote, { tabular: true }), color: c.text3, minWidth: scaled(38), textAlign: 'right' as const },
}));
