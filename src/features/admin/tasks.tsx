/**
 * Scheduled tasks: last run, result and next run of each task, "Run now"
 * with live progress, and "Stop" for a running task.
 */
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { confirmDestructive } from '@/lib/confirm';
import { createStyles, type AppTheme, font, spacing, type, useStyles } from '@/theme';

import type { AdminTarget } from './access';
import { formatSince, formatUntil, groupTasks, nextRun, taskStatus, type TaskTone } from './logic';
import { adminKeys, useAdminAction, useLive, useTasks } from './queries';
import { Badge, Bar, Card, CardGrid, LiveNote, SectionHeader, type Tone } from './ui';

const TONE: Record<TaskTone, Tone> = { running: 'accent', ok: 'success', failed: 'danger', cancelled: 'warning', never: 'neutral' };

export function TasksSection({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const live = useLive();
  const q = useTasks(target, live);
  const { busy, run } = useAdminAction();

  if (q.isPending) return <LoadingState rows={6} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const groups = groupTasks(q.data);
  const invalidate = [adminKeys.tasks(target)];

  const start = (t: TaskInfo) => void run(`start-${t.Id}`, () => target.api.startTask(t.Id ?? ''), { success: `${t.Name} started`, icon: 'play.fill', invalidate });
  const stop = async (t: TaskInfo) => {
    if (!(await confirmDestructive(`Stop ${t.Name}?`, 'The task stops now. It runs again at its next scheduled time.', 'Stop'))) return;
    void run(`stop-${t.Id}`, () => target.api.stopTask(t.Id ?? ''), { success: `${t.Name} is stopping`, icon: 'stop.fill', invalidate });
  };

  return (
    <View style={s.stack}>
      <LiveNote at={q.dataUpdatedAt} live={live} error={q.isError} />
      {groups.length === 0 ? <EmptyState icon="calendar.badge.clock" title="No scheduled tasks" /> : null}
      {groups.map((g) => (
        <View key={g.category} style={s.group}>
          <SectionHeader title={g.category} />
          <CardGrid>
            {g.tasks.map((t) => (
              <TaskCard key={t.Id} task={t} busy={busy} onStart={() => start(t)} onStop={() => void stop(t)} />
            ))}
          </CardGrid>
        </View>
      ))}
    </View>
  );
}

function TaskCard({ task: t, busy, onStart, onStop }: { task: TaskInfo; busy: (id: string) => boolean; onStart: () => void; onStop: () => void }) {
  const s = useStyles(makeStyles);
  const now = new Date();
  const st = taskStatus(t);
  const running = t.State === 'Running' || t.State === 'Cancelling';
  const last = t.LastExecutionResult?.EndTimeUtc ? formatSince(t.LastExecutionResult.EndTimeUtc, now) : null;
  const next = nextRun(t.Triggers, t.LastExecutionResult?.EndTimeUtc, now);
  const onStartup = (t.Triggers ?? []).some((x) => x.Type === 'StartupTrigger');
  const nextText = formatUntil(next, now) ?? (onStartup ? 'When the server starts' : 'Not scheduled');
  return (
    <Card>
      <View style={s.head}>
        <Text style={s.name} numberOfLines={2}>
          {t.Name}
        </Text>
        <Badge label={st.label} tone={TONE[st.tone]} />
      </View>
      {t.Description ? (
        <Text style={s.desc} numberOfLines={2}>
          {t.Description}
        </Text>
      ) : null}
      {running ? <Bar value={(t.CurrentProgressPercentage ?? 0) / 100} label={`${t.Name} progress`} /> : null}
      <View style={s.facts}>
        <Text style={s.fact}>{`Last run: ${last ?? 'never'}`}</Text>
        <Text style={s.fact}>{`Next run: ${nextText}`}</Text>
      </View>
      {t.LastExecutionResult?.Status === 'Failed' && t.LastExecutionResult.ErrorMessage ? (
        <Text style={s.error} numberOfLines={3}>
          {t.LastExecutionResult.ErrorMessage}
        </Text>
      ) : null}
      <View style={s.actions}>
        {running ? (
          <Button title={t.State === 'Cancelling' ? 'Stopping' : 'Stop'} icon="stop.fill" variant="smallTonal" disabled={t.State === 'Cancelling'} loading={busy(`stop-${t.Id}`)} onPress={onStop} accessibilityLabel={`Stop ${t.Name}`} />
        ) : (
          <Button title="Run now" icon="play.fill" variant="smallTonal" loading={busy(`start-${t.Id}`)} onPress={onStart} accessibilityLabel={`Run ${t.Name} now`} />
        )}
      </View>
    </Card>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  stack: { gap: spacing.xxl },
  group: { gap: spacing.sm },
  head: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, gap: spacing.md },
  name: { ...font(type.headline), color: c.text, flexShrink: 1 },
  desc: { ...font(type.footnote), color: c.text2 },
  facts: { gap: 2 },
  fact: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  error: { ...font(type.footnote), color: c.danger },
  actions: { flexDirection: 'row' as const, gap: spacing.sm },
}));
