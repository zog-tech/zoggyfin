/**
 * One extension: on/off, what it may receive, its settings (filled in by
 * the app; the user can change them), its pages, update and remove.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';

import { EmptyState } from '@/components/states';
import { extensionDownloadCount, removeExtensionDownloads } from '@/downloads';
import { OptionSheet } from '@/components/option-sheet';
import { askText } from '@/extensions/prompts';
import { currentAccount, loadManifest, prefill, requestInstall, templateContext } from '@/extensions/runtime';
import { describePermission, pagesOf, safeHost, type SettingField } from '@/extensions/schema';
import { extensionsState, getExtension, removeExtension, setEnabled, setGrant, setPhoneTab, setTabPage, setValue, upsertExtension, useExtensions } from '@/extensions/store';
import { pageHref } from '@/features/extensions/nav';
import { ActionRow, Group, InfoRow, makeSettingsStyles, SettingsRow, webSwitchColors } from '@/features/settings/rows';
import { ExtensionSkipSettings } from '@/features/settings/skip-section';
import { TvScrollView } from '@/features/tv/page-scroll';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { grantKeyOf } from '@/extensions/grants';
import { features } from '@/platform/tv';
import { mediaColors, spacing, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { pageIconName } from '@/features/extensions/icons';
import { choosePhoneTab, chooseTabPage, type PhoneTab, phoneTabChoices, phoneTabValue, tabChoices, tabPagesOf, tabSlotPage } from '@/features/extensions/placement';
import { PLACEMENT_PLATFORM, usePagePlacement } from '@/features/extensions/use-placement';
import { TAB_INFO } from '@/lib/tab-destination';

const PHONE_CHOICES = phoneTabChoices({ downloads: features.downloads });

/** The footer of the "On this phone" row: what each choice keeps reachable. */
function phoneFooter(value: PhoneTab): string {
  const base = 'A tab takes the place of one tab, so the bar keeps five. Your other phones get this choice; iPad, the web, the Mac app and TV keep their own layout.';
  if (value === 'none') return `The page is a tile in Library. ${base}`;
  const tab = value.slice('replace:'.length) as keyof typeof TAB_INFO;
  const where = tab === '(library)' ? 'Library stays one tap away from the button at the top of Home.' : `${TAB_INFO[tab].title} stays one tap away from its tile in Library.`;
  return `${where} ${base}`;
}

/** Where the chosen tab page shows on this device (features/extensions/placement.ts). */
function tabFooter(): string {
  if (PLACEMENT_PLATFORM === 'tv') return 'One extension page can be a tab. On TV it comes first in the side menu. The choice follows your account.';
  if (PLACEMENT_PLATFORM === 'phone') return 'The page that is a tab on iPad, the web and the Mac app. On this phone, "On this phone" decides.';
  return 'One extension page can be a tab on iPad, the web and the Mac app. The choice follows your account to your other devices.';
}

const NO_OPTIONS: Record<string, { value: string; label: string }[]> = {};

export default function ExtensionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles(makeSettingsStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const sidebar = useSidebarInset();
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === id));
  // Subscribe to values, so the rows show changes at once.
  useExtensions((st) => st.values[id]);
  useExtensions((st) => st.auto[id]);
  const options = useExtensions((st) => st.options[id]) ?? NO_OPTIONS;
  const [picker, setPicker] = useState<SettingField | null>(null);
  const [tabPicker, setTabPicker] = useState(false);
  const [phonePicker, setPhonePicker] = useState(false);
  const placement = usePagePlacement();
  const list = useExtensions((st) => st.list);
  const [checking, setChecking] = useState(false);

  // Fetch the choice lists again when the page opens.
  useEffect(() => {
    const e = getExtension(id);
    if (e?.enabled) void prefill(e);
  }, [id]);

  if (!ext) {
    return (
      <>
        <Stack.Screen options={{ title: 'Extension' }} />
        <EmptyState icon="square.grid.2x2" title="Extension not found" message="It was removed." />
      </>
    );
  }
  const m = ext.manifest;
  const values = templateContext(ext).settings ?? {};
  const settings = m.contributes.settings ?? [];
  const sw = (value: boolean, set: (v: boolean) => void, label: string) => (
    <Switch value={value} onValueChange={set} trackColor={{ true: c.accent, false: c.surface3 }} thumbColor={mediaColors.white} {...webSwitchColors} accessibilityLabel={label} />
  );

  const update = async () => {
    setChecking(true);
    try {
      const cand = await loadManifest(ext.manifestUrl);
      if (cand.manifest.id !== m.id) throw new Error('The address now serves another extension.');
      const newPerms = cand.manifest.permissions.filter((p) => !m.permissions.includes(p));
      if (newPerms.length) {
        // New permissions need a new confirm.
        void requestInstall([ext.manifestUrl]);
        return;
      }
      upsertExtension({ ...ext, manifest: cand.manifest });
      await prefill({ ...ext, manifest: cand.manifest });
      toast(cand.manifest.version === m.version ? `${m.name} is up to date` : `${m.name} updated to ${cand.manifest.version}`, { icon: 'checkmark' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The check failed.', { icon: 'exclamationmark.triangle' });
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDestructive(`Remove ${m.name}?`, 'Its buttons, Home rows and pages go away. Nothing changes on its server.', 'Remove'))) return;
    // Its downloads are the user's files: ask before they go. Kept ones stay in Downloads and still play.
    const saved = extensionDownloadCount(m.id);
    if (saved > 0) {
      const one = saved === 1;
      const words = one ? 'download' : 'downloads';
      const body = one
        ? `The download of ${m.name} on this device is removed. Keep it to watch it later.`
        : `The downloads of ${m.name} on this device are removed. Keep them to watch them later.`;
      if (await confirmDestructive(`Delete its ${saved} ${words} too?`, body, 'Delete')) {
        await removeExtensionDownloads(m.id);
      }
    }
    removeExtension(m.id);
    router.back();
  };

  const editText = async (f: SettingField) => {
    const v = await askText({ title: f.label, message: f.description, initial: f.type === 'text' && f.secret ? '' : String(values[f.key] ?? ''), placeholder: f.type === 'text' ? f.placeholder : undefined });
    if (v !== null) setValue(m.id, f, v);
  };

  // Native pages of a v2 manifest (a v1 Home row is a page too, but it has no page of its own to open).
  const pageRows = m.schemaVersion === 2 && ext.enabled ? pagesOf(m) : [];
  const panels = features.extensionPanels ? (m.contributes.panels ?? []) : [];
  const pickerOptions = picker?.type === 'choice' ? (picker.options?.length ? picker.options : (options[picker.key] ?? [])) : [];
  const account = currentAccount();
  // "Show as tab": only when the account has more than one page that may fill the one tab slot.
  const ownTabPages = ext.enabled ? tabPagesOf(ext) : [];
  const tabChoice = ownTabPages.length && tabChoices(list).length > 1 ? ownTabPages : [];
  const slot = tabSlotPage(list);
  const slotHere = slot?.extId === m.id ? slot : null;
  const chooseTab = (pageId: string) => {
    for (const u of chooseTabPage(extensionsState().list, m.id, pageId)) setTabPage(u.extId, u.page);
  };
  // "On this phone": phones only (Android tablets count as phones), for an extension with a tab-capable page.
  const phoneRow = PLACEMENT_PLATFORM === 'phone' && ownTabPages.length > 0;
  const phoneValue = phoneTabValue(placement, m.id);
  const choosePhone = (v: PhoneTab) => {
    const updates = choosePhoneTab(extensionsState().list, m.id, v);
    if (!updates.length) return;
    // The tab bar changes at once (the tab navigator remounts and opens Home); playback goes on.
    for (const u of updates) setPhoneTab(u.extId, u.tab);
    const tab = v === 'none' ? null : (v.slice('replace:'.length) as keyof typeof TAB_INFO);
    toast(
      !tab ? `${m.name} is a tile in Library again.` : tab === '(library)' ? `${m.name} is a tab now. Library is at the top of Home.` : `${m.name} is a tab now. ${TAB_INFO[tab].title} is in Library.`,
      { icon: 'iphone' },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: m.name, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar + spacing.lg } : null]}>
        <View style={styles.inner}>
          <Group footer={m.description}>
            <SettingsRow icon="checkmark.circle.fill" label="On" onPress={() => setEnabled(m.id, !ext.enabled)} role="switch" checked={ext.enabled} trailing={sw(ext.enabled, (v) => setEnabled(m.id, v), 'On')} />
            <InfoRow icon="info.circle" label="Version" value={m.version} />
            <InfoRow icon="globe" label="Server" value={safeHost(m.baseUrl)} last />
          </Group>

          <Group title="Permissions">
            {m.permissions.map((p, i) => {
              const d = describePermission(p, m);
              const last = i === m.permissions.length - 1;
              // Each permission has its own grant; one with no grant (network) is a plain row.
              const key = grantKeyOf(p);
              if (!key) return <InfoRow key={p} icon="globe" label={d.title} value="" last={last} />;
              const on = ext.grants[key];
              return (
                <SettingsRow
                  key={p}
                  icon={p === 'itemPath' ? 'folder' : p === 'playback' ? 'play.fill' : p === 'downloads' ? 'arrow.down.circle' : 'lock.fill'}
                  label={d.title}
                  onPress={() => setGrant(m.id, key, !on)}
                  role="switch"
                  checked={on}
                  last={last}
                  trailing={sw(on, (v) => setGrant(m.id, key, v), d.title)}
                />
              );
            })}
          </Group>

          {settings.length ? (
            <Group title="Settings" footer="The app fills these in. Change one only if the extension asks you to.">
              {settings.map((f, i) => {
                const last = i === settings.length - 1;
                const v = values[f.key];
                if (f.type === 'toggle') {
                  return <SettingsRow key={f.key} icon="gearshape" label={f.label} onPress={() => setValue(m.id, f, !v)} role="switch" checked={!!v} last={last} trailing={sw(!!v, (x) => setValue(m.id, f, x), f.label)} />;
                }
                const shown =
                  f.type === 'choice'
                    ? ((f.options ?? options[f.key] ?? []).find((o) => o.value === v)?.label ?? String(v ?? ''))
                    : f.secret
                      ? (v ? '••••••' : 'Not set')
                      : String(v ?? '');
                return <SettingsRow key={f.key} icon="gearshape" label={f.label} value={shown || 'Not set'} onPress={() => (f.type === 'choice' ? setPicker(f) : void editText(f))} last={last} />;
              })}
            </Group>
          ) : null}

          <ExtensionSkipSettings extensionId={m.id} />

          {phoneRow ? (
            <Group footer={phoneFooter(phoneValue)}>
              <SettingsRow
                icon="iphone"
                label="On this phone"
                value={PHONE_CHOICES.find((o) => o.value === phoneValue)?.label ?? 'Library tile'}
                onPress={() => setPhonePicker(true)}
                last
              />
            </Group>
          ) : null}

          {tabChoice.length ? (
            <Group footer={tabFooter()}>
              <SettingsRow icon="square.stack" label="Show as tab" value={slotHere?.title ?? 'Another extension'} onPress={() => setTabPicker(true)} last />
            </Group>
          ) : null}

          {pageRows.length || panels.length ? (
            <Group title="Pages">
              {pageRows.map((p, i) => (
                <SettingsRow
                  key={`page:${p.id}`}
                  icon={pageIconName(p.icon)}
                  label={`Open ${p.title}`}
                  onPress={() => router.push(pageHref('(home)', m.id, p.id))}
                  last={i === pageRows.length - 1 && !panels.length}
                />
              ))}
              {panels.map((p, i, all) => (
                <SettingsRow key={p.id} icon="square.grid.2x2" label={p.title} onPress={() => router.push({ pathname: '/extension-panel', params: { ext: m.id, panel: p.id } })} last={i === all.length - 1} />
              ))}
            </Group>
          ) : null}

          <Group footer={account ? undefined : 'Sign in to use this extension.'}>
            <SettingsRow icon="arrow.clockwise" label={checking ? 'Checking' : 'Check for an update'} onPress={() => void update()} last />
          </Group>
          <Group>
            <ActionRow label={`Remove ${m.name}`} onPress={remove} />
          </Group>
        </View>
      </TvScrollView>
      <OptionSheet
        visible={picker !== null}
        title={picker?.label ?? ''}
        options={pickerOptions}
        selected={picker ? [String(values[picker.key] ?? '')] : []}
        onSelect={(v) => picker && setValue(m.id, picker, v)}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={tabPicker}
        title="Show as tab"
        options={tabChoice.map((p) => ({ value: p.id, label: p.title }))}
        selected={slotHere ? [slotHere.pageId] : []}
        onSelect={(v) => {
          chooseTab(v);
          setTabPicker(false);
        }}
        onClose={() => setTabPicker(false)}
      />
      <OptionSheet
        visible={phonePicker}
        title="On this phone"
        options={PHONE_CHOICES}
        selected={[phoneValue]}
        onSelect={(v) => {
          setPhonePicker(false);
          choosePhone(v as PhoneTab);
        }}
        onClose={() => setPhonePicker(false)}
      />
    </>
  );
}
