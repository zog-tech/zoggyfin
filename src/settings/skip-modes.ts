/**
 * What the player does with each kind of skippable range: skip it by itself
 * (`auto`, a "Skipped …" toast with Undo), show the skip button (`ask`), or
 * nothing (`off`).
 *
 * Rules:
 * - The key is `<scope>:<label>`: `jellyfin:intro` for Jellyfin's segments,
 *   `<extensionId>:<label>` for an extension's.
 * - The user's choice wins. Else the extension's manifest default
 *   (`skipLabels[].default`). Else `ask`, so Jellyfin segments behave as
 *   before this setting existed.
 * - Each choice keeps the time it was made (`at`, ms), for account sync.
 * - The saved shape is versioned; reading a damaged or unknown value never
 *   throws and keeps every entry that is still valid.
 *
 * Pure, so it is unit-tested. The store is in `playback.ts`.
 */
export const SKIP_MODES = ['auto', 'ask', 'off'] as const;
export type SkipMode = (typeof SKIP_MODES)[number];

export const SKIP_SETTINGS_VERSION = 1;

/** One choice, with when it was made (ms since the epoch). */
export interface SkipChoice {
  mode: SkipMode;
  at: number;
}

export interface SkipSettings {
  version: typeof SKIP_SETTINGS_VERSION;
  /** By key `<scope>:<label>`. */
  modes: Record<string, SkipChoice>;
}

export const EMPTY_SKIP_SETTINGS: SkipSettings = { version: SKIP_SETTINGS_VERSION, modes: {} };

/** The most keys kept (10 labels for each of many extensions, plus Jellyfin's). */
export const MAX_SKIP_KEYS = 500;

export const skipKey = (scope: string, label: string) => `${scope}:${label}`;

export const isSkipMode = (v: unknown): v is SkipMode => typeof v === 'string' && (SKIP_MODES as readonly string[]).includes(v);

const validKey = (k: string) => k.length > 0 && k.length <= 200 && k.includes(':');

/** Reads a saved value of any version. Never throws; bad entries are left out. */
export function migrateSkipSettings(raw: unknown): SkipSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SKIP_SETTINGS;
  const r = raw as { version?: unknown; modes?: unknown };
  // Version 1 is the first one; a newer one this app does not know keeps what it can read.
  const modes = r.modes && typeof r.modes === 'object' && !Array.isArray(r.modes) ? (r.modes as Record<string, unknown>) : {};
  const out: Record<string, SkipChoice> = {};
  for (const [key, value] of Object.entries(modes).slice(0, MAX_SKIP_KEYS)) {
    if (!validKey(key) || !value || typeof value !== 'object') continue;
    const v = value as { mode?: unknown; at?: unknown };
    if (!isSkipMode(v.mode)) continue;
    out[key] = { mode: v.mode, at: typeof v.at === 'number' && Number.isFinite(v.at) && v.at >= 0 ? v.at : 0 };
  }
  return { version: SKIP_SETTINGS_VERSION, modes: out };
}

/**
 * The mode of a label: the user's choice, else the source's default for
 * the label, else `ask`.
 */
export function skipModeFor(modes: Readonly<Record<string, SkipChoice>>, scope: string, label: string, defaults?: Readonly<Record<string, SkipMode>>): SkipMode {
  return modes[skipKey(scope, label)]?.mode ?? defaults?.[label] ?? 'ask';
}

/** The settings with one choice set, or removed (null: back to the default). Same object when nothing changes. */
export function withSkipMode(s: SkipSettings, key: string, mode: SkipMode | null, at: number): SkipSettings {
  if (!validKey(key)) return s;
  const cur = s.modes[key];
  if (mode === null) {
    if (!cur) return s;
    const { [key]: _gone, ...rest } = s.modes;
    return { version: SKIP_SETTINGS_VERSION, modes: rest };
  }
  if (cur?.mode === mode) return s;
  return { version: SKIP_SETTINGS_VERSION, modes: { ...s.modes, [key]: { mode, at } } };
}

/** The words for a mode in the settings lists. */
export const SKIP_MODE_LABELS: Record<SkipMode, string> = {
  auto: 'Skip automatically',
  ask: 'Show a skip button',
  off: 'Do nothing',
};
