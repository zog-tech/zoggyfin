/**
 * The "Add to playlist" sheet (design system §7.12) and the rename sheet.
 * One host at the root; any screen opens them with `openAddToPlaylist` or
 * `openRenamePlaylist`. Two taps from any item: "Add to playlist", then a
 * playlist (or "New playlist", a name, Return). The phases and the rule
 * that a late request never acts on a newer open are in `sheet-store.ts`.
 */
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';

import * as jf from '@/api/jellyfin';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { ErrorState } from '@/components/states';
import { TvScrollView } from '@/features/tv/page-scroll';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, spacing, type, useStyles, useTheme, webInput } from '@/theme';

import { fits, playlistMediaFor, sheetOrder } from './logic';
import { addItems, createWith, recentPlaylistIds, rename } from './ops';
import { beginAdd, beginRename, closeAddSheet, closeRenameSheet, endAdd, endRename, startNaming, useSheets } from './sheet-store';

export { openAddToPlaylist, openRenamePlaylist } from './sheet-store';

function success() {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function AddToPlaylistHost() {
  return (
    <>
      <AddSheet />
      <RenameSheet />
    </>
  );
}

function AddSheet() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { api, userId, scope } = useApi();
  const phase = useSheets((st) => st.add);
  const items = phase.name === 'closed' ? null : phase.items;
  const token = phase.name === 'closed' ? 0 : phase.token;
  const target = phase.name === 'submitting' ? phase.target : null;
  const naming = phase.name === 'naming' || (phase.name === 'submitting' && phase.back === 'naming');
  const media = playlistMediaFor(items ?? []);
  const q = useQuery({
    queryKey: queryKeys.playlists(scope, media),
    queryFn: () => jf.getPlaylists(api, userId),
    enabled: !!items,
    staleTime: 30_000,
  });
  const [name, setName] = useState('');
  const [nameFor, setNameFor] = useState(token);
  if (token !== nameFor) {
    // A new open (or a close): start with an empty name.
    setNameFor(token);
    setName('');
  }

  const order = useMemo(() => sheetOrder((q.data ?? []).filter((p) => fits(p, media)), recentPlaylistIds()), [q.data, media]);
  const what = items?.length === 1 ? items[0]?.Name : items ? `${items.length} items` : '';

  const add = async (p: BaseItemDto) => {
    const run = beginAdd(p.Id ?? 'x');
    if (!run) return;
    const ok = await addItems(p, run.items);
    if (endAdd(run.token, ok) && ok) success();
  };
  const create = async () => {
    const run = beginAdd('new');
    if (!run) return;
    const id = await createWith(name, run.items);
    if (endAdd(run.token, !!id) && id) success();
  };

  const row = (p: BaseItemDto, last: boolean) => (
    <SheetRow key={p.Id} last={last} accessibilityLabel={`Add to ${p.Name}`} onPress={() => void add(p)}>
      <ItemImage item={p} variant="square" width={scaled(40)} aspectRatio={1} rounded={radius.sm} hideArtTitle />
      <View style={s.flex}>
        <Text style={s.rowText} numberOfLines={1}>
          {p.Name}
        </Text>
        {p.ChildCount ? <Text style={s.meta}>{`${p.ChildCount} ${p.ChildCount === 1 ? 'item' : 'items'}`}</Text> : null}
      </View>
      {target === p.Id ? <ActivityIndicator color={c.text2} /> : null}
    </SheetRow>
  );

  return (
    <Sheet visible={!!items} title={what ? `Add “${what}” to a playlist` : 'Add to playlist'} onClose={closeAddSheet} doneLabel="Cancel">
      <TvScrollView style={s.list} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.group}>
          {naming ? (
            <View style={s.newRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Playlist name"
                placeholderTextColor={c.text3}
                selectionColor={c.accent}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void create()}
                style={s.input}
                accessibilityLabel="Playlist name"
              />
              <Button title="Create" variant="small" loading={target === 'new'} onPress={() => void create()} />
            </View>
          ) : (
            <SheetRow last accessibilityLabel="New playlist" onPress={startNaming}>
              <View style={s.plus}>
                <Icon name="plus" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" />
              </View>
              <Text style={[s.rowText, { color: c.accent }]}>New playlist</Text>
            </SheetRow>
          )}
        </View>
        {q.isPending ? <ActivityIndicator style={s.loading} color={c.text2} /> : null}
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} compact /> : null}
        {order.recent.length ? (
          <>
            <Text style={s.header}>RECENT</Text>
            <View style={s.group}>{order.recent.map((p, i) => row(p, i === order.recent.length - 1))}</View>
          </>
        ) : null}
        {order.all.length ? (
          <>
            <Text style={s.header}>{order.recent.length ? 'ALL PLAYLISTS' : 'PLAYLISTS'}</Text>
            <View style={s.group}>{order.all.map((p, i) => row(p, i === order.all.length - 1))}</View>
          </>
        ) : null}
        {q.data && !order.recent.length && !order.all.length ? (
          <Text style={s.empty}>{media === 'Audio' ? 'No music playlists yet. Make one above.' : 'No video playlists yet. Make one above.'}</Text>
        ) : null}
      </TvScrollView>
    </Sheet>
  );
}

function RenameSheet() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const phase = useSheets((st) => st.rename);
  const playlist = phase.name === 'closed' ? null : phase.playlist;
  const token = phase.name === 'closed' ? 0 : phase.token;
  const [name, setName] = useState('');
  const [nameFor, setNameFor] = useState(token);
  if (token !== nameFor) {
    // A new playlist to rename: start from its name.
    setNameFor(token);
    setName(playlist?.Name ?? '');
  }
  const save = async () => {
    const run = beginRename();
    if (!run) return;
    const ok = await rename(run.playlist, name);
    endRename(run.token, ok);
  };
  return (
    <Sheet visible={!!playlist} title="Rename playlist" onClose={closeRenameSheet} doneLabel="Cancel">
      <View style={[s.group, s.newRow]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Playlist name"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          style={s.input}
          accessibilityLabel="Playlist name"
        />
        <Button title="Save" variant="small" loading={phase.name === 'saving'} onPress={() => void save()} />
      </View>
      <View style={s.bottom} />
    </Sheet>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  flex: { flex: 1, minWidth: 0 },
  list: { flexGrow: 0 },
  content: { paddingBottom: spacing.md, gap: spacing.sm },
  header: { ...font(type.footnote), letterSpacing: 0.4, color: t.c.text2, marginTop: spacing.md, marginLeft: spacing.lg },
  meta: { ...font(type.footnote), color: t.c.text2 },
  plus: { width: scaled(40), height: scaled(40), borderRadius: radius.sm, backgroundColor: t.c.accentSoft, alignItems: 'center' as const, justifyContent: 'center' as const },
  newRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  input: { ...font(type.body), ...webInput, color: t.c.text, flex: 1, minHeight: scaled(44) },
  loading: { marginTop: spacing.lg },
  empty: { ...font(type.subheadline), color: t.c.text2, textAlign: 'center' as const, padding: spacing.lg },
  bottom: { height: spacing.md },
}));
