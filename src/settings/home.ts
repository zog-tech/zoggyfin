/**
 * What Home shows (Settings, Home). Saved on the device.
 * `music`: the music rows (Continue listening, Recently added in a music library). Some keep
 * Home for movies and shows; music has its own tab.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

const KEY = 'settings.home';

export interface HomeSettings {
  music: boolean;
}

export const DEFAULT_HOME_SETTINGS: HomeSettings = { music: true };

/** The saved settings over the defaults. A missing or wrong field gets its default. Never throws. */
export function readHomeSettings(saved: unknown): HomeSettings {
  const out: HomeSettings = { ...DEFAULT_HOME_SETTINGS };
  if (!saved || typeof saved !== 'object') return out;
  const music = (saved as Record<string, unknown>).music;
  if (typeof music === 'boolean') out.music = music;
  return out;
}

interface Store extends HomeSettings {
  update(patch: Partial<HomeSettings>): void;
}

export const useHomeSettings = create<Store>((set, get) => ({
  ...readHomeSettings(readJson<unknown>(KEY, null)),
  update(patch) {
    set(patch);
    writeJson(KEY, { music: get().music });
  },
}));
