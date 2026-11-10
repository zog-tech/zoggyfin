/**
 * Grants: what the user allowed an extension to do, one per permission
 * that has a switch. `network` has none (an extension always talks to its
 * own origin). Each grant counts only when the manifest also asks for its
 * permission (`hasGrant`), so a grant can never add a permission.
 *
 * - `itemPath`: file paths of items go to the extension.
 * - `jellyfinToken`: the sign-in token goes to the extension (the red row).
 * - `playback`: the app plays the extension's media (schema version 2).
 * - `downloads`: the app saves the extension's files (schema version 2).
 *
 * Pure, so it is unit-tested.
 */
import type { Grants } from './http';
import type { Manifest, Permission } from './schema';

export type GrantKey = keyof Grants;

/** Every grant, in the order the screens show them. */
export const GRANT_KEYS: readonly GrantKey[] = ['itemPath', 'jellyfinToken', 'playback', 'downloads'];

/** The grant of a permission, or null for one with no switch (`network`). */
export function grantKeyOf(p: Permission): GrantKey | null {
  return (GRANT_KEYS as readonly string[]).includes(p) ? (p as GrantKey) : null;
}

/** True when the extension may do this: the user allowed it and the manifest asks for it. */
export function hasGrant(ext: { manifest: Pick<Manifest, 'permissions'>; grants: Partial<Grants> }, key: GrantKey): boolean {
  return ext.grants[key] === true && ext.manifest.permissions.includes(key);
}

/**
 * Grants from saved data of any version. The grants that existed before
 * (`itemPath`, `jellyfinToken`) keep their value (off when missing). A
 * grant saved data does not have yet (`playback`, `downloads`) is on when
 * the manifest asks for its permission, as at a new install.
 */
export function readGrants(raw: unknown, permissions: readonly string[]): Grants {
  const g = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const newer = (k: 'playback' | 'downloads') => (typeof g[k] === 'boolean' ? (g[k] as boolean) : permissions.includes(k));
  return { itemPath: g.itemPath === true, jellyfinToken: g.jellyfinToken === true, playback: newer('playback'), downloads: newer('downloads') };
}
