import * as Application from 'expo-application';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Switch, Text, View } from 'react-native';

import { clearQueryCache } from '@/api/query-client';
import { useApi } from '@/api/use-api';
import { clientIdentity } from '@/auth/identity';
import { useAccounts } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { type Option, OptionSheet } from '@/components/option-sheet';
import { LITE_CHOICES, type LiteChoice, liteLabel } from '@/platform/lite';
import { useLite } from '@/platform/use-lite';
import { DOWNLOAD_QUALITY_OPTIONS, downloadsSupported, useDownloadLists } from '@/downloads';
import { AdminFixturesGroup, AdminSettingsGroup, AdminShieldButton } from '@/features/admin/entry';
import { openAddServer, signOutUser } from '@/features/servers/actions';
import { providersHref } from '@/features/iptv/nav';
import { ConnectionStatus } from '@/features/servers/connection-status';
import { ActionRow, Group, InfoRow, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { SkipSection } from '@/features/settings/skip-section';
import { SubtitlesSection } from '@/features/settings/subtitles-section';
import { TvScrollView } from '@/features/tv/page-scroll';
import { UpdateSettingsRow } from '@/features/updates/update-row';
import { confirmDestructive as confirm } from '@/lib/confirm';
import { devOffline, setDevOffline } from '@/lib/dev-offline';
import { useExtensions } from '@/extensions/store';
import { useProviders } from '@/iptv';
import { checkServer } from '@/lib/online';
import { formatBytes } from '@/lib/format';
import { otaLabel, runningOta } from '@/lib/ota';
import { toast } from '@/lib/toast';
import { appVersion } from '@/platform/desktop';
import { isTV } from '@/platform/tv';
import { TV_LOOK_CHOICES, type TvLookChoice, tvLookLabel } from '@/platform/tv-look';
import { clearTvLookOverride, shownTvLookChoice, tvLook, tvLookPending } from '@/platform/tv-look-now';
import { confirmRestart, restartApp } from '@/lib/restart';
import { useTvLookSetting } from '@/settings/tv-look';
import { APPEARANCE_OPTIONS, useAppearance } from '@/settings/appearance';
import { useHomeSettings } from '@/settings/home';
import { useTabBarSettings } from '@/settings/tab-bar';
import { QUALITY_OPTIONS, qualityLabel, SKIP_OPTIONS, usePlaybackSettings } from '@/settings/playback';
import { FADE_CHOICES, fadeLabel } from '@/player/audio/crossfade';
import { audioSession } from '@/player/audio/session';
import { iconSize, mediaColors, scaled, sizes, spacing, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';
import { HAS_ACCESSORY, useTabBottomPadding } from '@/lib/tab-bar-inset';
import { openTabRoot } from '@/features/extensions/tab-nav';

export default function SettingsScreen() {
  const styles = useStyles(makeSettingsStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const { session } = useApi();
  const [busy, setBusy] = useState(false);
  // The iPad sidebar floats over the content: center the column in the space beside it.
  const sidebar = useSidebarInset();
  const id = clientIdentity();

  const signOut = async () => {
    setBusy(true);
    try {
      await signOutUser({ serverId: session.serverId, userId: session.userId });
    } finally {
      setBusy(false);
    }
  };

  const clearCache = async () => {
    if (!(await confirm('Clear cache?', 'Cached pages and images of all servers are removed. Nothing on the server changes.', 'Clear'))) return;
    clearQueryCache();
    try {
      const { Image } = await import('expo-image');
      await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
    } catch {
      // Image cache clearing is best effort.
    }
    toast('Cache cleared', { icon: 'checkmark' });
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}>
        <View style={styles.inner}>
          <Group>
            <View style={[styles.row, styles.account]}>
              <Avatar session={session} size={sizes.avatarLarge} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {session.userName}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {session.serverName}
                </Text>
              </View>
            </View>
            <ConnectionStatus serverId={session.serverId} inset />
          </Group>

          <Group footer="Sign in on a TV or another device with a code, not a password.">
            <SettingsRow icon="qrcode" label="Quick Connect" onPress={() => router.push('/(tabs)/(home)/quick-connect')} last />
          </Group>

          <ServersSection />

          <AdminSettingsGroup />

          {/* TV is always dark; it chooses its look instead. */}
          {isTV ? <TvLookSection /> : <AppearanceSection />}

          <HomeSection />

          {/* Only the iOS 26 tab bar can shrink on scroll. */}
          {HAS_ACCESSORY ? <TabBarSection /> : null}

          <PlaybackSection />

          <SkipSection />

          <SubtitlesSection />

          {downloadsSupported ? <DownloadsSection /> : null}

          <ExtensionsSection />

          <LiveTvSection />

          <Group title="This device" footer="Zoggyfin is open source under the MPL-2.0. It is not affiliated with the Jellyfin project.">
            <InfoRow icon="tv" label="Device" value={id.device} />
            <InfoRow
              icon="square.stack"
              label="App version"
              value={
                appVersion ??
                [
                  `${Application.nativeApplicationVersion ?? id.version}${Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : ''}`,
                  otaLabel(runningOta()),
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
            />
            <UpdateSettingsRow />
            <SettingsRow icon="lock.fill" label="Privacy policy" onPress={() => void Linking.openURL('https://zoggyfin.zog-tech.com/privacy')} />
            <SettingsRow icon="info.circle" label="Help and support" onPress={() => void Linking.openURL('https://zoggyfin.zog-tech.com/support')} last />
          </Group>

          {__DEV__ ? <DevSection /> : null}
          {__DEV__ ? <AdminFixturesGroup /> : null}

          <Group>
            <ActionRow label="Clear cache" onPress={clearCache} />
          </Group>
          <Group>
            <ActionRow label={busy ? 'Signing out' : `Sign ${session.userName} out`} onPress={signOut} disabled={busy} />
          </Group>
        </View>
      </TvScrollView>
    </>
  );
}

/** Saved servers: each opens its page (addresses, mode, Wi-Fi rule, users). */
function ServersSection() {
  const { servers, active } = useAccounts();
  const { c } = useTheme();
  return (
    <Group title="Servers" footer="A server can have more than one address. The app uses the first address in the list that answers.">
      {servers.map((sv) => {
        const users = sv.users.length;
        return (
          <SettingsRow
            key={sv.id}
            icon="server.rack"
            label={sv.name}
            value={`${sv.addresses.length} ${sv.addresses.length === 1 ? 'address' : 'addresses'} · ${users} ${users === 1 ? 'user' : 'users'}`}
            onPress={() => router.push({ pathname: '/(tabs)/(home)/server/[id]', params: { id: sv.id } })}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <AdminShieldButton serverId={sv.id} serverName={sv.name} />
                {active?.serverId === sv.id ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
                <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
              </View>
            }
          />
        );
      })}
      <SettingsRow icon="plus" label="Add server" onPress={openAddServer} last />
    </Group>
  );
}

type PickerKey = 'wifi' | 'cellular' | 'back' | 'forward' | 'fade' | null;

function AppearanceSection() {
  const choice = useAppearance((st) => st.choice);
  const setChoice = useAppearance((st) => st.setChoice);
  const { c } = useTheme();
  return (
    <Group title="Appearance" footer="System follows the light or dark setting of this device. Players are always dark.">
      {APPEARANCE_OPTIONS.map((o, i) => (
        <SettingsRow
          key={o.value}
          icon={o.value === 'system' ? 'circle.lefthalf.filled' : o.value === 'dark' ? 'moon.fill' : 'sun.max.fill'}
          label={o.label}
          onPress={() => setChoice(o.value)}
          role="radio"
          checked={choice === o.value}
          last={i === APPEARANCE_OPTIONS.length - 1}
          trailing={choice === o.value ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : <View />}
        />
      ))}
    </Group>
  );
}

/** TV: the look (Classic or Modern). It applies at the next start, so a change asks for a restart. */
function TvLookSection() {
  const saved = useTvLookSetting((st) => st.choice);
  const choice = shownTvLookChoice(saved);
  const setChoice = useTvLookSetting((st) => st.setChoice);
  const [open, setOpen] = useState(false);
  const options: Option<TvLookChoice>[] = TV_LOOK_CHOICES.map((v) => ({
    value: v,
    label: v === 'auto' ? 'Auto: Modern, or Classic on Fire TV and in Lite mode' : v === 'modern' ? 'Modern' : 'Classic',
  }));
  const pending = tvLookPending(choice);
  const choose = async (v: TvLookChoice) => {
    // The web preview parameter would win over the new choice after the reload.
    clearTvLookOverride();
    setChoice(v);
    if (!tvLookPending(v)) return;
    if (await confirmRestart('Restart Zoggyfin to change the look?')) await restartApp();
  };
  return (
    <Group title="Appearance" footer="Modern is the new design for TV. Classic is the earlier design. The change needs a restart.">
      <SettingsRow
        icon="tv"
        label="TV look"
        value={`${tvLookLabel(choice, tvLook)}${pending ? ' · restart to apply' : ''}`}
        onPress={() => setOpen(true)}
        last
      />
      <OptionSheet visible={open} title="TV look" options={options} selected={[choice]} onSelect={(v) => void choose(v)} onClose={() => setOpen(false)} />
    </Group>
  );
}

function HomeSection() {
  const music = useHomeSettings((st) => st.music);
  const update = useHomeSettings((st) => st.update);
  const { c } = useTheme();
  return (
    <Group title="Home" footer="Music keeps its own tab when its rows are off Home.">
      <SettingsRow
        icon="music.note"
        label="Show music on Home"
        onPress={() => update({ music: !music })}
        role="switch"
        checked={music}
        last
        trailing={
          <Switch
            value={music}
            onValueChange={(v) => update({ music: v })}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Show music on Home"
          />
        }
      />
    </Group>
  );
}

function TabBarSection() {
  const collapse = useTabBarSettings((st) => st.collapseOnScroll);
  const update = useTabBarSettings((st) => st.update);
  const { c } = useTheme();
  return (
    <Group title="Tab bar" footer="When on, the tab bar and the mini player shrink while you scroll down a page. Scroll up to bring them back.">
      <SettingsRow
        icon="arrow.up.arrow.down"
        label="Collapse on scroll"
        onPress={() => update({ collapseOnScroll: !collapse })}
        role="switch"
        checked={collapse}
        last
        trailing={
          <Switch
            value={collapse}
            onValueChange={(v) => update({ collapseOnScroll: v })}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Collapse the tab bar on scroll"
          />
        }
      />
    </Group>
  );
}

function PlaybackSection() {
  const st = usePlaybackSettings();
  const [picker, setPicker] = useState<PickerKey>(null);
  const { c } = useTheme();
  const quality: Option<number>[] = QUALITY_OPTIONS.map((q) => ({ value: q.value, label: q.label }));
  const skips: Option<number>[] = SKIP_OPTIONS.map((n) => ({ value: n, label: `${n} s` }));
  const fades: Option<number>[] = FADE_CHOICES.map((n) => ({ value: n, label: fadeLabel(n) }));
  const sheet =
    picker === 'wifi'
      ? { title: 'Streaming quality on Wi-Fi', options: quality, selected: st.wifiBitrate, set: (v: number) => st.update({ wifiBitrate: v }) }
      : picker === 'cellular'
        ? { title: 'Streaming quality on cellular', options: quality, selected: st.cellularBitrate, set: (v: number) => st.update({ cellularBitrate: v }) }
        : picker === 'back'
          ? { title: 'Skip back', options: skips, selected: st.skipBackSeconds, set: (v: number) => st.update({ skipBackSeconds: v }) }
          : picker === 'forward'
            ? { title: 'Skip forward', options: skips, selected: st.skipForwardSeconds, set: (v: number) => st.update({ skipForwardSeconds: v }) }
            : picker === 'fade'
              ? { title: 'Fade between songs', options: fades, selected: st.fadeSeconds, set: (v: number) => st.update({ fadeSeconds: v }) }
              : null;
  const cellular = Platform.OS !== 'web' && !isTV;
  const lite = useLite();
  const [liteOpen, setLiteOpen] = useState(false);
  const liteOptions: Option<LiteChoice>[] = LITE_CHOICES.map((v) => ({ value: v, label: v === 'auto' ? 'Auto: on for devices with little memory' : v === 'on' ? 'On' : 'Off' }));
  // Lite mode matters for small Android devices (TV sticks); it is not offered elsewhere.
  const liteRow = isTV || Platform.OS === 'android';
  return (
    <Group
      title="Playback"
      footer={`Autoplay similar music adds songs like the last ones when the queue ends. Load the whole video ahead uses more data and memory. It helps on a slow or unstable connection. Nothing is kept after the player closes.${liteRow ? ' Lite mode uses less memory: no previews on Home, and a page you leave is closed.' : ''}`}>
      <SettingsRow icon="gauge" label="Quality on Wi-Fi" value={qualityLabel(st.wifiBitrate)} onPress={() => setPicker('wifi')} />
      {cellular ? (
        <SettingsRow icon="antenna.radiowaves.left.and.right" label="Quality on cellular" value={qualityLabel(st.cellularBitrate)} onPress={() => setPicker('cellular')} />
      ) : null}
      <SettingsRow icon="gobackward.10" label="Skip back" value={`${st.skipBackSeconds} s`} onPress={() => setPicker('back')} />
      <SettingsRow icon="goforward.10" label="Skip forward" value={`${st.skipForwardSeconds} s`} onPress={() => setPicker('forward')} />
      <SettingsRow
        icon="forward.fill"
        label="Play next episode automatically"
        onPress={() => st.update({ autoplayNext: !st.autoplayNext })}
        role="switch"
        checked={st.autoplayNext}
        trailing={
          <Switch
            value={st.autoplayNext}
            onValueChange={(v) => st.update({ autoplayNext: v })}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Play next episode automatically"
          />
        }
      />
      <SettingsRow
        icon="music.note.list"
        label="Autoplay similar music"
        onPress={() => audioSession().setAutoplay(!st.autoplaySimilar)}
        role="switch"
        checked={st.autoplaySimilar}
        trailing={
          <Switch
            value={st.autoplaySimilar}
            onValueChange={(v) => audioSession().setAutoplay(v)}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Autoplay similar music"
          />
        }
      />
      <SettingsRow icon="speaker.wave.2.fill" label="Fade between songs" value={fadeLabel(st.fadeSeconds)} onPress={() => setPicker('fade')} />
      {liteRow ? <SettingsRow icon="gauge" label="Lite mode" value={liteLabel(st.liteMode, lite)} onPress={() => setLiteOpen(true)} /> : null}
      {isTV ? (
        <SettingsRow
          icon="play.rectangle"
          label="Autoplay previews on Home"
          onPress={() => st.update({ previews: !st.previews })}
          role="switch"
          checked={st.previews}
          trailing={
            <Switch
              value={st.previews}
              onValueChange={(v) => st.update({ previews: v })}
              trackColor={{ true: c.accent, false: c.surface3 }}
              thumbColor={mediaColors.white}
              {...webSwitchColors}
              accessibilityLabel="Autoplay previews on Home"
            />
          }
        />
      ) : null}
      <SettingsRow
        icon="square.stack.3d.up"
        label="Load the whole video ahead"
        onPress={() => st.update({ loadWholeVideo: !st.loadWholeVideo })}
        role="switch"
        checked={st.loadWholeVideo}
        last
        trailing={
          <Switch
            value={st.loadWholeVideo}
            onValueChange={(v) => st.update({ loadWholeVideo: v })}
            trackColor={{ true: c.accent, false: c.surface3 }}
            thumbColor={mediaColors.white}
            {...webSwitchColors}
            accessibilityLabel="Load the whole video ahead"
          />
        }
      />
      <OptionSheet
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        options={sheet?.options ?? []}
        selected={sheet ? [sheet.selected] : []}
        onSelect={(v) => sheet?.set(v)}
        onClose={() => setPicker(null)}
      />
      <OptionSheet visible={liteOpen} title="Lite mode" options={liteOptions} selected={[st.liteMode]} onSelect={(v) => st.update({ liteMode: v })} onClose={() => setLiteOpen(false)} />
    </Group>
  );
}

function DownloadsSection() {
  const quality = usePlaybackSettings((st) => st.downloadQuality);
  const update = usePlaybackSettings((st) => st.update);
  const [open, setOpen] = useState(false);
  const { appBytes, sections } = useDownloadLists();
  const count = sections.reduce((n, sec) => n + sec.count, 0);
  const label = DOWNLOAD_QUALITY_OPTIONS.find((o) => o.value === quality)?.label ?? 'Original';
  return (
    <Group title="Downloads" footer="Original keeps the file as it is on the server when this device can play it. Other choices ask the server for a smaller copy of videos. Music downloads keep the original file.">
      <SettingsRow icon="arrow.down.circle" label="Download quality" value={label} onPress={() => setOpen(true)} />
      <SettingsRow
        icon="internaldrive"
        label="On this device"
        value={`${count} ${count === 1 ? 'item' : 'items'} · ${formatBytes(appBytes)}`}
        onPress={() => openTabRoot('downloads')}
        last
      />
      <OptionSheet
        visible={open}
        title="Download quality"
        options={DOWNLOAD_QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        selected={[quality]}
        onSelect={(v) => update({ downloadQuality: v })}
        onClose={() => setOpen(false)}
      />
    </Group>
  );
}

/** Extensions: the list, and a quick way to send a link to one. */
function ExtensionsSection() {
  const count = useExtensions((st) => st.list.length);
  const takesLinks = useExtensions((st) => st.list.some((e) => e.enabled && (e.manifest.contributes.shareTargets?.length ?? 0) > 0));
  return (
    <Group title="Extensions" footer="Extensions add buttons, Home rows and pages from your own servers, for example a downloader.">
      <SettingsRow
        icon="square.grid.2x2"
        label="Extensions"
        value={count ? String(count) : undefined}
        onPress={() => router.push('/(tabs)/(home)/extensions')}
        last={!takesLinks}
      />
      {takesLinks ? <SettingsRow icon="globe" label="Send link to…" onPress={() => router.push('/share')} last /> : null}
    </Group>
  );
}

/** Live TV: the IPTV providers of this account. */
function LiveTvSection() {
  const providers = useProviders();
  return (
    <Group title="Live TV" footer="Watch live channels from your own IPTV provider: an Xtream login or an M3U playlist.">
      <SettingsRow
        icon="tv"
        label="IPTV providers"
        value={providers.length ? String(providers.length) : undefined}
        onPress={() => router.push(providersHref('(home)'))}
        last
      />
    </Group>
  );
}

/** Development builds only: test offline mode on a simulator. */
function DevSection() {
  const [on, setOn] = useState(devOffline());
  const { c } = useTheme();
  const toggle = (v: boolean) => {
    setDevOffline(v);
    setOn(v);
    void checkServer();
  };
  return (
    <Group title="Development" footer="Every request to the server fails, as with no connection. Only in development builds.">
      <SettingsRow
        icon="wifi.exclamationmark"
        label="Simulate no server"
        onPress={() => toggle(!on)}
        role="switch"
        checked={on}
        last
        trailing={<Switch value={on} onValueChange={toggle} trackColor={{ true: c.accent, false: c.surface3 }} thumbColor={mediaColors.white} {...webSwitchColors} accessibilityLabel="Simulate no server" />}
      />
    </Group>
  );
}
