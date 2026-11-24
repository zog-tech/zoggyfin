/**
 * The TV look the user chose (Settings, Appearance on TV): Auto, Modern or
 * Classic. Saved on the device. The look of a run is read once at start
 * (`platform/tv-look-now.ts`), so a change here applies after a restart.
 */
import { create } from 'zustand';

import { readTvLookChoice, type TvLookChoice } from '@/platform/tv-look';
import { readJson, writeJson } from '@/storage/json';

export const TV_LOOK_KEY = 'settings.tvLook';

/** The saved choice. Never throws: no storage (tests) is Auto. */
export function loadTvLookChoice(): TvLookChoice {
  try {
    return readTvLookChoice(readJson<unknown>(TV_LOOK_KEY, 'auto'));
  } catch {
    return 'auto';
  }
}

interface TvLookState {
  choice: TvLookChoice;
  setChoice: (choice: TvLookChoice) => void;
}

export const useTvLookSetting = create<TvLookState>((set) => ({
  choice: loadTvLookChoice(),
  setChoice: (choice) => {
    writeJson(TV_LOOK_KEY, choice);
    set({ choice });
  },
}));
