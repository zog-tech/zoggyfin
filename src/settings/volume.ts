/**
 * The app's own volume (the web and the Mac app; rules in `player/volume.ts`):
 * one level and a mute switch for music and video. Saved on the device,
 * versioned, under `settings.volume`. A drag writes at most every 250 ms.
 */
import { create } from 'zustand';

import { features } from '@/platform/tv';
import { audibleLevel, readVolume, reportedVolume, savedVolume, stepVolume, toggleMute, type VolumeState, withLevel } from '@/player/volume';
import { readJson, writeJson } from '@/storage/json';

const KEY = 'settings.volume';

function load(): VolumeState {
  if (!features.inAppVolume) return readVolume(null);
  try {
    return readVolume(readJson<unknown>(KEY, null));
  } catch {
    return readVolume(null);
  }
}

export const useVolume = create<VolumeState>(() => load());

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function apply(next: VolumeState): void {
  const cur = useVolume.getState();
  if (next.level === cur.level && next.muted === cur.muted) return;
  useVolume.setState({ level: next.level, muted: next.muted });
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJson(KEY, savedVolume(useVolume.getState()));
  }, 250);
}

/** The slider moved. */
export function setVolumeLevel(level: number): void {
  apply(withLevel(useVolume.getState(), level));
}

/** Up (positive) or Down key presses. */
export function stepAppVolume(steps: number): void {
  apply(stepVolume(useVolume.getState(), steps));
}

/** The speaker button. */
export function toggleAppMute(): void {
  apply(toggleMute(useVolume.getState()));
}

/** Remote control: Mute, Unmute. */
export function setAppMuted(muted: boolean): void {
  const cur = useVolume.getState();
  if (muted) apply({ ...cur, muted: true });
  else if (cur.muted || cur.level === 0) apply(toggleMute(cur));
}

/** The mute and volume for a progress report; `playerMuted` is the player's own mute. */
export function reportVolume(playerMuted: boolean): { isMuted: boolean; volumeLevel: number | null } {
  return reportedVolume(features.inAppVolume ? useVolume.getState() : null, playerMuted);
}

/** The level that plays now (0 when muted). Always 1 where the app has no volume of its own. */
export function appVolumeNow(): number {
  return features.inAppVolume ? audibleLevel(useVolume.getState()) : 1;
}

/**
 * Calls `listener` with the level that plays (0 to 1, 0 when muted) now and
 * after each change. Returns the unsubscribe. Never fires where the app has
 * no volume of its own.
 */
export function followAppVolume(listener: (level: number) => void): () => void {
  if (!features.inAppVolume) return () => undefined;
  listener(appVolumeNow());
  return useVolume.subscribe((s, prev) => {
    if (s.level !== prev.level || s.muted !== prev.muted) listener(audibleLevel(s));
  });
}
