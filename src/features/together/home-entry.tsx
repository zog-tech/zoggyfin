/**
 * The Together entries on Home: a labelled header button that opens the
 * hub (join, start, code), and a small "Nearby" card that lists live
 * sessions. Home looks for nearby sessions only while it shows and the app
 * is in the foreground, over the network only (no Bluetooth scan), to save
 * battery.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { features } from '@/platform/tv';
import { createStyles, type AppTheme, font, radius, spacing, type, useLayout, useStyles, useTheme } from '@/theme';
import { nearby, nearbySupported } from '@/together/nearby';
import { openTogetherSheet, pastLobby, togetherState, useTogetherStore } from '@/together/store';
import { syncPlaySupported } from '@/together/syncplay';

import { TogetherSheetHost } from './together-sheet';

/** Home offers Together where a session can run (not on TV). */
export const homeTogether = features.watchTogether && (nearbySupported || syncPlaySupported);

/** The Home header button: an icon and the word "Together". */
export function TogetherHeaderButton() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const live = useTogetherStore(pastLobby);
  return (
    <Touchable
      onPress={() => openTogetherSheet('hub', null)}
      radius={16}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Together"
      accessibilityHint="Join or start a session"
      style={s.headerButton}>
      <Icon name={live ? 'person.2.fill' : 'person.2'} size={16} color={c.accent} weight="semibold" />
      <Text style={s.headerLabel}>Together</Text>
    </Touchable>
  );
}

/** True while Home shows and the app is in the foreground. */
function useHomeVisible(): boolean {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setActive(st === 'active'));
    return () => sub.remove();
  }, []);
  return focused && active;
}

/** Browses for nearby sessions while Home is visible and nothing else runs. */
function useHomeBrowse(visible: boolean): void {
  const sheetOpen = useTogetherStore((x) => x.sheet.open);
  // In a session or a join: Home leaves the nearby link alone.
  const busy = useTogetherStore(pastLobby);
  useEffect(() => {
    if (!nearbySupported || !visible || sheetOpen || busy) return;
    const st = togetherState();
    if (!(st.mode === 'nearby' && st.phase.name === 'browsing')) nearby().browse({ ble: false });
    return () => nearby().stopBrowsing();
  }, [visible, sheetOpen, busy]);
}

const NO_HOSTS: never[] = [];

/** The live nearby sessions on Home, each with Join. Shows nothing when there are none. */
export function NearbyHomeCard() {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const visible = useHomeVisible();
  useHomeBrowse(visible);
  const all = useTogetherStore((x) => x.hosts);
  const looking = useTogetherStore((x) => x.mode === 'nearby' && x.phase.name === 'browsing');
  const hosts = looking ? all : NO_HOSTS;
  if (!nearbySupported || !hosts.length) return null;
  return (
    <View style={[s.card, { marginHorizontal: l.gutter }]} accessibilityRole="summary">
      <Text style={s.cardTitle}>Nearby</Text>
      {hosts.slice(0, 3).map((h) => (
        <View key={h.peerId} style={s.cardRow}>
          <Icon name={h.advert.kind === 'audio' ? 'music.note' : 'person.2.fill'} size={16} color={s.cardIcon.color} />
          <Text style={s.cardText} numberOfLines={2}>
            {h.advert.itemId === 'room' && !h.advert.itemName
              ? `${h.advert.hostName} · picking something to play`
              : `${h.advert.hostName} is ${h.advert.kind === 'audio' ? 'listening to' : 'watching'} ${h.advert.itemName || (h.advert.kind === 'audio' ? 'music' : 'a video')} nearby`}
          </Text>
          <Button
            title="Join"
            variant="small"
            onPress={() => {
              nearby().join(h.peerId);
              openTogetherSheet('hub', null);
            }}
          />
        </View>
      ))}
      {hosts.length > 3 ? <Text style={s.cardMore}>{`+${hosts.length - 3} more in Together`}</Text> : null}
    </View>
  );
}

/** Mount once on Home: the hub sheet. */
export function HomeTogetherSheet() {
  return <TogetherSheetHost where="hub" />;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  headerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: c.accentSoft,
  },
  headerLabel: { ...font(type.subheadline), fontWeight: '600' as const, color: c.accent },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
    borderCurve: 'continuous' as const,
  },
  cardTitle: { ...font(type.footnote), color: c.text2, letterSpacing: 0.4 },
  cardRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  cardIcon: { color: c.accent },
  cardText: { ...font(type.subheadline), color: c.text, flex: 1, minWidth: 0 },
  cardMore: { ...font(type.footnote), color: c.text2 },
}));
