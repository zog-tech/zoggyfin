import * as Haptics from 'expo-haptics';
import { memo, useLayoutEffect, useMemo, useState } from 'react';
import { type AccessibilityActionEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from '@/components/icon';
import { openAddToPlaylist } from '@/features/playlists/add-to-playlist';
import { ItemImage } from '@/components/item-image';
import { Touchable } from '@/components/touchable';
import { reorderMoves } from '@/lib/reorder-moves';
import { isTV } from '@/platform/tv';
import { artistLine, type AudioItem } from '@/player/audio/item';
import { queueSections, type QueueEntry } from '@/player/audio/queue';
import { audioSession } from '@/player/audio/session';
import { useAudioStore } from '@/player/audio/store';
import { font, scriptStyle, tv, type } from '@/theme';

import { PlayerSheet } from '../player/player-sheet';
import { c, motion, radius, spacing } from '../player/tokens';

export const QUEUE_ROW_HEIGHT = 60;
/** Rows after this many are summarised: a queue can hold a whole library. */
const MAX_ROWS = 150;
/** The red Remove area slides in from the trailing edge by the swipe distance. */
const REVEAL_WIDTH = 600;

function haptic(kind: 'medium' | 'light' | 'selection') {
  if (Platform.OS === 'web') return;
  if (kind === 'selection') void Haptics.selectionAsync();
  else void Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}

/**
 * The queue (design system §7.10): Now playing, Up next (Play next / Add to
 * queue) and "Playing from {album}". Drag the handle (or long-press a row)
 * to reorder, swipe left to remove. Shuffle, Repeat and Clear sit at the top.
 * Screen readers and keyboards get Move up, Move down and Remove actions.
 * TV has no drag or swipe: each row has a More button with the moves and
 * Remove.
 */
export function QueuePanel({
  selectedKey,
  onSelect,
  toolbar = true,
}: {
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Shuffle, repeat, Save and Clear above the list. The TV player has shuffle and repeat in its own row. */
  toolbar?: boolean;
}) {
  const queue = useAudioStore((s) => s.queue);
  const sections = useMemo(() => queueSections(queue), [queue]);
  const s = audioSession();
  const sourceName = queue.source?.name;
  const restShown = sections.rest.slice(0, MAX_ROWS);
  const hidden = sections.rest.length - restShown.length;
  const repeatIcon: IconName = queue.repeat === 'one' ? 'repeat.1' : 'repeat';
  const repeatLabel = queue.repeat === 'off' ? 'Repeat off' : queue.repeat === 'all' ? 'Repeat all' : 'Repeat one';
  // TV: the row whose menu is open, with the section it can move in.
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const menuRow = menu ? menu.rows[menu.position] : undefined;
  const menuRows = menu && menuRow
    ? [
        ...reorderMoves(menu.position, menu.rows.length).map((m) => ({
          key: m.key,
          label: m.label,
          selected: false,
          onPress: () => audioSession().move(menuRow.index, menu.rows[m.to]?.index ?? menuRow.index),
        })),
        { key: 'remove', label: 'Remove from the queue', selected: false, onPress: () => audioSession().remove(menuRow.entry.key) },
      ]
    : [];

  return (
    <View style={styles.root}>
      {toolbar ? (
        <View style={styles.controls}>
        <Toggle icon="shuffle" label="Shuffle" active={queue.shuffle} onPress={() => s.toggleShuffle()} />
        <Toggle icon={repeatIcon} label={repeatLabel} active={queue.repeat !== 'off'} onPress={() => s.cycleRepeat()} />
        <View style={styles.flex} />
        <Touchable
          kind="button"
          radius={radius.sm}
          onPress={() => openAddToPlaylist(queue.entries.map((e) => e.item))}
          accessibilityRole="button"
          accessibilityLabel="Save the queue to a playlist"
          hitSlop={8}
          style={styles.clear}>
          <Text style={styles.clearText}>Save</Text>
        </Touchable>
        {sections.upNext.length + sections.rest.length > 0 ? (
          <Touchable kind="button" radius={radius.sm} onPress={() => s.clearQueue()} accessibilityRole="button" accessibilityLabel="Clear the queue" hitSlop={8} style={styles.clear}>
            <Text style={styles.clearText}>Clear</Text>
          </Touchable>
        ) : null}
        </View>
      ) : null}
      <ScrollView style={styles.flex} contentContainerStyle={[styles.content, isTV && styles.contentTV]} showsVerticalScrollIndicator={false}>
        {sections.current ? (
          <>
            <Text style={styles.header} accessibilityRole="header">
              Now playing
            </Text>
            <QueueRow entry={sections.current} current onPress={() => undefined} />
          </>
        ) : null}
        {sections.upNext.length ? (
          <>
            <Text style={styles.header} accessibilityRole="header">
              Up next
            </Text>
            <ReorderList rows={sections.upNext} selectedKey={selectedKey} onSelect={onSelect} onMenu={setMenu} />
          </>
        ) : null}
        {restShown.length ? (
          <>
            <Text style={styles.header} accessibilityRole="header" numberOfLines={1}>
              {sourceName ? `Playing from ${sourceName}` : 'Playing next'}
            </Text>
            <ReorderList rows={restShown} selectedKey={selectedKey} onSelect={onSelect} onMenu={setMenu} />
            {hidden > 0 ? <Text style={styles.more}>And {hidden} more</Text> : null}
          </>
        ) : null}
        {!sections.upNext.length && !restShown.length ? <Text style={styles.empty}>Nothing plays after this.</Text> : null}
      </ScrollView>
      {isTV ? (
        <PlayerSheet
          visible={!!menuRow}
          title={menuRow?.entry.item.Name ?? 'Queue'}
          sections={[{ title: 'Queue', rows: menuRows }]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

function Toggle({ icon, label, active, onPress }: { icon: IconName; label: string; active: boolean; onPress: () => void }) {
  return (
    <Touchable
      kind="button"
      radius={radius.pill}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      style={[styles.toggle, active && styles.toggleOn]}>
      <Icon name={icon} size={18} color={active ? c.onAccent : c.textOnMedia} weight="semibold" />
    </Touchable>
  );
}

interface Row {
  entry: QueueEntry<AudioItem>;
  index: number;
}

/** TV: the row whose menu is open, and the section it moves in. */
interface RowMenu {
  rows: Row[];
  position: number;
}

/** One section of rows that can be reordered among themselves. */
function ReorderList({
  rows,
  selectedKey,
  onSelect,
  onMenu,
}: {
  rows: Row[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  onMenu: (menu: RowMenu) => void;
}) {
  const active = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const count = useSharedValue(rows.length);
  // The handle and the long-press both end a drag; only the first one commits.
  const dropping = useSharedValue(false);
  const keys = rows.map((r) => r.entry.key).join('|');
  // After a drop the store reorders the rows; only then do the offsets go back to zero.
  useLayoutEffect(() => {
    count.set(rows.length);
    active.set(-1);
    dragY.set(0);
    dropping.set(false);
  }, [keys, rows.length, count, active, dragY, dropping]);
  const target = useDerivedValue(() => {
    const a = active.get();
    if (a < 0) return -1;
    return Math.min(count.get() - 1, Math.max(0, a + Math.round(dragY.get() / QUEUE_ROW_HEIGHT)));
  });
  const commit = (from: number, to: number) => {
    const a = rows[from];
    const b = rows[to];
    if (a && b && from !== to) audioSession().move(a.index, b.index);
    else {
      active.set(-1);
      dragY.set(0);
      dropping.set(false);
    }
  };
  return (
    <View>
      {rows.map((r, i) => (
        <DraggableRow
          key={r.entry.key}
          row={r}
          position={i}
          rows={rows}
          active={active}
          dragY={dragY}
          dropping={dropping}
          target={target}
          selected={selectedKey === r.entry.key}
          onSelect={onSelect}
          onCommit={commit}
          onMenu={onMenu}
        />
      ))}
    </View>
  );
}

const DraggableRow = memo(function DraggableRow({
  row,
  position,
  rows,
  active,
  dragY,
  dropping,
  target,
  selected,
  onSelect,
  onCommit,
  onMenu,
}: {
  row: Row;
  position: number;
  rows: Row[];
  active: SharedValue<number>;
  dragY: SharedValue<number>;
  dropping: SharedValue<boolean>;
  target: SharedValue<number>;
  selected: boolean;
  onSelect?: (key: string | null) => void;
  onCommit: (from: number, to: number) => void;
  onMenu: (menu: RowMenu) => void;
}) {
  const reduced = useReducedMotion();
  const swipeX = useSharedValue(0);
  const key = row.entry.key;
  const remove = () => audioSession().remove(key);
  const pickUp = () => haptic('medium');

  const drag = Gesture.Pan()
    .onBegin(() => {
      if (dropping.get()) return;
      active.set(position);
      dragY.set(0);
      scheduleOnRN(pickUp);
    })
    .onUpdate((e) => dragY.set(e.translationY))
    .onEnd(() => {
      if (active.get() !== position || dropping.get()) return;
      dropping.set(true);
      const to = target.get();
      dragY.set(withSpring((to - position) * QUEUE_ROW_HEIGHT, motion.spring.smooth));
      scheduleOnRN(onCommit, position, to);
    })
    .onFinalize((_e, ok) => {
      if (!ok && !dropping.get()) {
        active.set(-1);
        dragY.set(0);
      }
    });
  const longPressDrag = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      if (dropping.get()) return;
      active.set(position);
      dragY.set(0);
      scheduleOnRN(pickUp);
    })
    .onUpdate((e) => dragY.set(e.translationY))
    .onEnd(() => {
      if (active.get() !== position || dropping.get()) return;
      dropping.set(true);
      const to = target.get();
      dragY.set(withSpring((to - position) * QUEUE_ROW_HEIGHT, motion.spring.smooth));
      scheduleOnRN(onCommit, position, to);
    });
  const swipe = Gesture.Pan()
    .activeOffsetX([-16, 1000])
    .failOffsetY([-12, 12])
    .onUpdate((e) => swipeX.set(Math.min(0, e.translationX)))
    .onEnd((e) => {
      if (e.translationX < -110 || e.velocityX < -900) {
        swipeX.set(withTiming(-500, { duration: motion.duration.fast }));
        scheduleOnRN(remove);
      } else {
        swipeX.set(withSpring(0, { ...motion.spring.snappy, velocity: e.velocityX }));
      }
    });
  const rowGesture = Gesture.Race(longPressDrag, swipe);

  const style = useAnimatedStyle(() => {
    const a = active.get();
    if (a === position) {
      return { transform: [{ translateY: dragY.get() }, { scale: reduced ? 1 : 1.02 }], zIndex: 10, opacity: 0.96 };
    }
    if (a < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity: 1 };
    const t = target.get();
    const shift = a < position && position <= t ? -QUEUE_ROW_HEIGHT : t <= position && position < a ? QUEUE_ROW_HEIGHT : 0;
    return { transform: [{ translateY: reduced ? shift : withSpring(shift, motion.spring.smooth) }, { scale: 1 }], zIndex: 0, opacity: 1 };
  });
  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipeX.get() }] }));
  const removeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: REVEAL_WIDTH + swipeX.get() }] }));

  const actions = [
    { name: 'moveUp', label: 'Move up' },
    { name: 'moveDown', label: 'Move down' },
    { name: 'remove', label: 'Remove from the queue' },
  ];
  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'remove') remove();
    if (name === 'moveUp' && position > 0) audioSession().move(row.index, rows[position - 1]?.index ?? row.index);
    if (name === 'moveDown' && position < rows.length - 1) audioSession().move(row.index, rows[position + 1]?.index ?? row.index);
  };

  return (
    <Animated.View style={[styles.rowWrap, isTV && styles.rowWrapTV, style]}>
      {/* TV: no swipe, and no clipping, so the focus ring shows. */}
      {isTV ? null : (
        <Animated.View style={[styles.removeBehind, removeStyle]} pointerEvents="none">
          <Icon name="trash" size={18} color={c.textOnMedia} />
          <Text style={styles.removeText}>Remove</Text>
        </Animated.View>
      )}
      <GestureDetector gesture={rowGesture}>
        <Animated.View style={swipeStyle}>
          <QueueRow
            entry={row.entry}
            selected={selected}
            onPress={() => {
              onSelect?.(null);
              audioSession().jump(key);
            }}
            accessibilityActions={actions}
            onAccessibilityAction={onAction}
            handle={
              isTV ? (
                <Touchable
                  kind="icon"
                  radius={22}
                  onPress={() => onMenu({ rows, position })}
                  style={styles.handle}
                  accessibilityRole="button"
                  accessibilityLabel={`More for ${row.entry.item.Name ?? 'this song'}`}>
                  <Icon name="ellipsis" size={18} color={c.textOnMedia} />
                </Touchable>
              ) : (
              <GestureDetector gesture={drag}>
                <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Icon name="line.3.horizontal" size={18} color={c.textOnMediaSecondary} />
                </View>
              </GestureDetector>
              )
            }
          />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

function QueueRow({
  entry,
  current,
  selected,
  onPress,
  handle,
  accessibilityActions,
  onAccessibilityAction,
}: {
  entry: QueueEntry<AudioItem>;
  current?: boolean;
  selected?: boolean;
  onPress: () => void;
  handle?: React.ReactNode;
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  const item = entry.item;
  const artist = artistLine(item);
  const body = (
    <>
      <ItemImage item={item} variant="square" width={44} aspectRatio={1} rounded={radius.sm} hideArtTitle />
      <View style={styles.rowText}>
        <Text style={[styles.title, current && styles.titleCurrent, scriptStyle(item.Name, styles.title)]} numberOfLines={1}>
          {item.Name}
        </Text>
        {artist ? (
          <Text style={[styles.sub, scriptStyle(artist, styles.sub)]} numberOfLines={1}>
            {artist}
          </Text>
        ) : null}
      </View>
    </>
  );
  const label = [item.Name, artist, current ? 'now playing' : null].filter(Boolean).join(', ');
  // The song that plays now has nothing to press.
  if (current) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {body}
        <Icon name="waveform" size={18} color={c.accent} weight="semibold" />
      </View>
    );
  }
  // TV: the More button sits next to the row, not inside it, so Right can reach it.
  const tvSplit = isTV && !!handle;
  const row = (
    <Touchable
      kind="row"
      radius={radius.md}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Plays this now"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      containerStyle={tvSplit ? styles.flex : undefined}
      style={({ pressed }) => [styles.row, (pressed || selected) && styles.rowPressed]}>
      {body}
      {tvSplit ? null : handle}
    </Touchable>
  );
  if (!tvSplit) return row;
  return (
    <View style={styles.tvRow}>
      {row}
      {handle}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  // TV: room for the focus ring at the sides.
  contentTV: { paddingHorizontal: tv.focusRingWidth + tv.focusRingGap },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  toggle: {
    width: 44,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toggleOn: { backgroundColor: c.accent },
  clear: { paddingHorizontal: spacing.sm, height: 36, justifyContent: 'center' },
  clearText: { ...font(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  header: { ...font(type.headline), color: c.textOnMedia, marginTop: spacing.lg, marginBottom: spacing.xs },
  rowWrap: { height: QUEUE_ROW_HEIGHT, justifyContent: 'center', overflow: 'hidden', borderRadius: radius.md },
  rowWrapTV: { overflow: 'visible' },
  removeBehind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: REVEAL_WIDTH,
    backgroundColor: c.danger,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.lg,
  },
  removeText: { ...font(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  row: {
    height: QUEUE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.10)' },
  tvRow: { height: QUEUE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowText: { flex: 1, minWidth: 0 },
  title: { ...font(type.subheadline), fontWeight: '600', color: c.textOnMedia },
  titleCurrent: { color: c.accent },
  sub: { ...font(type.footnote), color: c.textOnMediaSecondary },
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  more: { ...font(type.footnote), color: c.textOnMediaSecondary, marginTop: spacing.md, textAlign: 'center' },
  empty: { ...font(type.subheadline), color: c.textOnMediaSecondary, marginTop: spacing.xl, textAlign: 'center' },
});
