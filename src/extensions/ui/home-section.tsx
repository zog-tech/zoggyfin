/**
 * An extension's Home row, filled from its feed, and the "Tasks" row that
 * shows the progress of extension tasks. A row draws through the same
 * section renderer as the extension's pages (`features/extensions`). A row
 * that fails shows a small note; it never blocks Home. A row of a v2 page
 * has a header that opens the page.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { RowHeader } from '@/components/item-row';
import { pageHref } from '@/features/extensions/nav';
import { resolveHomeRow } from '@/features/extensions/routes';
import { SectionBlock } from '@/features/extensions/sections';
import { createStyles, type AppTheme, font, radius, spacing, type, useLayout, useStyles } from '@/theme';

import { useExtensions } from '../store';
import { useTasks } from '../tasks';

export function ExtensionHomeSection({ extId, sectionId }: { extId: string; sectionId: string }) {
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === extId));
  const row = resolveHomeRow(ext?.manifest, sectionId);
  if (!ext?.enabled || !row) return null;
  // A v1 row has no page of its own to open.
  const page = ext.manifest.schemaVersion === 2 ? row.page.id : null;
  return (
    <SectionBlock
      extId={extId}
      extensionName={ext.manifest.name}
      section={{ ...row.section, layout: 'row' }}
      mode="row"
      where="home"
      onSeeAll={page ? () => router.push(pageHref('(home)', extId, page)) : undefined}
    />
  );
}

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
  task: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs + 2, borderCurve: 'continuous' as const },
  taskTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  taskTitle: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text, flex: 1 },
  taskState: { ...font(type.footnote), color: c.text2, fontVariant: ['tabular-nums' as const] },
  failed: { color: c.danger },
  taskTrack: { height: 4, borderRadius: 2, backgroundColor: c.surface3, overflow: 'hidden' as const },
  taskBar: { height: 4, backgroundColor: c.accent },
  failedBar: { backgroundColor: c.danger },
}));
