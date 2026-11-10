/**
 * The store entry for an extension that the user adds or updates on the
 * confirm screen. Pure.
 */
import type { Grants } from './http';
import type { Manifest } from './schema';
import type { InstalledExtension } from './types';

export interface EntryInput {
  manifestUrl: string;
  manifest: Manifest;
  installed?: InstalledExtension;
}

/**
 * A new extension is on, with the grants from the screen. An update keeps
 * what the user chose before (the tab page, the place on the phone, the add
 * time) and takes the new manifest, address and grants.
 */
export function installEntry(c: EntryInput, grants: Grants, now: number): InstalledExtension {
  const next: InstalledExtension = { manifestUrl: c.manifestUrl, manifest: c.manifest, enabled: true, grants, installedAt: c.installed?.installedAt ?? now };
  if (c.installed?.tab !== undefined) next.tab = c.installed.tab;
  if (c.installed?.phoneTab !== undefined) next.phoneTab = c.installed.phoneTab;
  return next;
}
