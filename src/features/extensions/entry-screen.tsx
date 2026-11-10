/**
 * The page of one extension entry (the route of an entry with `detail`).
 * For now it shows the entry's title and a short note; the detail page
 * (pictures, text, Play, buttons, more sections) replaces the body later.
 * The route params are checked again: a detail URL that is not on the
 * extension's origin shows "not available".
 */
import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { EmptyState } from '@/components/states';
import { useExtensions } from '@/extensions/store';
import { createStyles, type AppTheme, font, scaled, sizes, spacing, type, useStyles } from '@/theme';

import { parseEntryRoute } from './routes';

type Param = string | string[] | undefined;

export function EntryScreen({ params }: { params: { ext?: Param; entry?: Param; detail?: Param; title?: Param } }) {
  const s = useStyles(makeStyles);
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === (Array.isArray(params.ext) ? params.ext[0] : params.ext)));
  const route = parseEntryRoute(params, ext?.manifest.baseUrl);
  if (!ext || !route) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="square.grid.2x2" title="This page is not available" message={ext ? `${ext.manifest.name} did not send a page the app can open.` : 'The extension is not installed.'} />
      </>
    );
  }
  const title = route.title ?? ext.manifest.name;
  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={s.page}>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.note}>Coming soon. The page of this entry arrives in a later update.</Text>
      </View>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bg, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, padding: spacing.xxl },
  title: { ...font(type.title2), color: c.text, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
  note: { ...font(type.body), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
}));
