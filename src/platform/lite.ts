/**
 * Lite mode: the app uses less memory on a small device (a 1 GB Fire TV
 * Stick). Measured on a Fire TV Stick (922 MB, 128 MB Java heap per app): the
 * app used about 300 MB with swap and the system closed it.
 *
 * In Lite mode:
 * - Home plays no previews (one preview player took about 90 MB),
 * - a TV tab that you leave is unloaded, not kept in the background,
 * - a page change empties the image memory cache,
 * - the Home backdrop loads at 1x density (not 1.5x).
 *
 * The choice is Auto (on for an Android device with less than 2 GB of
 * memory), On or Off. Pure, so it is unit-tested; `use-lite.ts` reads the device.
 */
export type LiteChoice = 'auto' | 'on' | 'off';

export const LITE_CHOICES: readonly LiteChoice[] = ['auto', 'on', 'off'];

const GB = 1024 * 1024 * 1024;

/** True for a device that Auto puts in Lite mode: Android with less than 2 GB of memory. */
export function isSmallDevice(os: string, totalMemoryBytes: number | null | undefined): boolean {
  return os === 'android' && !!totalMemoryBytes && totalMemoryBytes < 2 * GB;
}

/** True when Lite mode is on for this device. */
export function liteActive(choice: LiteChoice, os: string, totalMemoryBytes: number | null | undefined): boolean {
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return isSmallDevice(os, totalMemoryBytes);
}

/** The label of a choice; Auto says what it chose. */
export function liteLabel(choice: LiteChoice, active: boolean): string {
  if (choice === 'on') return 'On';
  if (choice === 'off') return 'Off';
  return active ? 'Auto (on)' : 'Auto (off)';
}
