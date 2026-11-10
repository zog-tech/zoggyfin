/**
 * Playback settings: streaming quality per network, skip lengths, and what
 * the player does with each kind of skippable range (`skip-modes.ts`).
 * Saved on the device (MMKV on native, localStorage on web).
 */
import { create } from 'zustand';

import type { DownloadQuality } from '@/downloads/types';
import { readJson, writeJson } from '@/storage/json';

import { migrateSkipSettings, type SkipChoice, type SkipMode, type SkipSettings, withSkipMode } from './skip-modes';

/** Bitrate choices in bits per second. `0` = no limit beyond the server's own. */
export const QUALITY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Maximum' },
  { value: 120_000_000, label: '120 Mbps' },
  { value: 60_000_000, label: '60 Mbps' },
  { value: 40_000_000, label: '40 Mbps' },
  { value: 20_000_000, label: '20 Mbps (1080p)' },
  { value: 10_000_000, label: '10 Mbps (1080p)' },
  { value: 8_000_000, label: '8 Mbps (720p)' },
  { value: 4_000_000, label: '4 Mbps (720p)' },
  { value: 2_000_000, label: '2 Mbps (480p)' },
  { value: 1_000_000, label: '1 Mbps (360p)' },
];

export const SKIP_OPTIONS: readonly number[] = [5, 10, 15, 30, 60];

/** What "Maximum" sends to the server: high enough to never limit a local file. */
export const MAX_BITRATE = 200_000_000;

export function qualityLabel(bitrate: number): string {
  return QUALITY_OPTIONS.find((o) => o.value === bitrate)?.label ?? `${Math.round(bitrate / 1e6)} Mbps`;
}

export interface PlaybackSettings {
  wifiBitrate: number;
  cellularBitrate: number;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  autoplayNext: boolean;
  /** Video downloads: 0 keeps the original file when it plays here; else the maximum height. */
  downloadQuality: DownloadQuality;
}

const KEY = 'settings.playback.v1';

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  wifiBitrate: 0,
  cellularBitrate: 8_000_000,
  skipBackSeconds: 10,
  skipForwardSeconds: 10,
  autoplayNext: true,
  downloadQuality: 0,
};

interface Store extends PlaybackSettings {
  update(patch: Partial<PlaybackSettings>): void;
}

export const usePlaybackSettings = create<Store>((set, get) => ({
  ...DEFAULT_PLAYBACK_SETTINGS,
  ...readJson<Partial<PlaybackSettings>>(KEY, {}),
  update(patch) {
    set(patch);
    const s = get();
    const saved: PlaybackSettings = {
      wifiBitrate: s.wifiBitrate,
      cellularBitrate: s.cellularBitrate,
      skipBackSeconds: s.skipBackSeconds,
      skipForwardSeconds: s.skipForwardSeconds,
      autoplayNext: s.autoplayNext,
      downloadQuality: s.downloadQuality,
    };
    writeJson(KEY, saved);
  },
}));

/** The bitrate to request, in bits per second, for the current network. */
export function bitrateFor(settings: PlaybackSettings, cellular: boolean): number {
  const value = cellular ? settings.cellularBitrate : settings.wifiBitrate;
  return value > 0 ? value : MAX_BITRATE;
}

// ---------------------------------------------------------------------------
// Skip modes per label (`skip-modes.ts` has the rules)
// ---------------------------------------------------------------------------

const SKIP_KEY = 'settings.skip';

/** The skip choices, by key `<scope>:<label>`. Saved versioned under `settings.skip`. */
export const useSkipSettings = create<SkipSettings>(() => migrateSkipSettings(readJson<unknown>(SKIP_KEY, null)));

useSkipSettings.subscribe((s) => writeJson(SKIP_KEY, { version: s.version, modes: s.modes }));

/** The user's skip choices now (for account sync and the player). */
export function skipChoices(): Record<string, SkipChoice> {
  return useSkipSettings.getState().modes;
}

/** Sets one choice (null: back to the default). `at` is when it was made, for account sync. */
export function setSkipMode(key: string, mode: SkipMode | null, at = Date.now()): void {
  const cur = useSkipSettings.getState();
  const next = withSkipMode(cur, key, mode, at);
  if (next !== cur) useSkipSettings.setState(next, true);
}

/** Replaces every choice (account sync, after a merge). Bad entries are left out. */
export function replaceSkipChoices(modes: Record<string, SkipChoice>): void {
  useSkipSettings.setState(migrateSkipSettings({ version: 1, modes }), true);
}

/** Calls `listener` after the choices change (account sync pushes then). Returns the unsubscribe. */
export function onSkipChoicesChange(listener: (modes: Record<string, SkipChoice>) => void): () => void {
  return useSkipSettings.subscribe((s, prev) => {
    if (s.modes !== prev.modes) listener(s.modes);
  });
}
