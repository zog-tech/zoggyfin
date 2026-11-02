/**
 * The detail page of a download from a server that is not the active one.
 * It opens from the saved item facts (item.json) with no server call. The
 * download plays from the device; actions that need its server show
 * "Switch to <server>".
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { findServer } from '@/auth/accounts';
import { useAccounts } from '@/auth/session-store';
import { Button } from '@/components/button';
import { ItemImage } from '@/components/item-image';
import { shapeFor } from '@/components/tile-shape';
import { downloadedChildren, downloads } from '@/downloads';
import { TrackRow } from '@/features/detail/rows';
import { TvScrollView } from '@/features/tv/page-scroll';
import { confirmDestructive } from '@/lib/confirm';
import { usePlayer } from '@/player';
import { createStyles, type AppTheme, font, radius, scaled, scriptStyle, spacing, type, useLayout, useStyles } from '@/theme';

import { switchAccount } from './actions';
import { useServerNames } from './use-server-names';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

const CONTAINERS = new Set(['Series', 'Season', 'MusicAlbum', 'Playlist', 'BoxSet', 'Folder']);

export function OtherServerDownloadDetail({ item, serverId }: { item: BaseItemDto; serverId: string }) {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const l = useLayout();
  const player = usePlayer();
  const accounts = useAccounts();
  const name = useServerNames()(serverId);
  const user = findServer(accounts, serverId)?.users[0];
  const container = CONTAINERS.has(item.Type ?? '');
  const children = container ? (downloadedChildren(item.Id) ?? []) : [];
  const audio = item.Type === 'MusicAlbum' || item.Type === 'Playlist' || item.MediaType === 'Audio';
  // Wide art (episodes, videos) shows 16:9, so a video thumbnail is not cut to a poster.
  const wide = !audio && (shapeFor(item) === 'thumb' || (item.PrimaryImageAspectRatio ?? 0) > 1.2);
  const width = Math.min(l.width - l.gutter * 2, scaled(audio ? 240 : wide ? 320 : 200));
  const meta = [item.Type === 'Episode' ? item.SeriesName : null, item.ProductionYear ? String(item.ProductionYear) : null, item.AlbumArtist]
    .filter(Boolean)
    .join(' · ');

  const play = (index = 0) => {
    if (!container) return player.play({ item });
    const first = children[index];
    if (!first) return;
    if (audio) player.play({ item: first, list: children, index, context: item });
    else player.play({ item: first, queue: children.slice(index + 1) });
  };

  const remove = async () => {
    const ok = await confirmDestructive(`Delete ${item.Name ?? 'this download'}?`, 'The download is removed from this device. Nothing changes on the server.', 'Delete');
    if (!ok || !item.Id) return;
    await (container ? downloads.removeGroup(item.Id) : downloads.remove(item.Id));
    if (router.canGoBack()) router.back();
  };

  return (
    <TvScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[s.content, { paddingHorizontal: l.gutter, paddingBottom: bottomPad }]}>
      <View style={s.hero}>
        <ItemImage item={item} variant={audio ? 'square' : wide ? 'landscape' : 'poster'} width={width} aspectRatio={audio ? 1 : wide ? 16 / 9 : 2 / 3} rounded={radius.lg} />
        <Text style={[s.title, scriptStyle(item.Name, s.title)]} accessibilityRole="header">
          {item.Name}
        </Text>
        {meta ? <Text style={s.meta}>{meta}</Text> : null}
      </View>
      <View style={s.note} accessibilityRole="text">
        <Text style={s.noteText}>{`Downloaded from ${name}. It plays from this device. Other actions need ${name}.`}</Text>
      </View>
      <View style={s.buttons}>
        <Button title="Play" icon="play.fill" onPress={() => play(0)} disabled={container && !children.length} />
        {user ? <Button title={`Switch to ${name}`} variant="tonal" icon="server.rack" onPress={() => switchAccount({ serverId, userId: user.userId })} /> : null}
        <Button title="Delete download" variant="tonal" icon="trash" onPress={() => void remove()} />
      </View>
      {item.Overview ? <Text style={s.overview}>{item.Overview}</Text> : null}
      {children.length ? (
        <View style={s.list}>
          {children.map((c, i) => (
            <TrackRow key={c.Id ?? i} item={c} index={i} showArt={!audio} last={i === children.length - 1} onPress={() => play(i)} />
          ))}
        </View>
      ) : null}
    </TvScrollView>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  content: { paddingBottom: spacing.huge * 2, gap: spacing.lg },
  hero: { alignItems: 'center' as const, gap: spacing.sm, paddingTop: spacing.lg },
  title: { ...font(type.title2), color: c.text, textAlign: 'center' as const, marginTop: spacing.md },
  meta: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const },
  note: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg },
  noteText: { ...font(type.subheadline), color: c.text2 },
  buttons: { gap: spacing.sm },
  overview: { ...font(type.body), color: c.text2 },
  list: { marginHorizontal: -spacing.lg },
}));
