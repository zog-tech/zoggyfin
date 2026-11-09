/**
 * Now playing: every session of the server, refreshed every 5 s while the
 * screen is open. Per session: what plays, how (Direct Play, Direct Stream,
 * Transcode and why), the bitrate and progress, and the actions message,
 * pause or resume, stop and stop transcode.
 */
import type { SessionInfoDto } from '@jellyfin/sdk/lib/generated-client/models';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { confirmDestructive } from '@/lib/confirm';
import { episodeLabel, formatClock } from '@/lib/format';
import { createStyles, type AppTheme, font, spacing, type, useStyles } from '@/theme';

import type { AdminTarget } from './access';
import { formatSince, sessionPlayInfo, sortSessions } from './logic';
import { adminKeys, useAdminAction, useLive, useSessions } from './queries';
import { Badge, Bar, Card, CardGrid, LiveNote, SectionHeader, TextSheet } from './ui';

export function SessionsSection({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const live = useLive();
  const q = useSessions(target, live);
  const [messageTo, setMessageTo] = useState<SessionInfoDto | null>(null);
  const { busy, run } = useAdminAction();

  if (q.isPending) return <LoadingState rows={4} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = sortSessions(q.data);
  const playing = list.filter((x) => x.NowPlayingItem);
  const idle = list.filter((x) => !x.NowPlayingItem);
  const invalidate = [adminKeys.sessions(target)];
  const who = (x: SessionInfoDto) => `${x.UserName || 'Someone'} on ${x.DeviceName || 'a device'}`;

  const actions: SessionActions = {
    busy,
    message: (x) => setMessageTo(x),
    pause: (x, pause) =>
      void run(`pause-${x.Id}`, () => target.api.playstate(x.Id ?? '', pause ? 'Pause' : 'Unpause'), {
        success: `${pause ? 'Paused' : 'Resumed'} ${who(x)}`,
        icon: pause ? 'pause.fill' : 'play.fill',
        invalidate,
      }),
    stop: async (x) => {
      if (!(await confirmDestructive('Stop playback?', `${who(x)} stops playing ${x.NowPlayingItem?.Name ?? 'the item'}.`, 'Stop'))) return;
      void run(`stop-${x.Id}`, () => target.api.playstate(x.Id ?? '', 'Stop'), { success: `Stopped playback for ${who(x)}`, icon: 'stop.fill', invalidate });
    },
    stopTranscode: async (x) => {
      if (!(await confirmDestructive('Stop the transcode?', `The server stops converting ${x.NowPlayingItem?.Name ?? 'the item'} for ${who(x)}. Playback on that device stops.`, 'Stop transcode'))) return;
      void run(`transcode-${x.Id}`, () => target.api.stopTranscode(x), {
        success: (how) => (how === 'killed' ? `Stopped the transcode for ${who(x)}` : `Stopped playback and its transcode for ${who(x)}`),
        icon: 'stop.fill',
        invalidate,
      });
    },
  };

  return (
    <View style={s.stack}>
      <LiveNote at={q.dataUpdatedAt} live={live} error={q.isError} />
      {list.length === 0 ? <EmptyState icon="play.rectangle" title="No sessions" message="Nobody uses the server now." /> : null}
      {playing.length > 0 ? (
        <View style={s.group}>
          <SectionHeader title={`Playing · ${playing.length}`} />
          <CardGrid>
            {playing.map((x) => (
              <SessionCard key={x.Id} session={x} actions={actions} />
            ))}
          </CardGrid>
        </View>
      ) : list.length > 0 ? (
        <EmptyState icon="play.rectangle" title="Nothing plays now" message="The sessions below are connected, but they do not play anything." />
      ) : null}
      {idle.length > 0 ? (
        <View style={s.group}>
          <SectionHeader title={`Connected · ${idle.length}`} />
          <CardGrid>
            {idle.map((x) => (
              <SessionCard key={x.Id} session={x} actions={actions} />
            ))}
          </CardGrid>
        </View>
      ) : null}
      <TextSheet
        visible={messageTo !== null}
        title={messageTo ? `Message to ${messageTo.UserName || 'session'}` : 'Message'}
        label="Message"
        hint={messageTo ? `The text shows on ${messageTo.DeviceName || 'the device'} for 15 seconds, if the app there supports messages.` : undefined}
        action="Send"
        multiline
        busy={busy(`msg-${messageTo?.Id}`)}
        validate={(v) => (v.length > 500 ? 'Use 500 characters or less.' : null)}
        onSubmit={async (text) => {
          const x = messageTo;
          if (!x?.Id) return;
          const ok = await run(`msg-${x.Id}`, () => target.api.sendMessage(x.Id ?? '', text.trim()), { success: `Message sent to ${who(x)}`, icon: 'message' });
          if (ok) setMessageTo(null);
        }}
        onClose={() => setMessageTo(null)}
      />
    </View>
  );
}

interface SessionActions {
  busy: (id: string) => boolean;
  message: (s: SessionInfoDto) => void;
  pause: (s: SessionInfoDto, pause: boolean) => void;
  stop: (s: SessionInfoDto) => void;
  stopTranscode: (s: SessionInfoDto) => void;
}

function nowPlayingTitle(s: SessionInfoDto): { title: string; sub: string | null } {
  const it = s.NowPlayingItem;
  if (!it) return { title: '', sub: null };
  if (it.Type === 'Episode') return { title: it.SeriesName ?? it.Name ?? 'Episode', sub: [episodeLabel(it), it.Name].filter(Boolean).join(' · ') || null };
  if (it.Type === 'Audio') return { title: it.Name ?? 'Track', sub: [it.AlbumArtist ?? it.Artists?.[0], it.Album].filter(Boolean).join(' · ') || null };
  return { title: it.Name ?? 'Item', sub: it.ProductionYear ? String(it.ProductionYear) : null };
}

function SessionCard({ session: x, actions }: { session: SessionInfoDto; actions: SessionActions }) {
  const s = useStyles(makeStyles);
  const info = sessionPlayInfo(x);
  const np = nowPlayingTitle(x);
  const canControl = x.SupportsMediaControl !== false;
  const client = [x.Client, x.ApplicationVersion].filter(Boolean).join(' ');
  return (
    <Card>
      <View style={s.head}>
        <Text style={s.user} numberOfLines={1}>
          {x.UserName || 'No user'}
        </Text>
        <Text style={s.device} numberOfLines={2}>
          {[x.DeviceName, client].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {x.NowPlayingItem ? (
        <>
          <View style={s.np}>
            <Text style={s.title} numberOfLines={2}>
              {np.title}
            </Text>
            {np.sub ? (
              <Text style={s.sub} numberOfLines={1}>
                {np.sub}
              </Text>
            ) : null}
          </View>
          {info.progress !== null ? (
            <View style={s.progress}>
              <Bar value={info.progress} label="Playback position" />
              <View style={s.times}>
                <Text style={s.time}>{formatClock(x.PlayState?.PositionTicks ?? 0) ?? '0:00'}</Text>
                <Text style={s.time}>{formatClock(x.NowPlayingItem.RunTimeTicks) ?? ''}</Text>
              </View>
            </View>
          ) : null}
          <View style={s.badges}>
            {info.method ? <Badge label={info.method} tone={info.isTranscode ? 'warning' : 'success'} /> : null}
            {info.paused ? <Badge label="Paused" icon="pause.fill" /> : null}
            {info.bitrate ? <Badge label={info.bitrate} /> : null}
            {info.transcodePercent !== null ? <Badge label={`Converted ${info.transcodePercent} %`} /> : null}
          </View>
          {info.reasons ? <Text style={s.reason}>Why: {info.reasons}</Text> : null}
          {info.detail ? <Text style={s.detail}>{info.detail}</Text> : null}
        </>
      ) : (
        <Text style={s.idle}>{`Idle · active ${formatSince(x.LastActivityDate, new Date()) ?? 'recently'}`}</Text>
      )}
      <View style={s.actions}>
        {x.NowPlayingItem && canControl ? (
          <>
            <Button
              title={info.paused ? 'Resume' : 'Pause'}
              icon={info.paused ? 'play.fill' : 'pause.fill'}
              variant="smallTonal"
              loading={actions.busy(`pause-${x.Id}`)}
              onPress={() => actions.pause(x, !info.paused)}
              accessibilityLabel={`${info.paused ? 'Resume' : 'Pause'} ${x.UserName ?? ''} on ${x.DeviceName ?? ''}`}
            />
            <Button title="Stop" icon="stop.fill" variant="smallTonal" loading={actions.busy(`stop-${x.Id}`)} onPress={() => actions.stop(x)} accessibilityLabel={`Stop playback of ${x.UserName ?? ''}`} />
          </>
        ) : null}
        {info.isTranscode ? (
          <Button title="Stop transcode" variant="smallTonal" loading={actions.busy(`transcode-${x.Id}`)} onPress={() => actions.stopTranscode(x)} />
        ) : null}
        {x.SupportsRemoteControl !== false ? (
          <Button title="Message" icon="message" variant="smallTonal" onPress={() => actions.message(x)} accessibilityLabel={`Send a message to ${x.UserName ?? ''} on ${x.DeviceName ?? ''}`} />
        ) : null}
      </View>
    </Card>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  stack: { gap: spacing.xxl },
  group: { gap: spacing.sm },
  head: { gap: 2 },
  user: { ...font(type.headline), color: c.text },
  device: { ...font(type.footnote), color: c.text2 },
  np: { gap: 2 },
  title: { ...font(type.callout), fontWeight: '600' as const, color: c.text },
  sub: { ...font(type.footnote), color: c.text2 },
  progress: { gap: spacing.xs },
  times: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  time: { ...font(type.mono, { tabular: true }), color: c.text3 },
  badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  reason: { ...font(type.footnote), color: c.warning },
  detail: { ...font(type.footnote), color: c.text2 },
  idle: { ...font(type.subheadline), color: c.text2 },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
