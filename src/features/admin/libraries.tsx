/**
 * Libraries: type and folders of each library, "Scan library" and "Refresh
 * metadata" per library, the "Watch for new files" switch (the server's
 * real-time monitoring), and "Scan all libraries" with the progress of the
 * library scan task.
 */
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { webSwitchColors } from '@/features/settings/rows';
import { createStyles, type AppTheme, font, iconSize, mediaColors, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import type { AdminTarget } from './access';
import type { RefreshKind } from './api';
import { LIBRARY_SCAN_TASK_KEY } from './logic';
import { adminKeys, useAdminAction, useLibraries, useLive, useTasks } from './queries';
import { Bar, Card, CardGrid } from './ui';

const TYPE_LABEL: Record<string, { label: string; icon: IconName }> = {
  movies: { label: 'Movies', icon: 'film' },
  tvshows: { label: 'Shows', icon: 'tv' },
  music: { label: 'Music', icon: 'music.note' },
  musicvideos: { label: 'Music videos', icon: 'video' },
  homevideos: { label: 'Home videos and photos', icon: 'photo' },
  boxsets: { label: 'Collections', icon: 'square.stack.3d.up' },
  books: { label: 'Books', icon: 'book' },
  playlists: { label: 'Playlists', icon: 'music.note.list' },
  mixed: { label: 'Mixed', icon: 'folder' },
};

function libraryType(l: VirtualFolderInfo): { label: string; icon: IconName } {
  return TYPE_LABEL[l.CollectionType ?? 'mixed'] ?? { label: l.CollectionType ?? 'Mixed', icon: 'folder' };
}

const REFRESH_OPTIONS: { value: RefreshKind; label: string }[] = [
  { value: 'scan', label: 'Scan for new and changed files' },
  { value: 'missing', label: 'Find missing metadata and images' },
  { value: 'replace', label: 'Replace all metadata and images' },
];

export function LibrariesSection({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const live = useLive();
  const q = useLibraries(target, live);
  const tasks = useTasks(target, live);
  const { busy, run } = useAdminAction();
  const [refreshing, setRefreshing] = useState<VirtualFolderInfo | null>(null);
  // The switch shows the new value while the request runs, then the server's value.
  const [watching, setWatching] = useState<Record<string, boolean>>({});

  if (q.isPending) return <LoadingState rows={4} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const scanTask = tasks.data?.find((t) => t.Key === LIBRARY_SCAN_TASK_KEY);
  const scanning = scanTask?.State === 'Running';
  const invalidate = [adminKeys.libraries(target), adminKeys.tasks(target)];

  const refresh = (l: VirtualFolderInfo, kind: RefreshKind) => {
    if (!l.ItemId) return;
    const what = kind === 'scan' ? 'Scan' : kind === 'missing' ? 'Metadata refresh' : 'Full metadata refresh';
    void run(`lib-${l.ItemId}`, () => target.api.refreshLibrary(l.ItemId ?? '', kind), { success: `${what} of ${l.Name} started`, icon: 'arrow.clockwise', invalidate });
  };

  const setWatch = async (l: VirtualFolderInfo, on: boolean) => {
    if (!l.ItemId) return;
    setWatching((w) => ({ ...w, [l.ItemId as string]: on }));
    await run(`watch-${l.ItemId}`, () => target.api.setLibraryWatch(l.ItemId ?? '', on), {
      success: on ? `${l.Name} now adds new files at once` : `${l.Name} now finds new files at the next scan`,
      invalidate,
    });
    setWatching(({ [l.ItemId as string]: _, ...rest }) => rest);
  };

  return (
    <View style={s.stack}>
      <Card>
        <View style={s.scanHead}>
          <View style={s.flex}>
            <Text style={s.cardTitle}>All libraries</Text>
            <Text style={s.muted}>{scanning ? `Scanning · ${Math.round(scanTask?.CurrentProgressPercentage ?? 0)} %` : 'Finds new, changed and removed files in every library.'}</Text>
          </View>
          <Button
            title={scanning ? 'Scanning' : 'Scan all libraries'}
            variant="small"
            icon="arrow.clockwise"
            disabled={scanning}
            loading={busy('scan-all')}
            onPress={() => void run('scan-all', () => target.api.scanAll(), { success: 'The scan of all libraries started', icon: 'arrow.clockwise', invalidate })}
          />
        </View>
        {scanning ? <Bar value={(scanTask?.CurrentProgressPercentage ?? 0) / 100} label="Library scan progress" /> : null}
      </Card>

      {q.data.length === 0 ? <EmptyState icon="square.stack" title="No libraries" message="Add libraries in the web dashboard of the server." /> : null}
      <CardGrid>
        {q.data.map((l) => (
          <LibraryCard
            key={l.ItemId ?? l.Name}
            library={l}
            busy={busy(`lib-${l.ItemId}`)}
            watch={watching[l.ItemId ?? ''] ?? !!l.LibraryOptions?.EnableRealtimeMonitor}
            watchBusy={busy(`watch-${l.ItemId}`)}
            onWatch={(on) => void setWatch(l, on)}
            onScan={() => refresh(l, 'scan')}
            onRefresh={() => setRefreshing(l)}
          />
        ))}
      </CardGrid>

      <OptionSheet
        visible={refreshing !== null}
        title={refreshing ? `Refresh ${refreshing.Name}` : 'Refresh'}
        options={REFRESH_OPTIONS}
        selected={[]}
        onSelect={(kind) => {
          const l = refreshing;
          setRefreshing(null);
          if (l) refresh(l, kind);
        }}
        onClose={() => setRefreshing(null)}
      />
    </View>
  );
}

function LibraryCard({
  library: l,
  busy,
  watch,
  watchBusy,
  onWatch,
  onScan,
  onRefresh,
}: {
  library: VirtualFolderInfo;
  busy: boolean;
  watch: boolean;
  watchBusy: boolean;
  onWatch: (on: boolean) => void;
  onScan: () => void;
  onRefresh: () => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const t = libraryType(l);
  const active = l.RefreshStatus === 'Active';
  return (
    <Card>
      <View style={s.libHead}>
        <View style={s.icon}>
          <Icon name={t.icon} size={scaled(iconSize.sm)} color={c.text} />
        </View>
        <View style={s.flex}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {l.Name}
          </Text>
          <Text style={s.muted}>{`${t.label} · ${(l.Locations ?? []).length} ${(l.Locations ?? []).length === 1 ? 'folder' : 'folders'}`}</Text>
        </View>
      </View>
      <View style={s.paths}>
        {(l.Locations ?? []).length === 0 ? <Text style={s.muted}>No folders</Text> : null}
        {(l.Locations ?? []).map((p) => (
          <Text key={p} style={s.path} numberOfLines={2} selectable>
            {p}
          </Text>
        ))}
      </View>
      {active ? (
        <View style={s.progress}>
          <Text style={s.muted}>{`Refreshing · ${Math.round(l.RefreshProgress ?? 0)} %`}</Text>
          <Bar value={(l.RefreshProgress ?? 0) / 100} label={`${l.Name} refresh progress`} />
        </View>
      ) : null}
      <View style={s.watch}>
        <View style={s.flex}>
          <Text style={s.watchTitle}>Watch for new files</Text>
          <Text style={s.muted}>{watch ? 'New files appear at once.' : 'New files appear after the next scan.'}</Text>
        </View>
        <Switch
          value={watch}
          disabled={watchBusy}
          onValueChange={onWatch}
          trackColor={{ true: c.accent, false: c.surface3 }}
          thumbColor={mediaColors.white}
          {...webSwitchColors}
          accessibilityLabel={`Watch ${l.Name} for new files`}
        />
      </View>
      <View style={s.actions}>
        <Button title="Scan library" variant="smallTonal" icon="arrow.clockwise" loading={busy} onPress={onScan} accessibilityLabel={`Scan ${l.Name}`} />
        <Button title="Refresh metadata" variant="smallTonal" onPress={onRefresh} accessibilityLabel={`Refresh metadata of ${l.Name}`} />
      </View>
    </Card>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  stack: { gap: spacing.xxl },
  flex: { flex: 1, minWidth: 0 },
  scanHead: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: spacing.md },
  cardTitle: { ...font(type.headline), color: c.text },
  muted: { ...font(type.footnote), color: c.text2 },
  libHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  icon: { width: scaled(36), height: scaled(36), borderRadius: 8, backgroundColor: c.surface2, alignItems: 'center' as const, justifyContent: 'center' as const },
  paths: { gap: spacing.xs },
  path: { ...font(type.mono), color: c.text2 },
  progress: { gap: spacing.xs },
  watch: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  watchTitle: { ...font(type.body), color: c.text },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
