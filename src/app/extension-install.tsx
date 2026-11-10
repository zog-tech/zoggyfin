/**
 * The install confirm screen. It shows each extension's name, address,
 * permissions and contributions. The user confirms once; the app then fills
 * in the settings by itself. After a failure it offers only the extensions
 * not added yet, with a message (`install-request.ts`). For extensions
 * that account sync offers, the title is "From your account" and Cancel
 * is "Not now" (the offer does not come back for the same add).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon-names';
import type { Grants } from '@/extensions/http';
import { chosenGrants, SWITCHED_GRANTS } from '@/extensions/install-request';
import { cancelInstallRequest, confirmInstallRequest, install, pendingCandidates, type Candidate, useInstallRequest } from '@/extensions/runtime';
import { describePermission, type Manifest, safeHost } from '@/extensions/schema';
import { ModalHeader } from '@/extensions/ui/modal-header';
import { Group, makeSettingsStyles, webSwitchColors } from '@/features/settings/rows';
import { toast } from '@/lib/toast';
import { createStyles, type AppTheme, font, iconSize, mediaColors, radius, scaled, spacing, type, useStyles, useTheme } from '@/theme';

export default function ExtensionInstallScreen() {
  const s = useStyles(makeStyles);
  const st = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const { entries: all, loading, installing, notice, source } = useInstallRequest();
  // Extensions already added in this request leave the screen.
  const entries = all.filter((e) => !e.done);
  const ready = pendingCandidates(all);
  // The token, playback and download permissions each have a switch, pre-set by `initialGrants`
  // (on for a new extension, the account's value for one from the account). What the user sets here wins.
  const [choice, setChoice] = useState<Record<string, Partial<Grants>>>({});
  const grants: Record<string, Grants> = Object.fromEntries(ready.map((cand) => [cand.manifest.id, chosenGrants(cand, choice[cand.manifest.id])]));

  const close = () => {
    cancelInstallRequest();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(home)');
  };

  const confirm = async () => {
    const r = await confirmInstallRequest((cand) =>
      install(cand, chosenGrants(cand, choice[cand.manifest.id])),
    );
    if (r.kind === 'done') {
      toast(r.names.length === 1 ? `${r.names[0]} is on` : `${r.names.length} extensions are on`, { icon: 'checkmark' });
      close();
    } else if (r.kind === 'partial') {
      toast(r.message, { icon: 'exclamationmark.triangle' });
    }
  };

  const fromAccount = source === 'account';
  const title = fromAccount ? 'From your account' : entries.length > 1 ? 'Add extensions' : 'Add extension';
  return (
    <View style={s.page}>
      <ModalHeader title={title} onClose={close} closeLabel={fromAccount ? 'Not now' : 'Cancel'} />
      <ScrollView contentContainerStyle={[st.content, s.content]}>
        <View style={st.inner}>
          {entries.map((e) =>
            e.candidate ? (
              <Summary
                key={e.input}
                cand={e.candidate}
                grants={grants[e.candidate.manifest.id] ?? chosenGrants(e.candidate, undefined)}
                setGrant={(k, v) => setChoice((all) => ({ ...all, [e.candidate!.manifest.id]: { ...all[e.candidate!.manifest.id], [k]: v } }))}
              />
            ) : e.error ? (
              <Group key={e.input} title={safeHost(e.input)}>
                <View style={s.errorRow}>
                  <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
                  <Text style={s.errorText}>{e.error}</Text>
                </View>
              </Group>
            ) : (
              <View key={e.input} style={s.loading}>
                <ActivityIndicator color={c.text2} />
                <Text style={s.muted}>Loading {e.input}</Text>
              </View>
            ),
          )}
          {notice ? (
            <View style={s.errorRow}>
              <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
              <Text style={s.errorText}>{notice}</Text>
            </View>
          ) : null}
          {!loading && ready.length ? (
            <View style={s.buttons}>
              <Button title={ready.length > 1 ? `Add ${ready.length} extensions` : ready[0].installed ? 'Update' : 'Add'} onPress={() => void confirm()} loading={installing} />
              {fromAccount ? <Text style={s.footer}>You added {ready.length > 1 ? 'these extensions' : 'this extension'} on another device. Secret settings, such as keys, do not sync: enter them again in its settings on this device.</Text> : null}
              <Text style={s.footer}>Extensions show buttons, Home rows and pages from their own server. They run no code in Zoggyfin. You can turn one off or remove it in Settings at any time.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function contributions(m: Manifest): string[] {
  const k = m.contributes;
  const out: string[] = [];
  const names = (list: { title: string }[] | undefined) => (list ?? []).map((x) => x.title).join(', ');
  if (k.itemActions?.length) out.push(`Buttons on items: ${names(k.itemActions)}`);
  if (k.homeSections?.length) out.push(`Home rows: ${names(k.homeSections)}`);
  if (k.shareTargets?.length) out.push(`Shared links: ${names(k.shareTargets)}`);
  if (k.panels?.length) out.push(`Pages: ${names(k.panels)}`);
  if (k.settings?.length) out.push(`${k.settings.length} ${k.settings.length === 1 ? 'setting' : 'settings'}, filled in for you`);
  return out;
}

const PERMISSION_ICONS: Partial<Record<string, IconName>> = { network: 'globe', itemPath: 'folder', playback: 'play.fill', downloads: 'arrow.down.circle' };

function Summary({ cand, grants, setGrant }: { cand: Candidate; grants: Grants; setGrant: (k: (typeof SWITCHED_GRANTS)[number], v: boolean) => void }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const m = cand.manifest;
  const perms = m.permissions.map((p) => ({ p, ...describePermission(p, m) }));
  return (
    <>
      <View style={s.head}>
        <View style={s.badge}>
          <Icon name="square.grid.2x2" size={scaled(iconSize.lg)} color={mediaColors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{m.name}</Text>
          <Text style={s.muted}>
            Version {m.version} · {safeHost(m.baseUrl)}
            {cand.installed ? ` · installed ${cand.installed.manifest.version}` : ''}
          </Text>
          {m.description ? <Text style={s.desc}>{m.description}</Text> : null}
        </View>
      </View>
      <Group title="Permissions">
        {perms.map(({ p, title, detail, sensitive }, i) => (
          <View key={p} style={[s.perm, i < perms.length - 1 && s.line, sensitive && s.sensitive]}>
            <Icon name={sensitive ? 'exclamationmark.triangle' : (PERMISSION_ICONS[p] ?? 'folder')} size={scaled(iconSize.sm)} color={sensitive ? c.danger : c.text2} />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <Text style={[s.permTitle, sensitive && { color: c.danger }]}>{title}</Text>
              <Text style={s.muted}>{detail}</Text>
            </View>
            {p === 'jellyfinToken' || p === 'playback' || p === 'downloads' ? (
              <Switch value={grants[p]} onValueChange={(v) => setGrant(p, v)} trackColor={{ true: c.accent, false: c.surface3 }} thumbColor={mediaColors.white} {...webSwitchColors} accessibilityLabel={title} />
            ) : null}
          </View>
        ))}
      </Group>
      <Group title="Adds">
        {contributions(m).map((line, i, all) => (
          <View key={line} style={[s.perm, i < all.length - 1 && s.line]}>
            <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} />
            <Text style={[s.permTitle, { flex: 1, fontWeight: '400' }]}>{line}</Text>
          </View>
        ))}
      </Group>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bgGrouped },
  content: { paddingTop: spacing.lg },
  head: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-start' as const },
  badge: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: c.accent, alignItems: 'center' as const, justifyContent: 'center' as const, borderCurve: 'continuous' as const },
  name: { ...font(type.title3), color: c.text },
  desc: { ...font(type.subheadline), color: c.text, marginTop: spacing.xs },
  muted: { ...font(type.footnote), color: c.text2 },
  perm: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'center' as const, padding: spacing.md, paddingLeft: spacing.lg },
  line: { borderBottomWidth: 0.5, borderBottomColor: c.separator },
  sensitive: { backgroundColor: c.surface2 },
  permTitle: { ...font(type.body), fontWeight: '600' as const, color: c.text },
  errorRow: { flexDirection: 'row' as const, gap: spacing.md, padding: spacing.lg, alignItems: 'center' as const },
  errorText: { ...font(type.subheadline), color: c.text, flex: 1 },
  loading: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'center' as const, padding: spacing.lg },
  buttons: { gap: spacing.md },
  footer: { ...font(type.footnote), color: c.text2, textAlign: 'center' as const },
}));
