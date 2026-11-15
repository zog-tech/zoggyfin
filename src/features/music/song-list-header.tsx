/**
 * The top of the Liked Songs and Downloaded music tabs: how many songs the
 * list holds, and Play and Shuffle for the whole list. `songs` may load the
 * rest of a paged list first, so Play and Shuffle cover every song, not only
 * the first page. A second tap while that load runs does nothing, so it
 * never starts a second queue.
 */
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { Button } from '@/components/button';
import { usePlayer } from '@/player';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, spacing, type, useLayout, useStyles } from '@/theme';

export function songCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
}

export function SongListHeader({
  count,
  songs,
  context,
}: {
  count: number;
  /** Every song of the list, in order. */
  songs: () => BaseItemDto[] | Promise<BaseItemDto[]>;
  /** What the queue says it plays from ("Playing from Liked Songs"). */
  context?: BaseItemDto;
}) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const player = usePlayer();
  // The ref guards against two taps in one frame; the state only dims the buttons.
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const start = async (shuffle: boolean) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const list = await songs();
      if (!list.length) return;
      const index = shuffle ? Math.floor(Math.random() * list.length) : 0;
      const item = list[index];
      if (item) player.play({ item, list, index, context, shuffle });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, { paddingHorizontal: l.gutter }]}>
      <Text style={s.count}>{songCountLabel(count)}</Text>
      <View style={[styles.row, l.fontScale >= 1.5 && styles.stack]}>
        <Button title="Play" icon="play.fill" variant="tonalAccent" disabled={busy || count === 0} onPress={() => start(false)} containerStyle={styles.flex} preferredFocus={isTV} />
        <Button title="Shuffle" icon="shuffle" variant="tonalAccent" disabled={busy || count === 0} onPress={() => start(true)} containerStyle={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  stack: { flexDirection: 'column' },
});

const makeStyles = createStyles(({ c }: AppTheme) => ({
  root: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  count: { ...font(type.subheadline), color: c.text2 },
}));
