/**
 * The IPTV providers of this account: each opens its edit form (name,
 * login, reload, remove); two rows add an Xtream login or an M3U playlist.
 * With two providers or more: what Live TV opens on (the last one used,
 * "All providers" or one provider) and the order (chips, the browse column
 * and "All providers" follow it). Settings rows (design system §7.15).
 */
import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Group, makeSettingsStyles, SettingsRow } from '@/features/settings/rows';
import { TvScrollView } from '@/features/tv/page-scroll';
import { ALL_PROVIDERS, iptv, type ProviderRecord, useProviders, useStartWith } from '@/iptv';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { features, isTV } from '@/platform/tv';
import { iconSize, scaled, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

import { providerFormHref, useLiveGroup } from './nav';

function ago(ms: number | null): string {
  if (!ms) return 'not loaded yet';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'loaded just now';
  if (min < 60) return `loaded ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `loaded ${h} h ago`;
  return `loaded ${Math.round(h / 24)} days ago`;
}

export function describeProvider(p: ProviderRecord): string {
  const kind = p.kind === 'xtream' ? 'Xtream' : 'M3U';
  return `${kind} · ${p.channelCount} ${p.channelCount === 1 ? 'channel' : 'channels'} · ${ago(p.refreshedAt)}`;
}

export function ProvidersScreen() {
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const providers = useProviders();
  const startWith = useStartWith();
  const group = useLiveGroup();
  const starts: { value: string | null; label: string; icon: 'clock.arrow.circlepath' | 'square.stack' | 'tv' }[] = [
    { value: null, label: 'The last one used', icon: 'clock.arrow.circlepath' },
    { value: ALL_PROVIDERS, label: 'All providers', icon: 'square.stack' },
    ...providers.map((p) => ({ value: p.id, label: p.name, icon: 'tv' as const })),
  ];
  const check = (on: boolean) => (on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : <View />);
  const bottomPad = useTabBottomPadding();
  const sidebar = useSidebarInset();
  return (
    <>
      <Stack.Screen options={{ title: 'IPTV Providers', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar } : null]}>
        <View style={styles.inner}>
          {isTV ? <Text style={styles.name}>IPTV Providers</Text> : null}
          {providers.length ? (
            <Group title="Providers" footer="Providers belong to this account on this device. Passwords and list addresses stay in the device's secure storage.">
              {providers.map((p, i) => (
                <SettingsRow
                  key={p.id}
                  icon={p.kind === 'xtream' ? 'key' : 'list.bullet'}
                  label={p.name}
                  value={describeProvider(p)}
                  onPress={() => router.push(providerFormHref(group, { id: p.id }))}
                  last={i === providers.length - 1}
                />
              ))}
            </Group>
          ) : null}
          {providers.length > 1 ? (
            <Group title="Open Live TV on" footer="All providers shows the favourites, recently watched channels and search of every provider together.">
              {starts.map((o, i) => (
                <SettingsRow
                  key={o.value ?? 'last'}
                  icon={o.icon}
                  label={o.label}
                  onPress={() => {
                    iptv.setStartWith(o.value);
                    // The choice shows at once, not only at the next start.
                    if (o.value) iptv.setActive(o.value);
                  }}
                  role="radio"
                  checked={startWith === o.value}
                  last={i === starts.length - 1}
                  trailing={check(startWith === o.value)}
                />
              ))}
            </Group>
          ) : null}
          {providers.length > 1 ? (
            <Group title="Order" footer="Select a provider to move it up one place. Live TV lists the providers in this order.">
              {providers.map((p, i) => (
                <SettingsRow
                  key={p.id}
                  icon={i === 0 ? 'tv' : 'arrow.up'}
                  label={p.name}
                  value={i === 0 ? 'First' : 'Move up'}
                  onPress={() => iptv.move(p.id, -1)}
                  last={i === providers.length - 1}
                  trailing={<View />}
                />
              ))}
            </Group>
          ) : null}
          <Group
            title="Add a provider"
            footer={
              features.iptvNeedsCors
                ? 'In a browser, a provider works only when it allows web pages to read its lists. The apps for phones, TVs and the Mac work with every provider.'
                : 'Your provider gives you either an Xtream login (server, user name and password) or an M3U playlist address.'
            }>
            <SettingsRow icon="key" label="Xtream login" onPress={() => router.push(providerFormHref(group, { kind: 'xtream' }))} />
            <SettingsRow icon="list.bullet" label="M3U playlist" onPress={() => router.push(providerFormHref(group, { kind: 'm3u' }))} last />
          </Group>
        </View>
      </TvScrollView>
    </>
  );
}
