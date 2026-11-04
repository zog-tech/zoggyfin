/**
 * An extension's Home row, filled from its JSON feed, and the "Tasks" row
 * that shows the progress of extension tasks. A row that fails shows a
 * small note; it never blocks Home.
 */
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { useApi } from '@/api/use-api';
import { Icon } from '@/components/icon';
import { RowHeader } from '@/components/item-row';
import { Tile, tileAspect, type TileShape } from '@/components/tile';
import { Touchable } from '@/components/touchable';
import { useOpenItem } from '@/lib/navigation';
import { features } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import { parseFeed, type FeedEntry } from '../feed';
import { FEED_TIMEOUT_MS } from '../http';
import { extensionRequest, templateContext } from '../runtime';
import { getExtension, useExtensions } from '../store';
import { useTasks } from '../tasks';

interface Row {
  entry: FeedEntry;
  item?: BaseItemDto;
}

export function ExtensionHomeSection({ extId, sectionId }: { extId: string; sectionId: string }) {
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === extId));
  const spec = ext?.manifest.contributes.homeSections?.find((x) => x.id === sectionId);
  const { api, userId, scope } = useApi();
  const q = useQuery({
    queryKey: [...queryKeys.all(scope), 'ext-feed', extId, sectionId],
    enabled: !!ext?.enabled && !!spec,
    refetchInterval: spec?.refreshSeconds ? spec.refreshSeconds * 1000 : false,
    retry: 1,
    queryFn: async (): Promise<Row[]> => {
      const cur = getExtension(extId);
      if (!cur || !spec) return [];
      const entries = parseFeed(await extensionRequest(cur, { method: 'GET', path: spec.feed }, templateContext(cur), FEED_TIMEOUT_MS), cur.manifest.baseUrl);
      const ids = entries.map((e) => e.itemId).filter((x): x is string => !!x);
      let items: BaseItemDto[] = [];
      if (ids.length) {
        try {
          const res = await getLibraryApi(api).getItems({ userId, ids, fields: ['PrimaryImageAspectRatio'], enableImageTypes: ['Primary', 'Thumb', 'Backdrop'] });
          items = res.data.Items ?? [];
        } catch {
          items = [];
        }
      }
      return entries
        .map((entry) => ({ entry, item: entry.itemId ? items.find((i) => i.Id === entry.itemId) : undefined }))
        .filter((r) => !!r.item || !!r.entry.title);
    },
  });

  if (!ext?.enabled || !spec) return null;
  if (q.error && !q.data) return <FailedRow title={spec.title} name={ext.manifest.name} />;
  if (!q.data?.length) return null;
  return <FeedRow title={spec.title} rows={q.data} shape={spec.shape} extId={extId} />;
}

function FailedRow({ title, name }: { title: string; name: string }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} />
      <Text style={[s.note, { paddingHorizontal: l.gutter }]}>{name} is not available now.</Text>
    </View>
  );
}

function FeedRow({ title, rows, shape, extId }: { title: string; rows: Row[]; shape: TileShape; extId: string }) {
  const l = useLayout();
  const open = useOpenItem();
  const width = l.rowTile[shape === 'thumb' ? 'thumb' : shape];
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: l.gutter, gap: l.gap, paddingVertical: spacing.xs }}>
        {rows.map((r) =>
          r.item ? (
            <Tile key={r.entry.key} item={r.item} width={width} shape={shape} onPress={open} subtitle={r.entry.subtitle} />
          ) : (
            <Card key={r.entry.key} entry={r.entry} width={width} shape={shape} onPress={() => openEntry(r.entry, extId)} />
          ),
        )}
      </ScrollView>
    </View>
  );
}

function openEntry(e: FeedEntry, extId: string) {
  if (e.panel && features.extensionPanels) router.push({ pathname: '/extension-panel', params: { ext: extId, panel: e.panel } });
  else if (e.link) void Linking.openURL(e.link);
}

const Card = memo(function Card({ entry, width, shape, onPress }: { entry: FeedEntry; width: number; shape: TileShape; onPress: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const height = width / tileAspect(shape);
  // TV has no extension panels: an entry that only opens one is not a button there.
  const pressable = (!!entry.panel && features.extensionPanels) || !!entry.link;
  const body = (
    <View style={{ width }}>
      <View style={[s.art, { width, height }]}>
        {entry.imageUrl ? (
          <Image source={{ uri: entry.imageUrl }} style={{ width, height }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Icon name="square.grid.2x2" size={scaled(iconSize.lg)} color={c.text3} />
        )}
        {entry.progress !== undefined ? (
          <View style={s.track}>
            <View style={[s.bar, { width: `${Math.round(entry.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <Text style={s.title} numberOfLines={1}>
        {entry.title}
      </Text>
      {entry.subtitle ? (
        <Text style={s.subtitle} numberOfLines={1}>
          {entry.subtitle}
        </Text>
      ) : null}
    </View>
  );
  if (!pressable) return <View accessible accessibilityLabel={[entry.title, entry.subtitle].filter(Boolean).join(', ')}>{body}</View>;
  return (
    <Touchable onPress={onPress} radius={radius.md} accessibilityRole="button" accessibilityLabel={entry.title ?? ''}>
      {body}
    </Touchable>
  );
});

/** Running and just-finished extension tasks. Hidden when there are none. */
export function ExtensionTasksSection() {
  const tasks = useTasks((st) => st.tasks);
  const s = useStyles(makeStyles);
  const l = useLayout();
  if (!tasks.length) return null;
  return (
    <View style={{ marginTop: l.sectionGap }}>
      <RowHeader title="Tasks" />
      <View style={{ paddingHorizontal: l.gutter, gap: spacing.sm }}>
        {tasks.map((t) => (
          <View key={t.key} style={s.task} accessible accessibilityLabel={`${t.title}, ${t.phase === 'running' ? (t.progress !== null ? `${Math.round(t.progress * 100)}%` : 'running') : t.phase}`}>
            <View style={s.taskTop}>
              <Text style={s.taskTitle} numberOfLines={1}>
                {t.title}
              </Text>
              <Text style={[s.taskState, t.phase === 'failed' && s.failed]}>
                {t.phase === 'done' ? 'Done' : t.phase === 'failed' ? 'Failed' : t.progress !== null ? `${Math.round(t.progress * 100)}%` : 'Starting'}
              </Text>
            </View>
            <View style={s.taskTrack}>
              <View style={[s.taskBar, { width: `${Math.round((t.phase === 'done' ? 1 : (t.progress ?? 0)) * 100)}%` }, t.phase === 'failed' && s.failedBar]} />
            </View>
            <Text style={s.note} numberOfLines={2}>
              {t.message ?? t.extensionName}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  note: { ...font(type.footnote), color: c.text2 },
  art: { borderRadius: radius.md, backgroundColor: c.surface2, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const, borderCurve: 'continuous' as const },
  track: { position: 'absolute' as const, left: spacing.sm, right: spacing.sm, bottom: spacing.sm, height: 4, borderRadius: 2, backgroundColor: mediaColors.badgeFill, overflow: 'hidden' as const },
  bar: { height: 4, backgroundColor: mediaColors.white },
  title: { ...font(type.subheadline), fontWeight: '500' as const, color: c.text, marginTop: spacing.xs + 2 },
  subtitle: { ...font(type.footnote), color: c.text2 },
  task: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs + 2, borderCurve: 'continuous' as const },
  taskTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  taskTitle: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text, flex: 1 },
  taskState: { ...font(type.footnote), color: c.text2, fontVariant: ['tabular-nums' as const] },
  failed: { color: c.danger },
  taskTrack: { height: 4, borderRadius: 2, backgroundColor: c.surface3, overflow: 'hidden' as const },
  taskBar: { height: 4, backgroundColor: c.accent },
  failedBar: { backgroundColor: c.danger },
}));
