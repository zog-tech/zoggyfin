/**
 * Devices: every device that signed in to the server, with "Remove" per
 * device. Removing a device signs it out (its token stops working).
 */
import type { DeviceInfoDto } from '@jellyfin/sdk/lib/generated-client/models';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Group, LeadingIcon, makeSettingsStyles } from '@/features/settings/rows';
import { confirmDestructive } from '@/lib/confirm';
import { createStyles, type AppTheme, font, type, useStyles } from '@/theme';

import type { AdminTarget } from './access';
import { formatSince } from './logic';
import { adminKeys, useAdminAction, useDevices } from './queries';

export function DevicesSection({ target }: { target: AdminTarget }) {
  const q = useDevices(target);
  const { busy, run } = useAdminAction();

  if (q.isPending) return <LoadingState rows={6} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = [...q.data].sort((a, b) => Date.parse(b.DateLastActivity ?? '') - Date.parse(a.DateLastActivity ?? '') || 0);

  const remove = async (d: DeviceInfoDto) => {
    const name = d.CustomName || d.Name || 'this device';
    if (!(await confirmDestructive(`Remove ${name}?`, `${name} is signed out${d.LastUserName ? ` (${d.LastUserName})` : ''}. To use the server again, it must sign in again.`, 'Remove'))) return;
    void run(`dev-${d.Id}`, () => target.api.deleteDevice(d.Id ?? ''), { success: `${name} is removed and signed out`, icon: 'trash', invalidate: [adminKeys.devices(target), adminKeys.sessions(target)] });
  };

  if (list.length === 0) return <EmptyState icon="iphone" title="No devices" message="No device is signed in to the server." />;
  return (
    <Group title={`Devices · ${list.length}`} footer="Remove signs a device out. The device on which you use this app now cannot be removed here.">
      {list.map((d, i) => (
        <DeviceRow key={d.Id} device={d} own={d.Id === target.ownDeviceId} busy={busy(`dev-${d.Id}`)} last={i === list.length - 1} onRemove={() => void remove(d)} />
      ))}
    </Group>
  );
}

function DeviceRow({ device: d, own, busy, last, onRemove }: { device: DeviceInfoDto; own: boolean; busy: boolean; last: boolean; onRemove: () => void }) {
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const name = d.CustomName || d.Name || 'Device';
  const app = [d.AppName, d.AppVersion].filter(Boolean).join(' ');
  const when = formatSince(d.DateLastActivity, new Date());
  return (
    <View style={rs.rowPad}>
      <LeadingIcon name="iphone" />
      <View style={[rs.row, rs.rowBody, !last && rs.rowBorder]}>
        <View style={s.text} accessible accessibilityLabel={`${name}${own ? ', this device' : ''}. ${app}. ${d.LastUserName ?? ''}. Last active ${when ?? 'unknown'}`}>
          <Text style={s.name} numberOfLines={1}>
            {name}
            {own ? <Text style={s.own}>  This device</Text> : null}
          </Text>
          <Text style={s.meta} numberOfLines={2}>
            {[app, d.LastUserName, when ? `active ${when}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {own ? null : <Button title="Remove" variant="smallTonal" loading={busy} onPress={onRemove} accessibilityLabel={`Remove ${name}`} />}
      </View>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  text: { flex: 1, gap: 2, minWidth: 0 },
  name: { ...font(type.body), color: c.text },
  own: { ...font(type.caption1), color: c.accent },
  meta: { ...font(type.footnote), color: c.text2 },
}));
