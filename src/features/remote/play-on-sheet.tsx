/**
 * The "Play on…" sheet: the other devices of this account that Jellyfin can
 * control, with what each one plays. A tap starts the item there, and the
 * toast offers the Remote screen. One host at the root; any screen opens it
 * with `openPlayOn(item)`. The phases and the rule that a late request never
 * acts on a newer open are in `play-on-store.ts`.
 */
import { ActivityIndicator, Text, View } from 'react-native';

import type { SessionInfoDto } from '@/api/types';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { ErrorState } from '@/components/states';
import { TvScrollView } from '@/features/tv/page-scroll';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { deviceKind, sessionDetail, sessionName, sessionsFor, startTicksFor } from './logic';
import { beginPlayOn, closePlayOn, endPlayOn, usePlayOn } from './play-on-store';
import { openRemote, useControllableSessions, useRemoteActions } from './use-remote';

export { openPlayOn } from './play-on-store';

export function PlayOnHost() {
  return <PlayOnSheet />;
}

function PlayOnSheet() {
  const s = useStyles(makeStyles);
  const sheet = useStyles(makeSheetStyles);
  const { c } = useTheme();
  const phase = usePlayOn((st) => st.phase);
  const item = phase.name === 'closed' ? null : phase.item;
  const busy = phase.name === 'starting' ? phase.target : null;
  const q = useControllableSessions({ enabled: !!item });
  const actions = useRemoteActions();
  const targets = item ? sessionsFor(q.sessions, item) : [];

  const play = async (target: SessionInfoDto) => {
    if (!item?.Id || !target.Id) return;
    const run = beginPlayOn(target.Id);
    if (!run?.item.Id) return;
    const ok = await actions.play(target.Id, [run.item.Id], startTicksFor(run.item));
    endPlayOn(run.token, ok);
    if (!ok) return;
    // The item plays there even when the sheet was closed in the meantime.
    const id = target.Id;
    toast(`Playing on ${sessionName(target)}`, { icon: 'checkmark', action: { label: 'Control', onPress: () => openRemote(id) } });
  };

  let body;
  if (q.isPending) {
    body = <ActivityIndicator style={s.loading} color={c.text2} />;
  } else if (q.isError) {
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  } else if (!targets.length) {
    body = (
      <View style={s.empty}>
        <Icon name="iphone" size={scaled(iconSize.lg)} color={c.text3} />
        <Text style={s.emptyTitle}>No other devices</Text>
        <Text style={s.emptyText}>
          Open Jellyfin on a TV, computer or phone with this account. It shows here when it can be controlled.
        </Text>
        <Button title="Check again" variant="smallTonal" icon="arrow.clockwise" loading={q.isFetching} onPress={() => void q.refetch()} />
      </View>
    );
  } else {
    body = (
      <View style={sheet.group}>
        {targets.map((t, i) => (
          <SheetRow key={t.Id} last={i === targets.length - 1} onPress={() => void play(t)} accessibilityLabel={`Play on ${sessionName(t)}, ${sessionDetail(t)}`}>
            <Icon name={deviceKind(t) === 'tv' ? 'tv' : 'iphone'} size={scaled(iconSize.sm)} color={c.accent} />
            <View style={s.flex}>
              <Text style={sheet.rowText} numberOfLines={1}>
                {sessionName(t)}
              </Text>
              <Text style={s.meta} numberOfLines={1}>
                {sessionDetail(t)}
              </Text>
            </View>
            {busy === t.Id ? <ActivityIndicator color={c.text2} /> : null}
          </SheetRow>
        ))}
      </View>
    );
  }

  return (
    <Sheet visible={!!item} title={item?.Name ? `Play “${item.Name}” on` : 'Play on'} onClose={closePlayOn} doneLabel="Cancel">
      <TvScrollView style={s.scroll} contentContainerStyle={s.content}>
        {body}
      </TvScrollView>
    </Sheet>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  scroll: { maxHeight: 480 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  meta: { ...font(type.footnote), color: c.text2 },
  loading: { paddingVertical: spacing.xxl },
  empty: { alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyTitle: { ...font(type.headline), color: c.text, textAlign: 'center' as const },
  emptyText: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const, marginBottom: spacing.sm },
}));
