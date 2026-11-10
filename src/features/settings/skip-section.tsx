/**
 * The skip settings lists: one row per label (Intro, Credits, an
 * extension's Promotion) with what the player does in that range. Settings,
 * Playback shows Jellyfin's labels; an extension's settings page shows the
 * labels of its manifest (`skipLabels`).
 */
import { useState } from 'react';

import { OptionSheet } from '@/components/option-sheet';
import { useExtensions } from '@/extensions/store';
import { BUILTIN_LABELS, BUILTIN_TITLES, JELLYFIN_SKIP_SCOPE } from '@/player/segments';
import { setSkipMode, useSkipSettings } from '@/settings/playback';
import { SKIP_MODE_LABELS, SKIP_MODES, skipKey, skipModeFor, type SkipMode } from '@/settings/skip-modes';

import { Group, SettingsRow } from './rows';

interface LabelSpec {
  id: string;
  title: string;
  /** The mode until the user changes it. */
  default: SkipMode;
}

const DEFAULT_VALUE = 'default';

function SkipLabelGroup({ scope, labels, title, footer }: { scope: string; labels: readonly LabelSpec[]; title: string; footer: string }) {
  const choices = useSkipSettings((s) => s.modes);
  const [open, setOpen] = useState<LabelSpec | null>(null);
  if (!labels.length) return null;
  const defaults = Object.fromEntries(labels.map((l) => [l.id, l.default]));
  const options = open
    ? [
        { value: DEFAULT_VALUE, label: `Default: ${SKIP_MODE_LABELS[open.default]}` },
        ...SKIP_MODES.map((m) => ({ value: m as string, label: SKIP_MODE_LABELS[m] })),
      ]
    : [];
  const chosen = open ? (choices[skipKey(scope, open.id)]?.mode ?? DEFAULT_VALUE) : DEFAULT_VALUE;
  return (
    <Group title={title} footer={footer}>
      {labels.map((l, i) => (
        <SettingsRow
          key={l.id}
          icon="forward.fill"
          label={l.title}
          value={SKIP_MODE_LABELS[skipModeFor(choices, scope, l.id, defaults)]}
          onPress={() => setOpen(l)}
          last={i === labels.length - 1}
        />
      ))}
      <OptionSheet
        visible={open !== null}
        title={open ? `${open.title}` : ''}
        options={options}
        selected={[chosen]}
        onSelect={(v) => open && setSkipMode(skipKey(scope, open.id), v === DEFAULT_VALUE ? null : (v as SkipMode))}
        onClose={() => setOpen(null)}
      />
    </Group>
  );
}

const JELLYFIN_LABELS: LabelSpec[] = BUILTIN_LABELS.map((id) => ({ id, title: BUILTIN_TITLES[id], default: 'ask' }));

/** Settings, Playback: what the player does with the segments a Jellyfin server marks. */
export function SkipSection() {
  return (
    <SkipLabelGroup
      scope={JELLYFIN_SKIP_SCOPE}
      labels={JELLYFIN_LABELS}
      title="Skip segments"
      footer="For intros, credits and other parts your server marks. Skip automatically shows Undo for a few seconds."
    />
  );
}

/** An extension's settings page: what the player does with the parts its media marks. Nothing when it names none. */
export function ExtensionSkipSettings({ extensionId }: { extensionId: string }) {
  const labels = useExtensions((s) => s.list.find((e) => e.manifest.id === extensionId)?.manifest.contributes.skipLabels);
  if (!labels?.length) return null;
  return (
    <SkipLabelGroup
      scope={extensionId}
      labels={labels}
      title="Skip"
      footer="What the player does in the parts of this extension's media. Skip automatically shows Undo for a few seconds."
    />
  );
}
