/**
 * Settings → Extensions: add an extension from its address, see the
 * installed ones, open their pages, and send a link to one.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { requestInstall } from '@/extensions/runtime';
import { safeHost } from '@/extensions/schema';
import { useExtensions } from '@/extensions/store';
import { pendingUpdatesOf, useExtensionUpdates } from '@/extensions/update-check';
import { Group, makeSettingsStyles, SettingsRow } from '@/features/settings/rows';
import { TvScrollView } from '@/features/tv/page-scroll';
import { features } from '@/platform/tv';
import { spacing, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

export default function ExtensionsScreen() {
  const styles = useStyles(makeSettingsStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const list = useExtensions((st) => st.list);
  const account = useExtensions((st) => st.account);
  const pending = useExtensionUpdates((st) => pendingUpdatesOf(st, account));
  const [address, setAddress] = useState('');
  // TV has no extension panels (web pages the remote cannot use).
  const panels = features.extensionPanels ? list.filter((e) => e.enabled).flatMap((e) => (e.manifest.contributes.panels ?? []).map((p) => ({ ext: e, panel: p }))) : [];
  const takesLinks = list.some((e) => e.enabled && (e.manifest.contributes.shareTargets?.length ?? 0) > 0);

  const add = () => {
    if (!address.trim()) return;
    void requestInstall([address]);
    setAddress('');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Extensions', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}>
        <View style={styles.inner}>
          {panels.length || takesLinks ? (
            <Group>
              {takesLinks ? <SettingsRow icon="globe" label="Send a link" onPress={() => router.push('/share')} last={!panels.length} /> : null}
              {panels.map(({ ext, panel }, i) => (
                <SettingsRow
                  key={`${ext.manifest.id}.${panel.id}`}
                  icon="square.grid.2x2"
                  label={panel.title}
                  value={panel.title === ext.manifest.name ? undefined : ext.manifest.name}
                  onPress={() => router.push({ pathname: '/extension-panel', params: { ext: ext.manifest.id, panel: panel.id } })}
                  last={i === panels.length - 1}
                />
              ))}
            </Group>
          ) : null}

          {list.length ? (
            <Group title="Installed">
              {list.map((e, i) => (
                <SettingsRow
                  key={e.manifest.id}
                  icon="square.grid.2x2"
                  label={e.manifest.name}
                  value={pending[e.manifest.id] ? 'Update available' : e.enabled ? safeHost(e.manifest.baseUrl) : 'Off'}
                  onPress={() => router.push({ pathname: '/(tabs)/(home)/extensions/[id]', params: { id: e.manifest.id } })}
                  last={i === list.length - 1}
                />
              ))}
            </Group>
          ) : null}

          <Group title="Add an extension" footer="Enter the address of the extension's server, or the link to its zoggyfin-extension.json file. Extensions add buttons, Home rows and pages from your own servers. They run no code in the app.">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <TextField
                label="Address"
                value={address}
                onChangeText={setAddress}
                placeholder="http://192.0.2.10:3000"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={add}
              />
              <Button title="Add" onPress={add} disabled={!address.trim()} />
            </View>
          </Group>
          {!list.length ? <Text style={[styles.footer, { textAlign: 'center' }]}>No extensions yet.</Text> : null}
        </View>
      </TvScrollView>
    </>
  );
}
