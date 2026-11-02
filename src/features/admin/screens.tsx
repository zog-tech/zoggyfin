/**
 * The Admin screens that the routes render. Phones: the Admin home shows the
 * dashboard and a list of sections; each section opens as its own screen.
 * Wide windows: a section list on the left and the section on the right.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { Group, LeadingIcon, makeSettingsStyles, SettingsRow } from '@/features/settings/rows';
import { createStyles, type AppTheme, font, iconSize, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

import type { AdminTarget } from './access';
import { ActivitySection } from './activity';
import { DashboardSection } from './dashboard';
import { DevicesSection } from './devices';
import { LibrariesSection } from './libraries';
import { LogsSection, LogsSplit, LogViewer } from './logs';
import { ADMIN_SECTIONS, type AdminSection, openAdminSection, sectionLabel } from './nav';
import { ServerActionsGroup, WebDashboardGroup } from './server-actions';
import { SessionsSection } from './sessions';
import { TasksSection } from './tasks';
import { AdminGate, AdminPage, useAdminWide } from './ui';
import { UserEditor, UsersSection } from './users';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

function SectionBody({ section, target, split }: { section: AdminSection; target: AdminTarget; split?: boolean }) {
  switch (section) {
    case 'dashboard':
      return <DashboardSection target={target} />;
    case 'sessions':
      return <SessionsSection target={target} />;
    case 'users':
      return <UsersSection target={target} split={split} />;
    case 'libraries':
      return <LibrariesSection target={target} />;
    case 'tasks':
      return <TasksSection target={target} />;
    case 'activity':
      return <ActivitySection target={target} />;
    case 'devices':
      return <DevicesSection target={target} />;
    case 'logs':
      return <LogsSection target={target} />;
  }
}

function useRefreshAll(target: AdminTarget) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: target.key });
}

/** Settings → Admin of one server. */
export function AdminHomeScreen({ serverId }: { serverId: string | undefined }) {
  return <AdminGate serverId={serverId} title="Admin">{(t) => <AdminHome target={t} />}</AdminGate>;
}

function AdminHome({ target }: { target: AdminTarget }) {
  const wide = useAdminWide();
  const refresh = useRefreshAll(target);
  if (wide) return <AdminHomeWide target={target} />;
  return (
    <AdminPage onRefresh={refresh}>
      <DashboardSection target={target} />
      <Group title="Manage">
        {ADMIN_SECTIONS.filter((x) => x.key !== 'dashboard').map((x, i, arr) => (
          <SettingsRow key={x.key} icon={x.icon} label={x.label} onPress={() => openAdminSection(target.serverId, x.key)} last={i === arr.length - 1} />
        ))}
      </Group>
      <WebDashboardGroup target={target} />
      <ServerActionsGroup target={target} />
    </AdminPage>
  );
}

function AdminHomeWide({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const rs = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const [section, setSection] = useState<AdminSection>('dashboard');
  const bottomPad = useTabBottomPadding(spacing.huge, { autoInset: false });
  const refresh = useRefreshAll(target);
  return (
    <View style={[s.split, sidebar ? { paddingLeft: sidebar } : null]}>
      <TvScrollView style={s.nav} contentContainerStyle={[s.navContent, { paddingBottom: bottomPad }]}>
        <Text style={s.server} numberOfLines={2}>
          {target.serverName}
        </Text>
        <View style={rs.card} accessibilityRole="tablist">
          {ADMIN_SECTIONS.map((x, i) => {
            const on = x.key === section;
            return (
              <Touchable
                key={x.key}
                kind="row"
                onPress={() => setSection(x.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={x.label}
                style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || (focused && !isTV)) && rs.rowPressed, on && { backgroundColor: c.accentSoft }]}>
                <LeadingIcon name={x.icon} />
                <View style={[rs.row, rs.rowBody, i < ADMIN_SECTIONS.length - 1 && rs.rowBorder]}>
                  <Text style={[rs.label, on && { color: c.accent, fontWeight: '600' }]}>{x.label}</Text>
                  {on ? <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.accent} weight="semibold" /> : null}
                </View>
              </Touchable>
            );
          })}
        </View>
        <WebDashboardGroup target={target} />
        <ServerActionsGroup target={target} />
      </TvScrollView>
      <View style={s.pane}>
        <AdminPage onRefresh={refresh} wide inset={false}>
          <Text style={s.paneTitle} accessibilityRole="header">
            {sectionLabel(section)}
          </Text>
          <SectionBody key={section} section={section} target={target} />
        </AdminPage>
      </View>
    </View>
  );
}

/** One section on its own screen (phones, and links from the dashboard). */
export function AdminSectionScreen({ serverId, section }: { serverId: string | undefined; section: AdminSection }) {
  return <AdminGate serverId={serverId} title={sectionLabel(section)}>{(t) => <SectionScreen target={t} section={section} />}</AdminGate>;
}

function SectionScreen({ target, section }: { target: AdminTarget; section: AdminSection }) {
  const wide = useAdminWide();
  const refresh = useRefreshAll(target);
  if (section === 'logs' && wide) return <LogsSplit target={target} />;
  return (
    <AdminPage onRefresh={refresh} wide>
      <SectionBody section={section} target={target} split />
    </AdminPage>
  );
}

export function AdminUserScreen({ serverId, userId }: { serverId: string | undefined; userId: string }) {
  return <AdminGate serverId={serverId} title="User">{(t) => <UserEditor target={t} userId={userId} />}</AdminGate>;
}

export function AdminLogScreen({ serverId, name }: { serverId: string | undefined; name: string }) {
  return <AdminGate serverId={serverId} title={name}>{(t) => <LogViewer target={t} name={name} />}</AdminGate>;
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  split: { flex: 1, flexDirection: 'row' as const, backgroundColor: c.bgGrouped },
  nav: { width: 320, flexGrow: 0, borderRightWidth: sizes.hairline, borderRightColor: c.separator },
  navContent: { padding: spacing.lg, gap: spacing.xxl, paddingBottom: spacing.huge },
  server: { ...font(type.title3), color: c.text, marginHorizontal: spacing.xs },
  pane: { flex: 1 },
  paneTitle: { ...font(type.title2), color: c.text, marginHorizontal: spacing.xs },
}));
