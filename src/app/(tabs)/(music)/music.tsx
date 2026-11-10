import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useViews } from '@/api/queries';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { audioLibraryKind, isAudioView } from '@/features/library/library-kind';
import { MusicBrowser } from '@/features/music/music-browser';
import { useTabRootPlace } from '@/features/extensions/tab-nav';
import { storage } from '@/storage/kv';
import { useRootScreenOptions } from '@/lib/stack-options';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

const KEY = 'music.library';

export default function MusicScreen() {
  const styles = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const views = useViews();
  const audio = (views.data ?? []).filter(isAudioView);
  // A slim header only for the library picker (more than one music library); it names the picked library.
  const root = useRootScreenOptions({ bar: audio.length > 1 });
  // In the Library stack when an extension tab takes the place of Music on this phone (lib/tab-destination.ts).
  const pushed = useTabRootPlace('(music)', 'music');
  const [chosen, setChosen] = useState(() => storage.getString(KEY));
  const [picker, setPicker] = useState(false);
  const library = audio.find((v) => v.Id === chosen) ?? audio[0];

  return (
    <>
      <Stack.Screen
        options={{
          ...(pushed ? { headerLargeTitleEnabled: false } : root),
          title: audio.length > 1 ? (library?.Name ?? 'Music') : 'Music',
          ...(audio.length > 1 ? { headerTitle: library?.Name ?? 'Music' } : null),
          headerRight:
            audio.length > 1
              ? () => (
                  <Touchable onPress={() => setPicker(true)} hitSlop={8} radius={8} accessibilityRole="button" accessibilityLabel="Choose music library" style={styles.pick}>
                    <Text style={styles.pickText}>Library</Text>
                    <Icon name="chevron.down" size={iconSize.sm - 2} color={c.accent} weight="semibold" />
                  </Touchable>
                )
              : undefined,
        }}
      />
      {/* TV has no header: the library picker sits above the tabs. */}
      {isTV && audio.length > 1 ? (
        <View style={[styles.tvBar, { paddingHorizontal: l.gutter }, chipRowTV()]}>
          <Chip label={library?.Name ?? 'Music'} icon="chevron.down" onPress={() => setPicker(true)} accessibilityLabel={`Music library: ${library?.Name ?? 'Music'}. Choose another`} />
        </View>
      ) : null}
      {views.isPending ? (
        <GridSkeleton shape="square" />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : library?.Id ? (
        <MusicBrowser key={library.Id} libraryId={library.Id} kind={audioLibraryKind(library)} />
      ) : (
        <EmptyState icon="music.note" title="No music library" message="Add a music library on the server to see it here." />
      )}
      <OptionSheet
        visible={picker}
        title="Music library"
        options={audio.map((v) => ({ value: v.Id ?? '', label: v.Name ?? 'Music' }))}
        selected={[library?.Id ?? '']}
        onSelect={(id) => {
          storage.set(KEY, id);
          setChosen(id);
        }}
        onClose={() => setPicker(false)}
      />
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  pick: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, paddingHorizontal: spacing.xs + 2 },
  pickText: { ...font(type.body), color: c.accent },
  tvBar: { flexDirection: 'row' as const },
}));
