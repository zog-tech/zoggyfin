/**
 * The TV look: Classic (the TV design before the redesign) or Modern
 * (design system §7.22). One choice in Settings selects it; Auto keeps
 * Classic on an Amazon Fire TV and in Lite mode, because those devices are
 * small and Classic is measured on them, and gives Modern elsewhere.
 * Pure, so it is unit-tested; `tv-look-now.ts` reads the device and the
 * saved choice.
 */
export type TvLook = 'classic' | 'modern';
export type TvLookChoice = 'auto' | 'classic' | 'modern';
export const TV_LOOK_CHOICES: readonly TvLookChoice[] = ['auto', 'modern', 'classic'];

export interface TvLookDevice {
  /** Platform.OS */
  os: string;
  /** expo-device: Device.manufacturer, Device.brand, Device.modelName */
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  /** Lite mode is on now (platform/lite.ts `liteActive`). */
  lite: boolean;
}

/** An Amazon Fire TV device: Android with the manufacturer or brand "Amazon", or a model name that starts with "AFT". */
export function isFireTv(d: TvLookDevice): boolean {
  if (d.os !== 'android') return false;
  const amazon = (s: string | null) => !!s && s.trim().toLowerCase() === 'amazon';
  return amazon(d.manufacturer) || amazon(d.brand) || /^AFT/i.test(d.model ?? '');
}

/**
 * The look for this run.
 * 1. `override` (the web preview parameter) wins.
 * 2. The user's choice `classic` or `modern` wins over the device.
 * 3. Auto: Classic on Fire TV, Classic in Lite mode, Modern elsewhere.
 */
export function tvLookFor(choice: TvLookChoice, d: TvLookDevice, override: TvLook | null = null): TvLook {
  if (override) return override;
  if (choice !== 'auto') return choice;
  return isFireTv(d) || d.lite ? 'classic' : 'modern';
}

/** The Settings value text. Auto says what it chose. */
export function tvLookLabel(choice: TvLookChoice, active: TvLook): string {
  if (choice === 'modern') return 'Modern';
  if (choice === 'classic') return 'Classic';
  return active === 'modern' ? 'Auto (Modern)' : 'Auto (Classic)';
}

/** A saved value of any shape to a choice. Never throws; unknown is 'auto'. */
export function readTvLookChoice(saved: unknown): TvLookChoice {
  return saved === 'classic' || saved === 'modern' ? saved : 'auto';
}

/** A look parameter (the web preview's `?tvlook=`) to a look; anything else is null. */
export function readTvLook(value: unknown): TvLook | null {
  return value === 'classic' || value === 'modern' ? value : null;
}
