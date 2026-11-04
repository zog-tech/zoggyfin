/**
 * The Remote screen: pick another device of this account and control what it
 * plays (play and pause, seek, next and previous, stop, volume and mute). It
 * asks the server for the session state every 2 s while it is open; between
 * polls the position moves on locally. Controls show only when the target
 * supports them (see `remoteCommands`).
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import type { SessionInfoDto } from '@/api/types';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import { ItemImage } from '@/components/item-image';
import { EmptyState, ErrorState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { ModalHeader } from '@/extensions/ui/modal-header';
import { TvScrollView } from '@/features/tv/page-scroll';
import { formatClock } from '@/lib/format';
import { createStyles, type AppTheme, font, iconSize, layout, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import {
  deviceKind,
  mediaTypeOf,
  type Progress,
  progressAt,
  remoteCommands,
  seekTarget,
  seekToFraction,
  sessionDetail,
  sessionName,
  volumeStep,
} from './logic';
import { useControllableSessions, useRemoteActions } from './use-remote';

const SEEK_STEPS = [-30, -10, 10, 30] as const;
const VOLUME_STEP = 10;

/** The current time, every `ms` while `on`, so a playing position moves between polls. */
function useNow(on: boolean, ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

export function RemoteScreen({ initialSessionId }: { initialSessionId?: string }) {
  const s = useStyles(makeStyles);
  const { gutter } = useLayout();
  const q = useControllableSessions({ poll: true });
  const [picked, setPicked] = useState<string | undefined>(initialSessionId);
  // A device that went away: fall back to the first one.
  const selected = q.sessions.find((x) => x.Id === picked) ?? q.sessions[0];
  // Keep the choice when the list order changes between polls.
  const selectedId = selected?.Id ?? undefined;
  if (selectedId && selectedId !== picked) setPicked(selectedId);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/(home)'));

  let body;
  if (q.isPending) body = <ActivityIndicator style={s.loading} />;
  else if (q.isError && !q.data) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else if (!q.sessions.length)
    body = (
      <EmptyState
        icon="iphone"
        title="No other devices"
        message="Open Jellyfin on a TV, computer or phone with this account. It shows here when it can be controlled."
        action={{ title: 'Check again', onPress: () => void q.refetch() }}
      />
    );
  else
    body = (
      <>
        <DeviceList sessions={q.sessions} selectedId={selected?.Id ?? undefined} onSelect={setPicked} />
        {selected ? <NowPlaying key={selected.Id} session={selected} fetchedAt={q.dataUpdatedAt} /> : null}
      </>
    );

  return (
    <View style={s.page}>
      <ModalHeader title="Remote" onClose={close} modal={Platform.OS === 'ios'} />
      <TvScrollView contentContainerStyle={[s.content, { paddingHorizontal: gutter }]}>
        <View style={s.inner}>{body}</View>
      </TvScrollView>
    </View>
  );
}

function DeviceList({ sessions, selectedId, onSelect }: { sessions: SessionInfoDto[]; selectedId?: string; onSelect: (id: string) => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        DEVICES
      </Text>
      <View style={s.card} accessibilityRole="radiogroup">
        {sessions.map((x, i) => {
          const on = x.Id === selectedId;
          return (
            <Touchable
              key={x.Id}
              kind="row"
              onPress={() => x.Id && onSelect(x.Id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${sessionName(x)}, ${sessionDetail(x)}`}
              style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowActive]}>
              <View style={[s.rowInner, i < sessions.length - 1 && s.rowLine]}>
                <Icon name={deviceKind(x) === 'tv' ? 'tv' : 'iphone'} size={scaled(iconSize.sm)} color={on ? c.accent : c.text2} />
                <View style={s.flex}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {sessionName(x)}
                  </Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {sessionDetail(x)}
                  </Text>
                </View>
                {on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
              </View>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

function NowPlaying({ session: x, fetchedAt }: { session: SessionInfoDto; fetchedAt: number }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { contentWidth, gutter } = useLayout();
  const actions = useRemoteActions();
  const cmds = remoteCommands(x);
  const item = x.NowPlayingItem;
  const paused = x.PlayState?.IsPaused === true;
  const now = useNow(!!item && !paused);
  const prog = progressAt(x, fetchedAt, now);
  const id = x.Id ?? '';
  const name = sessionName(x);

  const seek = (ticks: number) => void actions.playstate(id, 'Seek', ticks);
  const artWidth = Math.min(contentWidth - gutter * 2, layout.readableWidth, 420);
  const audio = item ? mediaTypeOf(item) === 'Audio' : false;
  const volume = x.PlayState?.VolumeLevel;
  const muted = x.PlayState?.IsMuted === true;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {`ON ${name.toUpperCase()}`}
      </Text>
      <View style={[s.card, s.player]}>
        {item ? (
          <>
            <ItemImage
              item={item}
              variant={audio ? 'square' : 'landscape'}
              width={audio ? Math.min(artWidth, 280) : artWidth}
              aspectRatio={audio ? 1 : 16 / 9}
              rounded={radius.lg}
              hideArtTitle
              style={s.art}
            />
            <View style={s.titles}>
              <Text style={s.title} numberOfLines={2}>
                {item.Name ?? 'Unknown item'}
              </Text>
              {subtitle(item) ? (
                <Text style={s.subtitle} numberOfLines={1}>
                  {subtitle(item)}
                </Text>
              ) : null}
            </View>
            <ProgressBar progress={prog} canSeek={cmds.seek} onSeek={(f) => seek(seekToFraction(f, prog.runtimeTicks))} />
            <View style={s.controls}>
              {cmds.skip ? <Control icon="backward.end.fill" label="Previous" onPress={() => void actions.playstate(id, 'PreviousTrack')} /> : null}
              {cmds.seek
                ? SEEK_STEPS.filter((d) => d < 0).map((d) => (
                    <Control key={d} icon={d === -30 ? 'gobackward.30' : 'gobackward.10'} seconds={-d} label={`Back ${-d} seconds`} onPress={() => seek(seekTarget(prog.positionTicks, d, prog.runtimeTicks))} />
                  ))
                : null}
              {cmds.playPause ? (
                <Control big icon={paused ? 'play.fill' : 'pause.fill'} label={paused ? 'Play' : 'Pause'} onPress={() => void actions.playstate(id, paused ? 'Unpause' : 'Pause')} />
              ) : null}
              {cmds.seek
                ? SEEK_STEPS.filter((d) => d > 0).map((d) => (
                    <Control key={d} icon={d === 30 ? 'goforward.30' : 'goforward.10'} seconds={d} label={`Forward ${d} seconds`} onPress={() => seek(seekTarget(prog.positionTicks, d, prog.runtimeTicks))} />
                  ))
                : null}
              {cmds.skip ? <Control icon="forward.end.fill" label="Next" onPress={() => void actions.playstate(id, 'NextTrack')} /> : null}
            </View>
            {cmds.stop ? (
              <Button title="Stop" icon="stop.fill" variant="smallTonal" onPress={() => void actions.playstate(id, 'Stop')} accessibilityLabel={`Stop playback on ${name}`} />
            ) : null}
          </>
        ) : (
          <View style={s.idle}>
            <Icon name="play.rectangle" size={scaled(iconSize.lg)} color={c.text3} />
            <Text style={s.idleTitle}>Nothing playing</Text>
            <Text style={s.idleText}>To start something here, open an item’s menu and choose Play on.</Text>
          </View>
        )}
        {cmds.volume || cmds.mute ? (
          <View style={s.volume}>
            {cmds.mute ? (
              <Control
                icon={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
                label={muted ? 'Unmute' : 'Mute'}
                selected={muted}
                onPress={() => void actions.toggleMute(id)}
              />
            ) : null}
            {cmds.volume ? (
              <>
                <Control icon="speaker.fill" label="Volume down" onPress={() => void actions.setVolume(id, volumeStep(volume, -VOLUME_STEP))} />
                <Text style={s.volumeText} accessibilityLiveRegion="polite">
                  {typeof volume === 'number' ? `Volume ${volume}` : 'Volume'}
                </Text>
                <Control icon="speaker.wave.3.fill" label="Volume up" onPress={() => void actions.setVolume(id, volumeStep(volume, VOLUME_STEP))} />
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function subtitle(item: NonNullable<SessionInfoDto['NowPlayingItem']>): string | null {
  if (item.Type === 'Episode') return [item.SeriesName, item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} · E${item.IndexNumber}` : null].filter(Boolean).join(' · ') || null;
  if (item.Type === 'Audio') return item.AlbumArtist ?? item.Artists?.[0] ?? item.Album ?? null;
  return item.ProductionYear ? String(item.ProductionYear) : null;
}

function ProgressBar({ progress, canSeek, onSeek }: { progress: Progress; canSeek: boolean; onSeek: (fraction: number) => void }) {
  const s = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const pos = formatClock(progress.positionTicks) ?? '0:00';
  const total = formatClock(progress.runtimeTicks);
  if (progress.fraction === null) {
    return <Text style={s.time}>{pos}</Text>;
  }
  const pct = `${Math.min(100, Math.max(0, progress.fraction * 100))}%` as const;
  return (
    <View style={s.progress}>
      <Pressable
        disabled={!canSeek || width <= 0}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => onSeek(e.nativeEvent.locationX / width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{ text: total ? `${pos} of ${total}` : pos }}
        style={s.trackHit}
        focusable={false}>
        <View style={s.track}>
          <View style={[s.fill, { width: pct }]} />
        </View>
      </Pressable>
      <View style={s.times}>
        <Text style={s.time}>{pos}</Text>
        <Text style={s.time}>{total ?? ''}</Text>
      </View>
    </View>
  );
}

/** The web icon set has one rotate arrow for every skip size, so the web writes the seconds in it. */
const SECONDS_IN_ICON = Platform.OS === 'web';

function Control({ icon, label, onPress, big, selected, seconds }: { icon: IconName; label: string; onPress: () => void; big?: boolean; selected?: boolean; seconds?: number }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable
      kind="icon"
      radius={radius.pill}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }) => [big ? s.bigControl : s.control, (pressed || hovered || selected) && !big && s.controlActive]}>
      <Icon name={icon} size={scaled(big ? iconSize.xl : iconSize.md)} color={big ? c.onAccent : c.text} />
      {SECONDS_IN_ICON && seconds ? (
        <Text style={s.seconds} pointerEvents="none">
          {seconds}
        </Text>
      ) : null}
    </Touchable>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bgGrouped },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.huge },
  inner: { width: '100%' as const, maxWidth: layout.readableWidth, alignSelf: 'center' as const, gap: spacing.xxl },
  loading: { paddingVertical: spacing.huge },
  section: { gap: spacing.sm },
  sectionTitle: { ...font(type.footnote), color: c.text2, paddingHorizontal: spacing.lg },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const },
  row: { paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface2 },
  rowInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: layout.rowHeight.regular,
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowLine: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  flex: { flex: 1, minWidth: 0 },
  rowTitle: { ...font(type.body), color: c.text },
  rowMeta: { ...font(type.footnote), color: c.text2 },
  player: { padding: spacing.lg, gap: spacing.lg, alignItems: 'center' as const },
  art: { alignSelf: 'center' as const },
  titles: { alignSelf: 'stretch' as const, gap: spacing.xxs },
  title: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  subtitle: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const },
  progress: { alignSelf: 'stretch' as const, gap: spacing.xs },
  trackHit: { paddingVertical: spacing.sm },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: c.surface3, overflow: 'hidden' as const },
  fill: { height: '100%' as const, backgroundColor: c.accent },
  times: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  time: { ...font(type.caption1, { tabular: true }), color: c.text2 },
  controls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.xs,
  },
  control: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radius.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  controlActive: { backgroundColor: c.surface2 },
  seconds: { ...font(type.caption2), fontSize: 8, lineHeight: 10, fontWeight: '700' as const, color: c.text, position: 'absolute' as const },
  bigControl: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.accent,
    marginHorizontal: spacing.sm,
  },
  idle: { alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.lg },
  idleTitle: { ...font(type.headline), color: c.text },
  idleText: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const },
  volume: {
    alignSelf: 'stretch' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: sizes.hairline,
    borderTopColor: c.separator,
  },
  volumeText: { ...font(type.subheadline, { tabular: true }), color: c.text2, minWidth: 80, textAlign: 'center' as const },
}));
