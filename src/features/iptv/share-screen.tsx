/**
 * Admins: who a provider is shared with. "Everyone" reaches every user of
 * the server, also users added later (the admin's app writes to them the
 * next time it runs). Each change is saved at once and written to the
 * users' accounts. Settings rows (design system §7.15).
 */
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Group, makeSettingsStyles, SettingsRow } from '@/features/settings/rows';
import { TvScrollView } from '@/features/tv/page-scroll';
import { iptv, type ShareChoice } from '@/iptv';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { toast } from '@/lib/toast';
import { isTV } from '@/platform/tv';
import { iconSize, scaled, useStyles, useTheme } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

const NONE: ShareChoice = { everyone: false, users: [] };

export function ShareScreen({ id }: { id: string }) {
  const styles = useStyles(makeSettingsStyles);
  const { c } = useTheme();
  const bottomPad = useTabBottomPadding();
  const sidebar = useSidebarInset();
  const provider = iptv.provider(id);
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  const [choice, setChoice] = useState<ShareChoice>(NONE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    iptv.shareTargets().then(
      (r) => {
        if (!live) return;
        setUsers(r.users);
        setChoice(r.choices.providers[id] ?? NONE);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const save = async (next: ShareChoice) => {
    if (busy) return;
    const before = choice;
    setChoice(next);
    setBusy(true);
    try {
      await iptv.share(id, next.everyone || next.users.length ? next : null);
    } catch {
      setChoice(before);
      toast('The sharing was not saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const toggleUser = (uid: string) => {
    // From "Everyone": every user but this one.
    const current = choice.everyone ? (users ?? []).map((u) => u.id) : choice.users;
    const has = current.includes(uid);
    void save({ everyone: false, users: has ? current.filter((u) => u !== uid) : [...current, uid] });
  };
  const check = (on: boolean) => (on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : <View />);
  const title = 'Share with';

  return (
    <>
      <Stack.Screen options={{ title, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, sidebar ? { paddingLeft: sidebar } : null]}>
        <View style={styles.inner}>
          {isTV ? <Text style={styles.name}>{title}</Text> : null}
          {failed ? (
            <Group footer="Cannot load the users of the server. Check the connection and try again.">{null}</Group>
          ) : !users ? (
            <ActivityIndicator color={c.text2} />
          ) : (
            <>
              <Group
                title={provider?.name ?? 'Provider'}
                footer="The users get this provider on all their devices, with its login. They cannot see the password in the app, but they can use the provider, and admins of the server can read the login.">
                <SettingsRow
                  icon="person.2"
                  label="Everyone"
                  value="Also users added later"
                  onPress={() => void save(choice.everyone ? NONE : { everyone: true, users: [] })}
                  role="radio"
                  checked={choice.everyone}
                  last
                  trailing={check(choice.everyone)}
                />
              </Group>
              {users.length ? (
                <Group title="Users">
                  {users.map((u, i) => {
                    const on = choice.everyone || choice.users.includes(u.id);
                    return (
                      <SettingsRow
                        key={u.id}
                        icon="person"
                        label={u.name}
                        onPress={() => toggleUser(u.id)}
                        role="radio"
                        checked={on}
                        last={i === users.length - 1}
                        trailing={check(on)}
                      />
                    );
                  })}
                </Group>
              ) : (
                <Group footer="This server has no other users.">{null}</Group>
              )}
            </>
          )}
        </View>
      </TvScrollView>
    </>
  );
}
