/**
 * Server actions: "Open web dashboard" for the jobs that the app does not
 * do (plugins, transcoding settings), "Restart server" and "Shut down".
 * Both power actions need the server name typed in a confirm sheet.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Group, SettingsRow } from '@/features/settings/rows';
import { toast } from '@/lib/toast';

import type { AdminTarget } from './access';
import { webDashboardUrl } from './logic';
import { adminKeys, useAdminAction, useSystemInfo } from './queries';
import { ConfirmSheet } from './ui';

export function WebDashboardGroup({ target }: { target: AdminTarget }) {
  return (
    <Group title="More settings" footer="Plugins, transcoding and other server settings are in the web dashboard of the server.">
      <SettingsRow
        icon="arrow.up.right.square"
        label="Open web dashboard"
        onPress={() => {
          Linking.openURL(webDashboardUrl(target.serverUrl)).catch(() => toast('Could not open the web dashboard.', { icon: 'exclamationmark.triangle' }));
        }}
        last
      />
    </Group>
  );
}

export function ServerActionsGroup({ target }: { target: AdminTarget }) {
  const info = useSystemInfo(target);
  const qc = useQueryClient();
  const { busy, run } = useAdminAction();
  const [confirm, setConfirm] = useState<'restart' | 'shutdown' | null>(null);
  const name = info.data?.ServerName || target.serverName;
  // A server that cannot restart itself (for example some service setups) says so.
  const canRestart = info.data?.CanSelfRestart !== false;

  const go = async () => {
    const kind = confirm;
    if (!kind) return;
    const ok = await run(kind, () => (kind === 'restart' ? target.api.restart() : target.api.shutdown()), {
      success: kind === 'restart' ? `${name} restarts. This can take a minute.` : `${name} shuts down.`,
      icon: 'power',
    });
    setConfirm(null);
    if (ok) {
      // Ask again later: the facts (restart pending, sessions) change after a restart.
      setTimeout(() => void qc.invalidateQueries({ queryKey: adminKeys.info(target) }), 15_000);
    }
  };

  return (
    <Group title="Server" footer={canRestart ? 'Everyone who watches or listens now is stopped.' : 'This server cannot restart itself. Restart it where it runs.'}>
      {canRestart ? <SettingsRow icon="arrow.clockwise" label="Restart server" onPress={() => setConfirm('restart')} trailing={<View />} /> : null}
      <SettingsRow icon="power" label="Shut down server" onPress={() => setConfirm('shutdown')} trailing={<View />} last />
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === 'restart' ? 'Restart the server?' : 'Shut down the server?'}
        message={
          confirm === 'restart'
            ? `${name} stops and starts again. All playback stops. The server does not answer for some time.`
            : `${name} stops. It does not start again by itself: someone must start it where it runs. Nobody can use it until then.`
        }
        action={confirm === 'restart' ? 'Restart' : 'Shut down'}
        typed={name}
        busy={busy('restart') || busy('shutdown')}
        onConfirm={() => void go()}
        onClose={() => setConfirm(null)}
      />
    </Group>
  );
}
