import { NativeTabs } from 'expo-router/native-tabs';
import type { SFSymbol } from 'expo-symbols';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDownloadsBadge } from '@/downloads/use-badge';
import { pageTabIcon } from '@/features/extensions/icons';
import { hiddenTriggers } from '@/features/extensions/placement';
import { usePagePlacement } from '@/features/extensions/use-placement';
import { liveTvTab } from '@/features/iptv/nav';
import { GlobalPlayerKeys } from '@/features/player/global-keys';
import { MiniPlayer, useMiniPlayerVisible } from '@/features/player/mini-player';
import { RoomLayer } from '@/features/together/room-bar';
import { TvTabsLayout } from '@/features/tv/side-menu';
import { HAS_ACCESSORY, TAB_BAR_HEIGHT } from '@/lib/tab-bar-inset';
import { features, isTV } from '@/platform/tv';
import { fontFamily, spacing, useLayout, useTheme } from '@/theme';


/** The accessory renders twice (regular and inline); each copy picks its layout. */
function Accessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <MiniPlayer inline={placement === 'inline'} />;
}

/**
 * Android: the tab screens keep the automatic bottom inset, so content ends
 * above the opaque Material bar. iOS scroll views inset themselves, and web
 * screens pad with useTabBottomPadding().
 */
const NO_AUTO_INSETS = Platform.OS !== 'android' || isTV;

function FloatingMiniPlayer() {
  const insets = useSafeAreaInsets();
  const l = useLayout();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.floating, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.sm, left: l.gutter, right: l.gutter }]}>
      <MiniPlayer floating />
    </View>
  );
}

/**
 * The five native tabs. On iPad and Mac the bar can turn into a sidebar
 * (sidebarAdaptable). Each tab has its own stack.
 */
/** TV: the side menu instead of the tab bar; the mini player floats at the bottom of the content. */
function TvLayout() {
  const mini = useMiniPlayerVisible();
  const l = useLayout();
  return (
    <View style={styles.flex}>
      <TvTabsLayout />
      {mini ? (
        <View pointerEvents="box-none" style={[styles.floating, { bottom: spacing.lg, right: l.gutter, width: l.contentWidth * 0.45 }]}>
          <MiniPlayer floating />
        </View>
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  if (isTV) return <TvLayout />;
  return <PhoneTabsLayout />;
}

function PhoneTabsLayout() {
  const mini = useMiniPlayerVisible();
  const { c, scheme } = useTheme();
  const badge = useDownloadsBadge();
  // The extension tab slot (features/extensions/placement.ts): on phones only in place of the tab the user chose
  // ("On this phone"), so the bar keeps five; hidden when no page fills it. A change of `hidden` remounts the tab
  // navigator, so it changes only on install, removal, the on/off switch, the phone choice or an account switch.
  // Playback and the mini player live outside the navigator's state and survive it.
  const ext = usePagePlacement();
  const extIcon = pageTabIcon(ext.tab?.icon);
  const hidden = hiddenTriggers(ext, { downloads: features.downloads, liveTab: liveTvTab });
  const tabs = (
    <NativeTabs
      tintColor={c.accent}
      sidebarAdaptable
      minimizeBehavior="onScrollDown"
      {...(Platform.OS === 'web'
        ? {
            indicatorColor: c.accentSoft,
            labelStyle: { color: c.text2, fontWeight: '600' as const, fontSize: 13, fontFamily: fontFamily.web },
          }
        : null)}
      {...(Platform.OS === 'android'
        ? {
            // Material 3 defaults to its own purple palette: use the app's graphite and Ember.
            backgroundColor: scheme === 'light' ? c.bgGrouped : c.surface,
            indicatorColor: c.accentSoft,
            rippleColor: c.accentSoft,
            iconColor: { default: c.text2, selected: c.accent },
            labelStyle: { default: { color: c.text2, fontSize: 12 }, selected: { color: c.accent, fontSize: 12 } },
            badgeBackgroundColor: c.accent,
            badgeTextColor: c.onAccent,
            labelVisibilityMode: 'labeled' as const,
          }
        : null)}>
      {HAS_ACCESSORY && mini ? (
        <NativeTabs.BottomAccessory>
          <Accessory />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(home)" disableAutomaticContentInsets={NO_AUTO_INSETS}>
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)" disableAutomaticContentInsets={NO_AUTO_INSETS} hidden={hidden['(library)']}>
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} md="stacks" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(music)" disableAutomaticContentInsets={NO_AUTO_INSETS} hidden={hidden['(music)']}>
        <NativeTabs.Trigger.Label>Music</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="music.note" md="music_note" />
      </NativeTabs.Trigger>
      {/* One fixed slot for an extension page; its label and icon come from the page. */}
      <NativeTabs.Trigger name="(ext)" disableAutomaticContentInsets={NO_AUTO_INSETS} hidden={hidden['(ext)']}>
        <NativeTabs.Trigger.Label>{ext.tab?.title ?? 'Extension'}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={extIcon.sf as SFSymbol} md={extIcon.md} />
      </NativeTabs.Trigger>
      {/* Live TV is a tab only where a sixth tab fits (web, the Mac app): see features/iptv/nav.ts. */}
      <NativeTabs.Trigger name="(live)" disableAutomaticContentInsets={NO_AUTO_INSETS} hidden={hidden['(live)']}>
        <NativeTabs.Trigger.Label>Live TV</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tv" md="live_tv" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(saved)" disableAutomaticContentInsets={NO_AUTO_INSETS} hidden={hidden['(saved)']}>
        <NativeTabs.Trigger.Label>Downloads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} md="download" />
        <NativeTabs.Trigger.Badge hidden={!badge}>{badge ?? undefined}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" disableAutomaticContentInsets={NO_AUTO_INSETS} role="search" hidden={hidden['(search)']}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
  return (
    <View style={styles.flex}>
      {tabs}
      {mini && !HAS_ACCESSORY ? <FloatingMiniPlayer /> : null}
      {features.watchTogether ? <RoomLayer /> : null}
      <GlobalPlayerKeys />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floating: { position: 'absolute' },
});
