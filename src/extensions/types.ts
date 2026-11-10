/**
 * The saved shapes of installed extensions. One `AccountExtensions` per
 * Jellyfin account (server Id + user Id); `store.ts` shows the one of the
 * signed-in account, `migrate.ts` reads every saved version.
 */
import type { ReplaceableTab } from '@/lib/tab-destination';

import type { Grants } from './http';
import type { Manifest, SkipMode } from './schema';

export interface InstalledExtension {
  manifestUrl: string;
  manifest: Manifest;
  enabled: boolean;
  grants: Grants;
  installedAt: number;
  /** The page the user chose to show as a tab, if any (synced). */
  tab?: string;
  /**
   * Phones only ("On this phone"): show the extension's tab page as a tab in
   * place of this tab. None: a Library tile. Synced, so the account's other
   * phones get it; iPad, the web, the Mac app and TV ignore it.
   */
  phoneTab?: ReplaceableTab;
}

export type SettingValue = string | boolean;
export type Values = Record<string, SettingValue>;
export type ChoiceOptions = Record<string, { value: string; label: string }[]>;

/** The extensions of one account. */
export interface AccountExtensions {
  list: InstalledExtension[];
  /** Values the user set, per extension id. A secret setting keeps only a `•` marker here. */
  values: Record<string, Values>;
  /** Values the app filled in by itself (choice lists matched at install), per extension id. */
  auto: Record<string, Values>;
  /** Choice options fetched from the extension, per extension id and setting key. */
  options: Record<string, ChoiceOptions>;
  /** The skip choice per segment label, key `<extensionId>:<label>` (synced). */
  skip: Record<string, SkipMode>;
}

export const EMPTY_ACCOUNT_EXTENSIONS: AccountExtensions = { list: [], values: {}, auto: {}, options: {}, skip: {} };

/** `<serverId>.<userId>`: the key of an account in the saved data. */
export const accountKey = (ref: { serverId: string; userId: string }): string => `${ref.serverId}.${ref.userId}`;
