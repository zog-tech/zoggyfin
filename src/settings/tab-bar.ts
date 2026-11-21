/**
 * The tab bar (Settings, Tab bar). Saved on the device.
 *
 * `collapseOnScroll`: iOS 26 can shrink the tab bar and the mini player
 * under it while a page scrolls down; a scroll back up brings them back.
 * Off by default: the tabs and the full mini player stay in place.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';

const KEY = 'settings.tabBar';

export interface TabBarSettings {
  collapseOnScroll: boolean;
}

export const DEFAULT_TAB_BAR_SETTINGS: TabBarSettings = { collapseOnScroll: false };

/** The saved settings over the defaults. A missing or wrong field gets its default. Never throws. */
export function readTabBarSettings(saved: unknown): TabBarSettings {
  const out: TabBarSettings = { ...DEFAULT_TAB_BAR_SETTINGS };
  if (!saved || typeof saved !== 'object') return out;
  const collapse = (saved as Record<string, unknown>).collapseOnScroll;
  if (typeof collapse === 'boolean') out.collapseOnScroll = collapse;
  return out;
}

/** The native tab bar's `minimizeBehavior` for the setting. */
export function tabBarMinimizeBehavior(s: TabBarSettings): 'onScrollDown' | 'never' {
  return s.collapseOnScroll ? 'onScrollDown' : 'never';
}

interface Store extends TabBarSettings {
  update(patch: Partial<TabBarSettings>): void;
}

export const useTabBarSettings = create<Store>((set, get) => ({
  ...readTabBarSettings(readJson<unknown>(KEY, null)),
  update(patch) {
    set(patch);
    writeJson(KEY, { collapseOnScroll: get().collapseOnScroll });
  },
}));
