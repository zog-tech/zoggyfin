/**
 * Installed extensions and their setting values, per Jellyfin account.
 * The store shows the extensions of the signed-in account; `bindAccount`
 * swaps them on a sign-in or an account switch. All accounts are saved
 * under `extensions.v2` (`migrate.ts` reads every saved version).
 * Secret text settings go to the secure store; all else is plain JSON.
 */
import { create } from 'zustand';

import { readJson, writeJson } from '@/storage/json';
import { secureStore } from '@/storage/secure';

import type { Grants } from './http';
import { claimAccount, EMPTY_EXTENSIONS_DATA, EXTENSIONS_KEY, EXTENSIONS_KEY_V1, type ExtensionsData, installedElsewhere, loadExtensionsData } from './migrate';
import type { Manifest, SettingField, SettingSource, SkipMode } from './schema';
import { type AccountExtensions, EMPTY_ACCOUNT_EXTENSIONS, type InstalledExtension, type SettingValue, type Values } from './types';

export { accountKey, type AccountExtensions, type InstalledExtension, type SettingValue, type Values } from './types';

interface ExtensionsState extends AccountExtensions {
  /** The account these extensions belong to (`accountKey`), or null when no one is signed in. */
  account: string | null;
}

export const secretKey = (extId: string, key: string) => `ext.${extId}.${key}`;

/** Every account's extensions. Loaded on the first `bindAccount`. */
let data: ExtensionsData | null = null;

export const useExtensions = create<ExtensionsState>(() => ({ account: null, ...EMPTY_ACCOUNT_EXTENSIONS }));

function sliceOf(st: AccountExtensions): AccountExtensions {
  return { list: st.list, values: st.values, auto: st.auto, options: st.options, skip: st.skip };
}

useExtensions.subscribe((st) => {
  if (!data || !st.account) return;
  data = { ...data, accounts: { ...data.accounts, [st.account]: sliceOf(st) } };
  writeJson(EXTENSIONS_KEY, data);
});

/**
 * Shows the extensions of an account (null: signed out). `saved`: the keys
 * of every account saved on the device, for the move from the device-wide
 * list. Safe to call often: the same account changes nothing.
 */
export function bindAccount(key: string | null, saved: readonly string[]): void {
  if (!data) {
    const r = loadExtensionsData(readJson<unknown>(EXTENSIONS_KEY, null), readJson<unknown>(EXTENSIONS_KEY_V1, null), saved);
    data = r.data;
    // The old key stays as it was, so an older app version still finds its list.
    if (r.migrated) writeJson(EXTENSIONS_KEY, data);
  } else if (useExtensions.getState().account === key) return;
  if (!key) {
    useExtensions.setState({ account: null, ...EMPTY_ACCOUNT_EXTENSIONS });
    return;
  }
  const claimed = claimAccount(data, key);
  if (claimed.data !== data) {
    data = claimed.data;
    writeJson(EXTENSIONS_KEY, data);
  }
  useExtensions.setState({ account: key, ...claimed.slice });
}

/** For tests: forget the loaded data, so the next `bindAccount` reads storage again. */
export function resetExtensionsForTests(): void {
  data = null;
  useExtensions.setState({ account: null, ...EMPTY_ACCOUNT_EXTENSIONS });
}

/** The saved extensions of an account that may not be signed in (account sync reads them). */
export function accountExtensions(key: string): AccountExtensions {
  if (useExtensions.getState().account === key) return sliceOf(useExtensions.getState());
  return (data ?? EMPTY_EXTENSIONS_DATA).accounts[key] ?? EMPTY_ACCOUNT_EXTENSIONS;
}

export const extensionsState = () => useExtensions.getState();

export function getExtension(id: string): InstalledExtension | undefined {
  return useExtensions.getState().list.find((e) => e.manifest.id === id);
}

export function upsertExtension(ext: InstalledExtension): void {
  useExtensions.setState((st) => ({ list: [...st.list.filter((e) => e.manifest.id !== ext.manifest.id), ext] }));
}

export function setEnabled(id: string, enabled: boolean): void {
  useExtensions.setState((st) => ({ list: st.list.map((e) => (e.manifest.id === id ? { ...e, enabled } : e)) }));
}

export function setGrant(id: string, grant: keyof Grants, on: boolean): void {
  useExtensions.setState((st) => ({ list: st.list.map((e) => (e.manifest.id === id ? { ...e, grants: { ...e.grants, [grant]: on } } : e)) }));
}

/** The page shown as a tab (undefined: none). */
export function setTabPage(id: string, page: string | undefined): void {
  useExtensions.setState((st) => ({
    list: st.list.map((e) => {
      if (e.manifest.id !== id) return e;
      const { tab: _old, ...rest } = e;
      return page ? { ...rest, tab: page } : rest;
    }),
  }));
}

/** The skip choice of one segment label (undefined: the manifest default). */
export function setSkipMode(extId: string, label: string, mode: SkipMode | undefined): void {
  const key = `${extId}:${label}`;
  useExtensions.setState((st) => {
    const { [key]: _old, ...skip } = st.skip;
    return { skip: mode ? { ...skip, [key]: mode } : skip };
  });
}

export function removeExtension(id: string): void {
  const ext = getExtension(id);
  // Secrets are kept by extension id: another account with this extension still uses them.
  const shared = !!data && installedElsewhere(data, useExtensions.getState().account, id);
  if (!shared) for (const f of ext?.manifest.contributes.settings ?? []) if (f.type === 'text' && f.secret) secureStore.remove(secretKey(id, f.key));
  useExtensions.setState((st) => {
    const { [id]: _v, ...values } = st.values;
    const { [id]: _a, ...auto } = st.auto;
    const { [id]: _o, ...options } = st.options;
    const skip = Object.fromEntries(Object.entries(st.skip).filter(([k]) => !k.startsWith(`${id}:`)));
    return { list: st.list.filter((e) => e.manifest.id !== id), values, auto, options, skip };
  });
}

export function setValue(extId: string, field: SettingField, value: SettingValue | undefined): void {
  if (field.type === 'text' && field.secret) {
    if (value === undefined || value === '') secureStore.remove(secretKey(extId, field.key));
    else secureStore.set(secretKey(extId, field.key), String(value));
    // Keep a marker so the screen knows a value exists, never the value itself.
    value = value === undefined || value === '' ? undefined : '•';
  }
  useExtensions.setState((st) => {
    const cur = { ...(st.values[extId] ?? {}) };
    if (value === undefined) delete cur[field.key];
    else cur[field.key] = value;
    return { values: { ...st.values, [extId]: cur } };
  });
}

export function setAuto(extId: string, values: Values, options: Record<string, { value: string; label: string }[]>): void {
  useExtensions.setState((st) => ({
    auto: { ...st.auto, [extId]: { ...(st.auto[extId] ?? {}), ...values } },
    options: { ...st.options, [extId]: { ...(st.options[extId] ?? {}), ...options } },
  }));
}

/** The account facts that `source` settings read. */
export interface AccountFacts {
  serverUrl: string;
  serverId: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
}

export function sourceValue(source: SettingSource | undefined, account: AccountFacts | null): SettingValue | undefined {
  if (!source || !account) return undefined;
  switch (source) {
    case 'jellyfin.serverUrl':
      return account.serverUrl;
    case 'jellyfin.serverId':
      return account.serverId;
    case 'jellyfin.userId':
      return account.userId;
    case 'jellyfin.userName':
      return account.userName;
    case 'jellyfin.isAdmin':
      return account.isAdmin;
  }
}

/**
 * The value in use for each setting: what the user set, else what the app
 * filled in, else the account value (`source`), else the default, else the
 * first option.
 */
export function effectiveValues(
  m: Manifest,
  st: Pick<AccountExtensions, 'values' | 'auto' | 'options'>,
  account: AccountFacts | null,
  readSecret: (key: string) => string | null = (k) => secureStore.get(secretKey(m.id, k)),
): Values {
  const out: Values = {};
  const user = st.values[m.id] ?? {};
  const auto = st.auto[m.id] ?? {};
  for (const f of m.contributes.settings ?? []) {
    if (f.type === 'text' && f.secret) {
      const s = user[f.key] !== undefined ? readSecret(f.key) : null;
      out[f.key] = s ?? (f.default ?? '');
      continue;
    }
    const fromSource = f.type === 'choice' ? undefined : sourceValue(f.source, account);
    const firstOption = f.type === 'choice' ? (f.options?.[0]?.value ?? st.options[m.id]?.[f.key]?.[0]?.value) : undefined;
    const fallback = f.type === 'toggle' ? false : '';
    out[f.key] = user[f.key] ?? auto[f.key] ?? fromSource ?? f.default ?? firstOption ?? fallback;
  }
  return out;
}

/** The manifest URLs of the turned-on extensions, for invite links. */
export function extensionsForInvite(): string[] {
  return useExtensions
    .getState()
    .list.filter((e) => e.enabled)
    .map((e) => e.manifestUrl);
}
