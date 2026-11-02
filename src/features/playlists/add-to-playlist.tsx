/**
 * The "Add to playlist" sheet (design system §7.12) and the rename sheet.
 * One host at the root; any screen opens them with `openAddToPlaylist` or
 * `openRenamePlaylist`. Two taps from any item: "Add to playlist", then a
 * playlist (or "New playlist", a name, Return).
 */
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { create } from 'zustand';

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

interface SheetState {
  items: BaseItemDto[] | null;
  renaming: BaseItemDto | null;
}

const useSheets = create<SheetState>(() => ({ items: null, renaming: null }));

/** Opens the sheet for one item, a container, or several items (a queue). */
export function openAddToPlaylist(items: BaseItemDto | BaseItemDto[]): void {
  const list = (Array.isArray(items) ? items : [items]).filter((i) => i.Id);
  if (list.length) useSheets.setState({ items: list });
}

export function openRenamePlaylist(playlist: BaseItemDto): void {
  useSheets.setState({ renaming: playlist });
}

function success() {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function AddToPlaylistHost() {
  const items = useSheets((s) => s.items);
  const renaming = useSheets((s) => s.renaming);
  return (
    <>
      <AddSheet items={items} onClose={() => useSheets.setState({ items: null })} />
      <RenameSheet playlist={renaming} onClose={() => useSheets.setState({ renaming: null })} />
    </>
  );
}

function AddSheet({ items, onClose }: { items: BaseItemDto[] | null; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { api, userId, scope } = useApi();
  const media = playlistMediaFor(items ?? []);
  const q = useQuery({
    queryKey: queryKeys.playlists(scope, media),
    queryFn: () => jf.getPlaylists(api, userId),
    enabled: !!items,
    staleTime: 30_000,
  });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => {
    setNaming(false);
    setName('');
    setBusy(null);
    onClose();
  };

  const order = useMemo(() => sheetOrder((q.data ?? []).filter((p) => fits(p, media)), recentPlaylistIds()), [q.data, media]);
  const what = items?.length === 1 ? items[0]?.Name : items ? `${items.length} items` : '';

  const add = async (p: BaseItemDto) => {
    if (!items || busy) return;
    setBusy(p.Id ?? 'x');
    const ok = await addItems(p, items);
    setBusy(null);
    if (ok) {
      success();
      close();
    }
  };
  const create = async () => {
    if (!items || busy) return;
    setBusy('new');
    const id = await createWith(name, items);
    setBusy(null);
    if (id) {
      success();
      close();
    }
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
      {busy === p.Id ? <ActivityIndicator color={c.text2} /> : null}
    </SheetRow>
  );

  return (
    <Sheet visible={!!items} title={what ? `Add “${what}” to a playlist` : 'Add to playlist'} onClose={close} doneLabel="Cancel">
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
              <Button title="Create" variant="small" loading={busy === 'new'} onPress={() => void create()} />
            </View>
          ) : (
            <SheetRow last accessibilityLabel="New playlist" onPress={() => setNaming(true)}>
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

function RenameSheet({ playlist, onClose }: { playlist: BaseItemDto | null; onClose: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState<BaseItemDto | null>(null);
  if (playlist !== shownFor) {
    // A new playlist to rename: start from its name.
    setShownFor(playlist);
    setName(playlist?.Name ?? '');
    setBusy(false);
  }
  const save = async () => {
    if (!playlist || busy) return;
    setBusy(true);
    const ok = await rename(playlist, name);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet visible={!!playlist} title="Rename playlist" onClose={onClose} doneLabel="Cancel">
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
        <Button title="Save" variant="small" loading={busy} onPress={() => void save()} />
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
