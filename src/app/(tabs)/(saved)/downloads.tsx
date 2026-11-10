import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { Icon, type IconName } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { EmptyState } from '@/components/states';
import { SwipeRow } from '@/components/swipe-row';
import { ADD_TO_QUEUE_ACTION, canQueue, useQueueSwipe } from '@/features/actions/queue-swipe';
import { Touchable } from '@/components/touchable';
import {
  type DownloadGroupView,
  type DownloadRecord,
  downloads,
  downloadsSupported,
  etaSeconds,
  fraction,
  isFileMissing,
  useDiskSpace,
  removeServerDownloads,
  type ServerSection,
  useDownloadLists,
} from '@/downloads';
import { useServerNames } from '@/features/servers/use-server-names';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { confirmDestructive } from '@/lib/confirm';
import { formatBytes, formatEta, formatSpeed } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { useRootScreenOptions } from '@/lib/stack-options';
import { usePlayer } from '@/player';
import { createStyles, type AppTheme, font, iconSize, motion, radius, scaled, scriptStyle, sizes, spacing, type, useLayout, useStyles, useTheme } from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

/**
 * The Downloads tab (design system §7.11): the storage bar, "In progress"
 * with live progress and controls, and "On this device" grouped by show or
 * album. Everything that is on the phone is here; nothing is hidden.
 */
export default function DownloadsScreen() {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const l = useLayout();
  const { inProgress, sections, appBytes } = useDownloadLists();
  const empty = inProgress.length === 0 && sections.length === 0;
  const allPaused = inProgress.length > 0 && inProgress.every((r) => r.state === 'paused' || r.state === 'failed');
  // Opened from the sign-in screen with no account (route /offline): a way back, no library links.
  const signedIn = useSessionStore((st) => !!st.session);
  // A slim header only for the "Sign in" link. The options keep the iPad sidebar out of the content.
  const root = useRootScreenOptions({ bar: !signedIn, background: c.bgGrouped });

  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Downloads',
          ...(signedIn
            ? null
            : {
                headerLeft: () => (
                  <Touchable onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))} radius={8} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sign in">
                    <Text style={s.link}>Sign in</Text>
                  </Touchable>
                ),
              }),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={s.page} contentContainerStyle={[s.content, { paddingHorizontal: l.gutter, paddingBottom: bottomPad }]}>
        {!downloadsSupported ? (
          <EmptyState
            icon="arrow.down.circle"
            title="Downloads are not on the web"
            message="Use the iPhone or iPad app to keep movies, episodes and albums on the device."
          />
        ) : (
          <View style={s.inner}>
            <OfflineBanner flush />
            <StorageBar appBytes={appBytes} />
            {empty ? (
              <EmptyState
                icon="arrow.down.circle"
                title="No downloads yet"
                message="Tap the download button on any movie, episode or album."
                action={signedIn ? { title: 'Browse library', onPress: () => router.navigate('/(tabs)/(library)/libraries') } : undefined}
                style={s.empty}
              />
            ) : null}
            {inProgress.length ? (
              <Animated.View layout={LinearTransition.duration(motion.duration.base)} style={s.section}>
                <View style={s.sectionHead}>
                  <Text style={s.sectionTitle} accessibilityRole="header">
                    {`IN PROGRESS · ${inProgress.length}`}
                  </Text>
                  <Touchable
                    onPress={() => void (allPaused ? downloads.resumeAll() : downloads.pauseAll())}
                    radius={8}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={allPaused ? 'Resume all' : 'Pause all'}>
                    <Text style={s.link}>{allPaused ? 'Resume all' : 'Pause all'}</Text>
                  </Touchable>
                </View>
                <View style={s.card}>
                  {inProgress.map((r, i) => (
                    <Animated.View key={r.itemId} entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.base)}>
                      <ProgressRow record={r} last={i === inProgress.length - 1} />
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            ) : null}
            {sections.map((sec) => (
              <ServerDownloads key={sec.serverId} section={sec} titled={sections.length > 1 || !sec.active} />
            ))}
            {sections.length ? <Text style={s.footer}>Swipe left on a row to delete it. Downloads of every server play with no connection.</Text> : null}
          </View>
        )}
      </ScrollView>
    </>
  );
}

/** The storage bar: Zoggyfin in `accent`, other apps in `controlBorder`, free space in `surface3`. */
function StorageBar({ appBytes }: { appBytes: number }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const space = useDiskSpace();
  if (!space || space.total <= 0) return null;
  const used = Math.max(0, space.total - space.free);
  const app = Math.min(appBytes, used);
  const other = used - app;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / space.total) * 100))}%` as const;
  return (
    <View
      style={s.storage}
      accessible
      accessibilityLabel={`Storage. Zoggyfin uses ${formatBytes(app)}. ${formatBytes(space.free)} free of ${formatBytes(space.total)}.`}>
      <View style={s.storageBar}>
        <View style={{ width: pct(app), minWidth: app > 0 ? 3 : 0, backgroundColor: c.accent }} />
        <View style={{ width: pct(other), backgroundColor: c.controlBorder }} />
      </View>
      <View style={s.legend}>
        <Legend color={c.accent} label={`Zoggyfin ${formatBytes(app)}`} />
        <Legend color={c.controlBorder} label={`Other ${formatBytes(other)}`} />
        <Legend color={c.surface3} label={`Free ${formatBytes(space.free)}`} />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.legendItem}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

function Thumb({ item, video }: { item: BaseItemDto; video: boolean }) {
  return video ? (
    <ItemImage item={item} variant="landscape" width={scaled(70)} aspectRatio={70 / 40} rounded={6} hideArtTitle />
  ) : (
    <ItemImage item={item} variant="square" width={scaled(48)} aspectRatio={1} rounded={6} hideArtTitle />
  );
}

function statusLine(r: DownloadRecord): string {
  const total = r.bytesTotal ?? 0;
  const sizes = total > 0 ? `${formatBytes(r.bytesDone)} of ${formatBytes(total)}` : r.bytesDone > 0 ? formatBytes(r.bytesDone) : null;
  switch (r.state) {
    case 'downloading':
      return [sizes ?? 'Starting', r.speed > 0 ? formatSpeed(r.speed) : null, formatEta(etaSeconds(r))].filter(Boolean).join(' · ');
    case 'queued':
      return ['Waiting', sizes].filter(Boolean).join(' · ');
    case 'paused':
      return r.method === 'transcode' && r.bytesDone === 0 ? 'Paused. Starts again when you resume' : ['Paused', sizes].filter(Boolean).join(' · ');
    case 'failed':
      if (isFileMissing(r)) return 'The downloaded file is missing. Download it again';
      return `Failed. ${r.error ?? 'The download stopped'}${r.retryAt ? '. Tries again soon' : ''}`;
    default:
      return '';
  }
}

function RoundControl({ icon, label, onPress, color }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Touchable kind="icon" radius={radius.pill} onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View style={[s.control, { backgroundColor: pressed ? c.surface3 : c.surface2 }]}>
          <Icon name={icon} size={scaled(iconSize.sm - 2)} color={color ?? c.text} weight="semibold" />
        </View>
      )}
    </Touchable>
  );
}

function ProgressRow({ record: r, last }: { record: DownloadRecord; last: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const open = useOpenDetail();
  const f = fraction(r);
  const failed = r.state === 'failed';
  const cancel = async () => {
    const ok = await confirmDestructive('Cancel download?', `${r.item.Name ?? 'This item'} stops downloading and what was saved is removed.`, 'Cancel download');
    if (ok) await downloads.cancel(r.itemId);
    return ok;
  };
  return (
    <SwipeRow onSwipe={cancel} label="Cancel">
      <Touchable
        kind="row"
        onPress={open ? () => open(r.item) : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${r.item.Name ?? 'Download'}. ${statusLine(r)}`}
        accessibilityActions={[{ name: 'cancel', label: 'Cancel download' }]}
        onAccessibilityAction={() => void cancel()}
        style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowActive]}>
        <Thumb item={r.item} video={r.kind === 'video'} />
        <View style={[s.rowBody, !last && s.line]}>
          <View style={s.flex}>
            <Text style={[s.title, scriptStyle(r.item.Name, s.title)]} numberOfLines={1}>
              {r.item.Name}
            </Text>
            <View style={s.statusRow}>
              {failed ? <Icon name="exclamationmark.triangle" size={scaled(12)} color={c.danger} /> : null}
              <Text style={[s.status, failed && { color: c.danger }]} numberOfLines={2}>
                {statusLine(r)}
              </Text>
            </View>
            {!failed ? (
              <View style={s.track}>
                <View style={[s.fill, { width: `${Math.round(f * 100)}%`, backgroundColor: r.state === 'downloading' ? c.accent : c.text3 }]} />
              </View>
            ) : null}
          </View>
          {failed ? (
            <Touchable onPress={() => downloads.retry(r.itemId)} radius={radius.pill} accessibilityRole="button" accessibilityLabel={isFileMissing(r) ? 'Download again' : 'Retry'}>
              <View style={s.retry}>
                <Text style={s.retryText}>{isFileMissing(r) ? 'Download again' : 'Retry'}</Text>
              </View>
            </Touchable>
          ) : r.state === 'paused' ? (
            <RoundControl icon="play.fill" label="Resume" onPress={() => void downloads.resume(r.itemId)} />
          ) : (
            <RoundControl icon="pause.fill" label="Pause" onPress={() => void downloads.pause(r.itemId)} />
          )}
          <RoundControl icon="xmark" label="Cancel download" onPress={() => void cancel()} />
        </View>
      </Touchable>
    </SwipeRow>
  );
}

const GROUP_WORDS: Record<string, [string, string]> = {
  MusicAlbum: ['song', 'songs'],
  Series: ['episode', 'episodes'],
};

/**
 * The completed downloads of one server. With more than one server, the
 * header names the server, and a server that is not the active one has a
 * Delete button for all its downloads. Every download plays from the device,
 * whatever account is active.
 */
function ServerDownloads({ section, titled }: { section: ServerSection; titled: boolean }) {
  const s = useStyles(makeStyles);
  const nameOf = useServerNames();
  const name = nameOf(section.serverId);
  const remove = async () => {
    const ok = await confirmDestructive(
      `Delete the downloads of ${name}?`,
      `${section.count} ${section.count === 1 ? 'item' : 'items'} (${formatBytes(section.bytes)}) are removed from this device. Nothing changes on the server.`,
      'Delete',
    );
    if (ok) await removeServerDownloads(section.serverId);
  };
  return (
    <Animated.View layout={LinearTransition.duration(motion.duration.base)} style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} accessibilityRole="header" numberOfLines={1}>
          {titled ? `${name.toUpperCase()} · ${section.count}` : `ON THIS DEVICE · ${section.count}`}
        </Text>
        {titled && !section.active ? (
          <Touchable onPress={() => void remove()} radius={8} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete the downloads of ${name}`}>
            <Text style={s.otherDelete}>Delete</Text>
          </Touchable>
        ) : null}
      </View>
      <View style={s.card}>
        {section.groups.map((g, i) => (
          <Animated.View key={g.id} entering={FadeIn.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)}>
            <GroupRow group={g} last={i === section.groups.length - 1} />
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

function GroupRow({ group: g, last }: { group: DownloadGroupView; last: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const player = usePlayer();
  const open = useOpenDetail();
  const [expanded, setExpanded] = useState(false);
  const queueSwipe = useQueueSwipe();
  const single = g.type === 'Single' && g.records.length === 1;
  const first = g.records[0];
  // A single song: "Add to queue" on a swipe right (swipe left deletes). An album queues from its expanded rows.
  const queueItem = single && first?.kind === 'audio' && canQueue(first.item) ? first.item : null;
  const video = first?.kind === 'video';
  const words = GROUP_WORDS[g.type] ?? ['item', 'items'];
  const meta = single
    ? [first?.item.Type === 'Episode' ? first.item.SeriesName : first?.item.ProductionYear ? String(first.item.ProductionYear) : null, formatBytes(g.bytes)]
        .filter(Boolean)
        .join(' · ')
    : `${g.records.length} ${g.records.length === 1 ? words[0] : words[1]} · ${formatBytes(g.bytes)}`;

  const remove = async () => {
    const ok = await confirmDestructive(
      single ? `Delete ${g.name}?` : `Delete ${g.records.length} downloads?`,
      `${single ? 'The download' : `Every download of ${g.name}`} is removed from this device. This frees ${formatBytes(g.bytes)}. Nothing changes on the server.`,
      'Delete',
    );
    if (ok) await (single && first ? downloads.remove(first.itemId) : downloads.removeGroup(g.id));
    return ok;
  };

  const playGroup = () => {
    if (!first) return;
    if (single) player.play({ item: first.item });
    else if (first.kind === 'audio') player.play({ item: first.item, list: g.records.map((r) => r.item), index: 0, context: g.item });
    else player.play({ item: first.item, queue: g.records.slice(1).map((r) => r.item) });
  };

  return (
    <View>
      <SwipeRow onSwipe={remove} leading={queueItem ? queueSwipe.addToQueue(queueItem) : undefined}>
        <Touchable
          kind="row"
          onPress={() => (single ? playGroup() : setExpanded((e) => !e))}
          onLongPress={open ? () => open(single && first ? first.item : g.item) : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${g.name}. ${meta}. Downloaded`}
          accessibilityHint={single ? 'Plays it' : expanded ? 'Hides the items' : 'Shows the items'}
          accessibilityActions={[
            { name: 'delete', label: 'Delete download' },
            ...(queueItem ? [{ name: ADD_TO_QUEUE_ACTION, label: 'Add to queue' }] : []),
            ...(open ? [{ name: 'open', label: 'Open details' }] : []),
          ]}
          onAccessibilityAction={(e) => {
            const name = e.nativeEvent.actionName;
            if (name === 'delete') void remove();
            else if (queueItem && queueSwipe.runAccessibility(name, queueItem)) return;
            else open?.(single && first ? first.item : g.item);
          }}
          style={({ pressed, hovered }) => [s.row, (pressed || hovered) && s.rowActive]}>
          <Thumb item={single && first ? first.item : g.item} video={!!video && single} />
          <View style={[s.rowBody, !last || expanded ? s.line : null]}>
            <View style={s.flex}>
              <Text style={[s.title, scriptStyle(g.name, s.title)]} numberOfLines={1}>
                {g.name}
              </Text>
              <View style={s.statusRow}>
                <Icon name="arrow.down.circle.fill" size={scaled(12)} color={c.success} />
                <Text style={s.status} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
            </View>
            {single ? (
              <RoundControl icon="play.fill" label={`Play ${g.name}`} onPress={playGroup} />
            ) : (
              <>
                <RoundControl icon="play.fill" label={`Play ${g.name}`} onPress={playGroup} />
                <Icon name={expanded ? 'chevron.up' : 'chevron.down'} size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
              </>
            )}
          </View>
        </Touchable>
      </SwipeRow>
      {expanded && !single
        ? g.records.map((r, i) => <ChildRow key={r.itemId} record={r} group={g} index={i} last={last && i === g.records.length - 1} />)
        : null}
    </View>
  );
}

/** Opens an item page. Null with no account signed in: item pages need the server. */
function useOpenDetail(): ((item: BaseItemDto) => void) | null {
  const open = useOpenItem();
  const signedIn = useSessionStore((st) => !!st.session);
  return signedIn ? open : null;
}

function ChildRow({ record: r, group, index, last }: { record: DownloadRecord; group: DownloadGroupView; index: number; last: boolean }) {
  const s = useStyles(makeStyles);
  const player = usePlayer();
  const queueSwipe = useQueueSwipe();
  const queueable = r.kind === 'audio' && canQueue(r.item);
  const open = useOpenDetail();
  const remove = async () => {
    const ok = await confirmDestructive(`Delete ${r.item.Name ?? 'this download'}?`, `This frees ${formatBytes(r.bytesDone)} on this device. Nothing changes on the server.`, 'Delete');
    if (ok) await downloads.remove(r.itemId);
    return ok;
  };
  const play = () => {
    if (r.kind === 'audio') player.play({ item: r.item, list: group.records.map((x) => x.item), index, context: group.item });
    else player.play({ item: r.item });
  };
  return (
    <SwipeRow onSwipe={remove} leading={queueable ? queueSwipe.addToQueue(r.item) : undefined}>
      <Touchable
        kind="row"
        onPress={play}
        onLongPress={open ? () => open(r.item) : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${r.item.Name}, ${formatBytes(r.bytesDone)}`}
        accessibilityHint="Plays it"
        accessibilityActions={[
          { name: 'delete', label: 'Delete download' },
          ...(queueable ? [{ name: ADD_TO_QUEUE_ACTION, label: 'Add to queue' }] : []),
          ...(open ? [{ name: 'open', label: 'Open details' }] : []),
        ]}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (queueable && queueSwipe.runAccessibility(name, r.item)) return;
          if (name === 'open') open?.(r.item);
          else if (name === 'delete') void remove();
        }}
        style={({ pressed, hovered }) => [s.childRow, (pressed || hovered) && s.rowActive]}>
        <Text style={s.childNo}>{r.item.Type === 'Episode' ? `E${r.item.IndexNumber ?? index + 1}` : (r.item.IndexNumber ?? index + 1)}</Text>
        <View style={[s.childBody, !last && s.line]}>
          <Text style={[s.childTitle, scriptStyle(r.item.Name, s.childTitle)]} numberOfLines={1}>
            {r.item.Name}
          </Text>
          <Text style={s.childSize}>{formatBytes(r.bytesDone)}</Text>
        </View>
      </Touchable>
    </SwipeRow>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { backgroundColor: c.bgGrouped },
  content: { flexGrow: 1, paddingTop: spacing.sm, paddingBottom: spacing.huge * 2 },
  inner: { width: '100%' as const, maxWidth: 900, alignSelf: 'center' as const, gap: spacing.xxl, flexGrow: 1 },
  empty: { flex: 1, minHeight: 360 },
  flex: { flex: 1, minWidth: 0 },
  section: { gap: spacing.sm - 2 },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: spacing.lg },
  sectionTitle: { ...font(type.footnote), letterSpacing: 0.4, color: c.text2 },
  link: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent },
  footer: { ...font(type.footnote), color: c.text2, marginHorizontal: spacing.lg },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  otherDelete: { ...font(type.subheadline), fontWeight: '600' as const, color: c.danger },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingLeft: spacing.lg, minHeight: scaled(76), backgroundColor: c.surface },
  rowActive: { backgroundColor: c.surface3 },
  rowBody: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    alignSelf: 'stretch' as const,
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
  },
  line: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  title: { ...font(type.callout), fontWeight: '500' as const, color: c.text },
  statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, marginTop: 2 },
  status: { ...font(type.footnote, { tabular: true }), color: c.text2, flexShrink: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: c.surface3, marginTop: spacing.sm, overflow: 'hidden' as const },
  fill: { height: '100%' as const, borderRadius: 2 },
  control: { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const },
  retry: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 30, justifyContent: 'center' as const },
  retryText: { ...font(type.subheadline), fontWeight: '600' as const, color: c.onAccent },
  childRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingLeft: spacing.lg, backgroundColor: c.surface },
  childNo: { ...font(type.footnote, { tabular: true }), color: c.text3, width: scaled(48), textAlign: 'center' as const },
  childBody: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, minHeight: scaled(44), paddingRight: spacing.lg },
  childTitle: { ...font(type.subheadline), color: c.text, flex: 1 },
  childSize: { ...font(type.footnote, { tabular: true }), color: c.text3 },
  storage: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderCurve: 'continuous' as const },
  storageBar: { height: 8, borderRadius: 4, backgroundColor: c.surface3, overflow: 'hidden' as const, flexDirection: 'row' as const },
  legend: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: spacing.lg, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...font(type.footnote, { tabular: true }), color: c.text2 },
}));
