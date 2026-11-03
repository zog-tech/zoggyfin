/**
 * Subtitle appearance settings (Settings, Subtitles). Saved on the device
 * (MMKV on native, localStorage on web) under their own versioned key, so the
 * playback settings keep their saved shape. The rules are in `subtitle-style.ts`.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { readJson, writeJson } from '@/storage/json';

import { DEFAULT_SUBTITLE_APPEARANCE, normalizeSubtitleAppearance, type SubtitleAppearance } from './subtitle-style';

const KEY = 'settings.subtitles.v1';
const VERSION = 1;

interface Store extends SubtitleAppearance {
  update(patch: Partial<SubtitleAppearance>): void;
}

function load(): SubtitleAppearance {
  try {
    return normalizeSubtitleAppearance(readJson<unknown>(KEY, DEFAULT_SUBTITLE_APPEARANCE));
  } catch {
    return DEFAULT_SUBTITLE_APPEARANCE;
  }
}

export const useSubtitleSettings = create<Store>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    writeJson(KEY, { version: VERSION, ...normalizeSubtitleAppearance(get()) });
  },
}));

/** The current choices as a plain value (no store functions). */
export function useSubtitleAppearance(): SubtitleAppearance {
  return useSubtitleSettings(useShallow((s) => ({ size: s.size, color: s.color, background: s.background, position: s.position })));
}
