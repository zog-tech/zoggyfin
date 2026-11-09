/**
 * Users: the list (last activity, last sign-in, admin and disabled marks)
 * and the editor of one user: library access, features, limits, enable or
 * disable, password and delete. Creating users belongs to the invite flow.
 */
import type { UserDto, UserPolicy } from '@jellyfin/sdk/lib/generated-client/models';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { isTV } from '@/platform/tv';
import { ActionRow, Group, LeadingIcon, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, mediaColors, scaled, spacing, type, useLayout, useStyles, useTheme } from '@/theme';

import type { AdminTarget } from './access';
import { openInvite } from './invite';
import {
  BITRATE_LIMITS,
  bitrateLimitLabel,
  buildPolicyUpdate,
  describeChanges,
  draftFrom,
  formatSince,
  hasLibrary,
  parentalRatingOptions,
  type PolicyEdits,
  policyDiff,
  SYNCPLAY_OPTIONS,
  syncPlayLabel,
  toggleLibrary,
} from './logic';
import { openAdminUser } from './nav';
import { adminKeys, useAdminAction, useLibraries, useParentalRatings, useUsers } from './queries';
import { AdminPage, Badge, Columns, ConfirmSheet, TextSheet, useAdminWide } from './ui';
import { useTabBarOverlap } from '@/lib/tab-bar-inset';

/** The web tab bar floats over the bottom of the page; native tab bars are in the safe area inset. */

function sortUsers(list: readonly UserDto[]): UserDto[] {
  return [...list].sort((a, b) => Number(!!b.Policy?.IsAdministrator) - Number(!!a.Policy?.IsAdministrator) || (a.Name ?? '').localeCompare(b.Name ?? ''));
}

/** The Users screen. With `split` on a wide window, the selected user opens beside the list. */
export function UsersSection({ target, split = false }: { target: AdminTarget; split?: boolean }) {
  const q = useUsers(target);
  const wide = useAdminWide();
  const [selected, setSelected] = useState<string | null>(null);
  const s = useStyles(makeStyles);
  const sideBySide = split && wide;

  if (q.isPending) return <LoadingState rows={5} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const users = sortUsers(q.data);
  const current = sideBySide ? (users.find((u) => u.Id === selected) ?? users[0]) : null;

  const list = (
    <View style={s.stack}>
      <Button
        title="Invite someone"
        icon="person.badge.plus"
        variant="tonalAccent"
        onPress={() => openInvite({ serverId: target.serverId })}
      />
      <Group title={`Users · ${users.length}`} footer="Invite someone makes a new user and gives you one link to send.">
        {users.length === 0 ? <Text style={s.empty}>No users.</Text> : null}
        {users.map((u, i) => (
          <UserRow
            key={u.Id}
            user={u}
            target={target}
            selected={current?.Id === u.Id}
            last={i === users.length - 1}
            onPress={() => (sideBySide ? setSelected(u.Id ?? null) : openAdminUser(target.serverId, u.Id ?? ''))}
          />
        ))}
      </Group>
    </View>
  );
  if (!sideBySide) return list;
  return <Columns left={list} right={current?.Id ? <UserEditor key={current.Id} target={target} userId={current.Id} embedded /> : <EmptyState icon="person.2" title="No user" />} />;
}

function UserRow({ user: u, target, selected, last, onPress }: { user: UserDto; target: AdminTarget; selected: boolean; last: boolean; onPress: () => void }) {
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const now = new Date();
  const active = formatSince(u.LastActivityDate, now);
  const login = formatSince(u.LastLoginDate, now);
  const p = u.Policy;
  const marks = [p?.IsAdministrator ? 'administrator' : null, p?.IsDisabled ? 'disabled' : null].filter(Boolean).join(', ');
  return (
    <Touchable
      kind="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${u.Name}${marks ? `, ${marks}` : ''}. Last active ${active ?? 'never'}. Last sign-in ${login ?? 'never'}`}
      style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || (focused && !isTV)) && rs.rowPressed, selected && { backgroundColor: c.accentSoft }]}>
      <View style={p?.IsDisabled ? s.dim : null}>
        <Avatar session={{ serverId: target.serverId, serverUrl: target.serverUrl, userId: u.Id ?? '', userName: u.Name ?? '?', userImageTag: target.fixture ? null : (u.PrimaryImageTag ?? null), token: null }} size={scaled(36)} />
      </View>
      <View style={[rs.row, rs.rowBody, !last && rs.rowBorder]}>
        <View style={s.userText}>
          <View style={s.nameRow}>
            <Text style={[s.name, p?.IsDisabled && s.nameOff]} numberOfLines={1}>
              {u.Name}
            </Text>
            {u.Id === target.userId ? <Text style={s.you}>You</Text> : null}
          </View>
          <Text style={s.meta} numberOfLines={2}>
            {`Active ${active ?? 'never'} · Signed in ${login ?? 'never'}`}
          </Text>
          {p?.IsAdministrator || p?.IsDisabled ? (
            <View style={s.badges}>
              {p?.IsAdministrator ? <Badge label="Admin" tone="accent" icon="checkmark.shield" /> : null}
              {p?.IsDisabled ? <Badge label="Disabled" tone="danger" icon="nosign" /> : null}
            </View>
          ) : null}
        </View>
        <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
      </View>
    </Touchable>
  );
}

type Picker = 'bitrate' | 'rating' | 'syncplay' | null;

/** One user: what they can open and do. Policy changes collect in a draft until "Save changes". */
export function UserEditor({ target, userId, embedded = false }: { target: AdminTarget; userId: string; embedded?: boolean }) {
  const s = useStyles(makeStyles);
  const users = useUsers(target);
  const libs = useLibraries(target);
  const ratings = useParentalRatings(target);
  const { busy, run } = useAdminAction();
  const user = users.data?.find((u) => u.Id === userId);
  const saved = user?.Policy;
  const [draft, setDraft] = useState<PolicyEdits | null>(saved ? draftFrom(saved) : null);
  // A new saved policy (after a save or a refresh) starts a new draft.
  const [base, setBase] = useState(saved);
  if (base !== saved) {
    setBase(saved);
    setDraft(saved ? draftFrom(saved) : null);
  }
  const [picker, setPicker] = useState<Picker>(null);
  const [sheet, setSheet] = useState<'password' | 'delete' | null>(null);
  const barOverlap = useTabBarOverlap({ autoInset: false });
  const wide = useAdminWide();
  const layout = useLayout();

  const changes = saved && draft ? policyDiff(saved, draft) : [];
  const ratingOptions = useMemo(() => parentalRatingOptions(ratings.data ?? []), [ratings.data]);

  if (users.isPending) return <LoadingState rows={6} />;
  if (users.isError && !users.data) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
  if (!user || !saved || !draft) {
    return <EmptyState icon="person" title="This user does not exist any more" message="Someone deleted the user, or the list changed." />;
  }

  const name = user.Name ?? 'this user';
  const self = user.Id === target.userId;
  const allIds = (libs.data ?? []).map((l) => l.ItemId).filter((x): x is string => !!x);
  const set = (patch: PolicyEdits) => setDraft((d) => ({ ...(d ?? {}), ...patch }));
  const invalidate = [adminKeys.users(target)];

  const sendPolicy = (next: UserPolicy, success: string) => run('policy', () => target.api.updatePolicy(userId, next), { success, invalidate });

  const save = async () => {
    const next = buildPolicyUpdate(saved, draft);
    if (!next) return;
    await sendPolicy(next, `Saved ${describeChanges(changes)} for ${name}`);
  };

  const setDisabled = async (off: boolean) => {
    if (off && !(await confirmDestructive(`Disable ${name}?`, `${name} cannot sign in or play anything until you enable the account again. Open sessions end.`, 'Disable'))) return;
    const next = buildPolicyUpdate(saved, { IsDisabled: off });
    if (next) await sendPolicy(next, off ? `${name} is disabled` : `${name} is enabled`);
  };

  const removePassword = async () => {
    if (!(await confirmDestructive(`Remove the password of ${name}?`, `${name} can then sign in with no password. Do this only on a server that is not open to the internet.`, 'Remove password'))) return;
    await run('password', () => target.api.removePassword(userId), { success: `${name} has no password now`, icon: 'key', invalidate });
  };

  const header = (
    <View style={s.headerCard}>
      <Avatar session={{ serverId: target.serverId, serverUrl: target.serverUrl, userId, userName: name, userImageTag: target.fixture ? null : (user.PrimaryImageTag ?? null), token: null }} size={scaled(52)} />
      <View style={s.flex}>
        <Text style={s.title} numberOfLines={2}>
          {name}
        </Text>
        <Text style={s.meta}>{`Active ${formatSince(user.LastActivityDate, new Date()) ?? 'never'} · Signed in ${formatSince(user.LastLoginDate, new Date()) ?? 'never'}`}</Text>
        <View style={s.badges}>
          {saved.IsAdministrator ? <Badge label="Admin" tone="accent" icon="checkmark.shield" /> : null}
          {saved.IsDisabled ? <Badge label="Disabled" tone="danger" icon="nosign" /> : <Badge label="Enabled" tone="success" />}
          {user.HasPassword === false ? <Badge label="No password" tone="warning" icon="key" /> : null}
        </View>
      </View>
    </View>
  );

  const libraries = (
    <Group title="Library access" footer={saved.IsAdministrator ? 'Administrators manage the server. Library access still decides what they see in apps.' : 'The user sees only the libraries that are on.'}>
      <SwitchRow icon="square.stack" label="All libraries" value={!!draft.EnableAllFolders} onChange={(v) => set(v ? { EnableAllFolders: true, EnabledFolders: [] } : { EnableAllFolders: false, EnabledFolders: [...allIds] })} last={allIds.length === 0} />
      {libs.isError ? <Text style={s.empty}>Could not load the libraries.</Text> : null}
      {(libs.data ?? []).map((l, i, arr) => (
        <SwitchRow
          key={l.ItemId}
          icon="folder"
          label={l.Name ?? 'Library'}
          value={hasLibrary(draft, l.ItemId ?? '')}
          onChange={(v) => set(toggleLibrary(draft, allIds, l.ItemId ?? '', v))}
          last={i === arr.length - 1}
        />
      ))}
    </Group>
  );

  const features = (
    <Group title="Allowed">
      <SwitchRow icon="arrow.down.circle" label="Downloads" value={!!draft.EnableContentDownloading} onChange={(v) => set({ EnableContentDownloading: v })} />
      <SwitchRow icon="globe" label="Remote access" value={!!draft.EnableRemoteAccess} onChange={(v) => set({ EnableRemoteAccess: v })} />
      <SwitchRow icon="film" label="Video transcoding" value={!!draft.EnableVideoPlaybackTranscoding} onChange={(v) => set({ EnableVideoPlaybackTranscoding: v })} />
      <SwitchRow icon="music.note" label="Audio transcoding" value={!!draft.EnableAudioPlaybackTranscoding} onChange={(v) => set({ EnableAudioPlaybackTranscoding: v })} />
      <SettingsRow icon="person.2" label="SyncPlay" value={syncPlayLabel(draft.SyncPlayAccess)} onPress={() => setPicker('syncplay')} last />
    </Group>
  );

  const limits = (
    <Group title="Limits" footer="The bitrate limit applies to streams outside the home network.">
      <SettingsRow icon="gauge" label="Max streaming bitrate" value={bitrateLimitLabel(draft.RemoteClientBitrateLimit)} onPress={() => setPicker('bitrate')} />
      <SettingsRow
        icon="lock.fill"
        label="Max parental rating"
        value={draft.MaxParentalRating == null ? 'No limit' : (ratingOptions.find((o) => o.value === draft.MaxParentalRating)?.label ?? String(draft.MaxParentalRating))}
        onPress={() => (ratings.isError ? toast('Could not load the ratings of the server.', { icon: 'exclamationmark.triangle' }) : setPicker('rating'))}
        last
      />
    </Group>
  );

  const account = (
    <Group title="Account" footer={self ? 'You cannot disable or delete the account that you use now.' : undefined}>
      {!self ? (
        <SwitchRow icon="person" label="Account enabled" value={!saved.IsDisabled} onChange={(v) => void setDisabled(!v)} disabled={busy('policy')} />
      ) : null}
      <SettingsRow icon="key" label="Set a new password" onPress={() => setSheet('password')} last={user.HasPassword === false} />
      {user.HasPassword !== false ? <SettingsRow icon="key" label="Remove password" onPress={() => void removePassword()} trailing={<View />} last /> : null}
    </Group>
  );

  const danger = self ? null : (
    <Group>
      <ActionRow label={`Delete ${name}`} onPress={() => setSheet('delete')} />
    </Group>
  );

  const saveBar =
    changes.length > 0 ? (
      <View style={s.saveBar} accessibilityLiveRegion="polite">
        <Text style={s.saveText} numberOfLines={2}>
          {`Not saved: ${describeChanges(changes)}`}
        </Text>
        <View style={s.saveButtons}>
          <Button title="Discard" variant="smallTonal" onPress={() => setDraft(draftFrom(saved))} />
          <Button title="Save changes" variant="small" loading={busy('policy')} onPress={() => void save()} />
        </View>
      </View>
    ) : null;

  const pickerSheet =
    picker === 'bitrate'
      ? { title: 'Max streaming bitrate', options: BITRATE_LIMITS.map((b) => ({ value: b.value as number | null | string, label: b.label })), selected: draft.RemoteClientBitrateLimit ?? 0, apply: (v: unknown) => set({ RemoteClientBitrateLimit: v as number }) }
      : picker === 'rating'
        ? { title: 'Max parental rating', options: ratingOptions.map((o) => ({ value: o.value as number | null | string, label: o.label })), selected: draft.MaxParentalRating ?? null, apply: (v: unknown) => set({ MaxParentalRating: v as number | null }) }
        : picker === 'syncplay'
          ? { title: 'SyncPlay', options: SYNCPLAY_OPTIONS.map((o) => ({ value: o.value as number | null | string, label: o.label })), selected: draft.SyncPlayAccess ?? 'None', apply: (v: unknown) => set({ SyncPlayAccess: v as PolicyEdits['SyncPlayAccess'] }) }
          : null;

  const body = (
    <>
      {embedded ? saveBar : null}
      {wide && (!embedded || layout.contentWidth >= 1280) ? (
        <Columns left={<>{header}{account}{danger}</>} right={<>{libraries}{features}{limits}</>} leftWidth={embedded ? 0.5 : 0.42} />
      ) : (
        <>
          {header}
          {libraries}
          {features}
          {limits}
          {account}
          {danger}
        </>
      )}
      <OptionSheet
        visible={pickerSheet !== null}
        title={pickerSheet?.title ?? ''}
        options={pickerSheet?.options ?? []}
        selected={pickerSheet ? [pickerSheet.selected] : []}
        onSelect={(v) => pickerSheet?.apply(v)}
        onClose={() => setPicker(null)}
      />
      <TextSheet
        visible={sheet === 'password'}
        title={`New password for ${name}`}
        label="New password"
        hint={`${name} signs in with this password from now on. Open sessions stay signed in.`}
        action="Set password"
        secure
        busy={busy('password')}
        onSubmit={async (pw) => {
          const ok = await run('password', () => target.api.setPassword(userId, pw), { success: `New password set for ${name}`, icon: 'key', invalidate });
          if (ok) setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <ConfirmSheet
        visible={sheet === 'delete'}
        title={`Delete ${name}?`}
        message={`The account, its settings, its watch history and its favourites are removed from the server. This cannot be undone.`}
        action="Delete user"
        typed={name}
        busy={busy('delete')}
        onConfirm={async () => {
          const ok = await run('delete', () => target.api.deleteUser(userId), { success: `${name} is deleted`, icon: 'trash', invalidate });
          if (!ok) return;
          setSheet(null);
          if (!embedded && router.canGoBack()) router.back();
        }}
        onClose={() => setSheet(null)}
      />
    </>
  );
  if (embedded) return <View style={s.editor}>{body}</View>;
  // Its own screen: the page scrolls, and the save bar stays at the bottom edge in view.
  return (
    <View style={s.screen}>
      <AdminPage onRefresh={() => Promise.all([users.refetch(), libs.refetch()])} wide>
        <View style={s.editor}>{body}</View>
        {saveBar ? <View style={[s.saveSpace, { height: s.saveSpace.height + barOverlap }]} /> : null}
      </AdminPage>
      {saveBar ? <View style={[s.saveDock, { paddingBottom: barOverlap + spacing.md }]}>{saveBar}</View> : null}
    </View>
  );
}

function SwitchRow({ icon, label, value, onChange, last, disabled }: { icon: Parameters<typeof LeadingIcon>[0]['name']; label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <SettingsRow
      icon={icon}
      label={label}
      onPress={() => !disabled && onChange(!value)}
      role="switch"
      checked={value}
      last={last}
      trailing={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ true: c.accent, false: c.surface3 }}
          thumbColor={mediaColors.white}
          {...webSwitchColors}
          accessibilityLabel={label}
        />
      }
    />
  );
}

const makeStyles = createStyles(({ c, shadow }: AppTheme) => ({
  flex: { flex: 1, gap: 4 },
  stack: { gap: spacing.xxl },
  editor: { gap: spacing.xxl },
  empty: { ...font(type.subheadline), color: c.text2, padding: spacing.lg },
  dim: { opacity: 0.5 },
  userText: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  name: { ...font(type.body), color: c.text, flexShrink: 1 },
  nameOff: { color: c.text2 },
  you: { ...font(type.caption1), color: c.text3 },
  meta: { ...font(type.footnote), color: c.text2 },
  badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.xs, marginTop: 2 },
  headerCard: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'center' as const, backgroundColor: c.surface, borderRadius: 14, padding: spacing.lg },
  title: { ...font(type.title3), color: c.text },
  saveBar: {
    backgroundColor: c.surface2,
    borderRadius: 14,
    padding: spacing.md,
    paddingLeft: spacing.lg,
    gap: spacing.sm,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    width: '100%' as const,
    maxWidth: 680,
    ...shadow('floating'),
  },
  screen: { flex: 1, backgroundColor: c.bgGrouped },
  saveSpace: { height: 96 },
  saveDock: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, alignItems: 'center' as const },
  saveText: { ...font(type.subheadline), color: c.text, flexShrink: 1, minWidth: 160 },
  saveButtons: { flexDirection: 'row' as const, gap: spacing.sm },
}));
