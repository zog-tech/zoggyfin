/**
 * The profile menu behind the avatar button in the Home header. It gives
 * direct access to the key features: the account and server (tap to switch),
 * Invite someone and the Admin panel (admins), Together, Downloads,
 * Extensions, Settings and Sign out. Each row opens an existing screen.
 *
 * Phones, tablets and TV: a bottom sheet. Web and the Mac app: a popover
 * under the button, with keyboard navigation (Tab, arrow keys, Home, End,
 * Enter or Space on a row, Escape). See `menu-model.ts` for the rows and their states.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ComponentRef, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scopeKey } from '@/api/query-keys';
import { useApi } from '@/api/use-api';
import { startUrl } from '@/auth/accounts';
import { useAccounts } from '@/auth/session-store';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { downloadsSupported } from '@/downloads';
import { useDownloadsStore } from '@/downloads/store';
import { openAdmin } from '@/features/admin/nav';
import { openInvite } from '@/features/admin/invite';
import { inviteAdminKey } from '@/features/invite/invite-section';
import { openAddServer, signOutUser, switchAccount } from '@/features/servers/actions';
import { openRemote, remoteSupported } from '@/features/remote/use-remote';
import { homeTogether } from '@/features/together/home-entry';
import { getUsers, isAdministrator } from '@/invite/api';
import { pendingInvites, readRecords } from '@/invite/records';
import { useConnection } from '@/servers/connection';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { openTogetherSheet, useTogetherStore } from '@/together/store';

import { connectionPlace, type MenuRow, type MenuRowId, menuRows, roomPeople } from './menu-model';

/** Web and the Mac app show a popover; the other platforms a sheet. */
const POPOVER = Platform.OS === 'web';

function useMenuState() {
  const { api, scope, session } = useApi();
  const admin = useQuery({ queryKey: inviteAdminKey(scope), queryFn: () => isAdministrator(api), staleTime: 60 * 1000 });
  const isAdmin = admin.data ?? null;
  const pending = useQuery({
    queryKey: [...scopeKey(scope), 'invite', 'pending'],
    queryFn: async () => pendingInvites(readRecords(), session.serverId, await getUsers(api), Date.now()),
    enabled: isAdmin === true,
    staleTime: 60 * 1000,
  });
  const people = useTogetherStore(roomPeople);
  const downloads = useDownloadsStore((st) => st.records);
  const { count, active } = useMemo(() => {
    const all = Object.values(downloads);
    return {
      count: all.filter((r) => r.state === 'completed').length,
      active: all.filter((r) => r.state === 'downloading' || r.state === 'queued').map((r) => ({ done: r.bytesDone, total: r.bytesTotal })),
    };
  }, [downloads]);
  const rows = menuRows({
    admin: isAdmin,
    pendingInvites: pending.data?.length ?? null,
    together: homeTogether,
    roomPeople: people,
    remote: remoteSupported,
    downloads: downloadsSupported,
    downloadCount: count,
    active,
  });
  return { rows, session, roomOpen: people !== null };
}

export function ProfileMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return <ProfileMenuOpen onClose={onClose} />;
}

function ProfileMenuOpen({ onClose }: { onClose: () => void }) {
  const { rows, session, roomOpen } = useMenuState();
  const [accounts, setAccounts] = useState(false);
  const close = (then?: () => void) => {
    onClose();
    // Let the menu leave before the next screen comes in.
    if (then) setTimeout(then, 180);
  };
  const run = (id: MenuRowId) => {
    switch (id) {
      case 'invite':
        return close(() => openInvite({ serverId: session.serverId }));
      case 'together':
        return close(() => openTogetherSheet(roomOpen ? 'room' : 'hub', null));
      case 'remote':
        return close(() => openRemote());
      case 'downloads':
        return close(() => router.navigate('/(tabs)/(saved)/downloads'));
      case 'admin':
        return close(() => openAdmin(session.serverId));
      case 'extensions':
        return close(() => router.push('/(tabs)/(home)/extensions'));
      case 'settings':
        return close(() => router.push('/(tabs)/(home)/settings'));
      case 'signout':
        return close(() => void signOutUser({ serverId: session.serverId, userId: session.userId }));
    }
  };
  const body = (
    <>
      <AccountHeader open={accounts} onToggle={() => setAccounts((v) => !v)} />
      {accounts ? <AccountList close={close} /> : null}
      <MenuRows rows={rows} onPress={run} />
    </>
  );
  if (POPOVER) return <Popover onClose={() => close()}>{body}</Popover>;
  return (
    <Sheet visible title={null} onClose={() => close()} doneLabel="Done">
      <TvScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        {body}
      </TvScrollView>
    </Sheet>
  );
}

/** The avatar, the user name, the server and how the app reaches it. A tap shows the saved accounts. */
function AccountHeader({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { session } = useApi();
  const place = connectionPlace(useConnection(session.serverId));
  const dot = place.tone === 'ok' ? c.success : place.tone === 'warning' ? c.warning : c.text3;
  return (
    <Touchable
      kind="row"
      onPress={onToggle}
      radius={radius.lg}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${session.userName} on ${session.serverName}, ${place.text}`}
      accessibilityHint="Switch the account or the server"
      style={({ pressed, hovered, focused }) => [s.header, (pressed || hovered || (focused && !isTV)) && s.active]}>
      <Avatar session={session} size={sizes.avatarLarge} />
      <View style={s.flex}>
        <Text style={s.name} numberOfLines={1}>
          {session.userName}
        </Text>
        <View style={s.placeRow}>
          <Text style={s.muted} numberOfLines={1}>
            {session.serverName}
          </Text>
          <View style={[s.dot, { backgroundColor: dot }]} />
          <Text style={s.muted} numberOfLines={1}>
            {place.text}
          </Text>
        </View>
      </View>
      <Icon name={open ? 'chevron.up' : 'chevron.down'} size={scaled(iconSize.sm)} color={c.text2} weight="semibold" />
    </Touchable>
  );
}

/** Every saved account, the active one with a check mark, and "Add server or account". */
function AccountList({ close }: { close: (then?: () => void) => void }) {
  const sheet = useStyles(makeSheetStyles);
  const { c } = useTheme();
  const { servers } = useAccounts();
  const { session } = useApi();
  return (
    <View style={sheet.group}>
      {servers.flatMap((sv) =>
        sv.users.map((u) => {
          const active = session.serverId === sv.id && session.userId === u.userId;
          const url = active ? session.serverUrl : (startUrl(sv) ?? '');
          return (
            <SheetRow
              key={`${sv.id}:${u.userId}`}
              onPress={() => (active ? close() : close(() => switchAccount({ serverId: sv.id, userId: u.userId })))}
              accessibilityRole="radio"
              checked={active}
              accessibilityLabel={`${u.userName} on ${sv.name}`}>
              <Avatar session={{ serverId: sv.id, serverUrl: url, userId: u.userId, userName: u.userName, userImageTag: u.userImageTag, token: null }} size={scaled(30)} />
              <Text style={sheet.rowText} numberOfLines={1}>
                {`${u.userName} · ${sv.name}`}
              </Text>
              {active ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
            </SheetRow>
          );
        }),
      )}
      <SheetRow onPress={() => close(openAddServer)} last accessibilityLabel="Add server or account">
        <Icon name="plus" size={scaled(iconSize.sm)} color={c.accent} />
        <Text style={[sheet.rowText, { color: c.accent }]}>Add server or account</Text>
      </SheetRow>
    </View>
  );
}

function MenuRows({ rows, onPress }: { rows: MenuRow[]; onPress: (id: MenuRowId) => void }) {
  const sheet = useStyles(makeSheetStyles);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={sheet.group}>
      {rows.map((r, i) => (
        <SheetRow key={r.id} onPress={() => onPress(r.id)} last={i === rows.length - 1} accessibilityLabel={r.detail ? `${r.label}, ${r.detail}` : r.label}>
          <Icon name={r.icon as IconName} size={scaled(iconSize.sm)} color={r.destructive ? c.danger : c.accent} />
          <Text style={[sheet.rowText, r.destructive && { color: c.danger }]} numberOfLines={1}>
            {r.label}
          </Text>
          {r.detail ? (
            <Text style={s.detail} numberOfLines={1}>
              {r.detail}
            </Text>
          ) : null}
        </SheetRow>
      ))}
    </View>
  );
}

/** Web and Mac: a panel under the avatar button. Arrow keys move between the rows; Escape closes. */
function Popover({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const panel = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = panel.current as unknown as HTMLElement | null;
    const items = () => (root ? Array.from(root.querySelectorAll<HTMLElement>('[role="button"],[role="radio"]')) : []);
    // The first row gets the focus, so the keyboard works at once.
    const t = setTimeout(() => items()[0]?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      let next: number | null = null;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
      else if (e.key === 'ArrowUp') next = at <= 0 ? list.length - 1 : at - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      if (next !== null && list[next]) {
        e.preventDefault();
        list[next]!.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close the menu" accessibilityRole="button" />
      <View ref={panel} style={[s.popover, { top: insets.top + 64 }]} accessibilityRole="menu" aria-label="Profile menu">
        <TvScrollView contentContainerStyle={s.popoverContent}>{children}</TvScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
  },
  active: { backgroundColor: c.surface2 },
  flex: { flex: 1, minWidth: 0 },
  name: { ...font(type.headline), color: c.text },
  placeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  muted: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, marginLeft: spacing.xs },
  detail: { ...font(type.subheadline), color: c.text2, maxWidth: '50%' as const },
  scrim: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  popover: {
    position: 'absolute' as const,
    right: spacing.lg,
    width: 360,
    maxWidth: '92%' as const,
    maxHeight: '80%' as const,
    borderRadius: radius.lg + 4,
    backgroundColor: c.bgGrouped,
    ...shadow('floating'),
  },
  popoverContent: { gap: spacing.md, padding: spacing.md },
}));
