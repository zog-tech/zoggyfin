/**
 * Which contributions the runtime registers, and when it must register
 * again. The list is the signed-in account's (`store.ts`), so an account
 * switch gives another signature and the runtime registers again: the old
 * account's buttons and Home rows go, the new account's come.
 *
 * Pure, so it is unit-tested; `runtime.ts` does the registering.
 */
import type { ItemActionSpec } from './schema';
import type { InstalledExtension } from './types';

export type Contribution =
  | { kind: 'itemAction'; id: string; order: number; extId: string; action: ItemActionSpec }
  | { kind: 'homeSection'; id: string; order: number; extId: string; sectionId: string };

/** The item actions (order 60+) and Home rows (order 45+) of the enabled extensions, oldest install first. */
export function plannedContributions(list: readonly InstalledExtension[]): Contribution[] {
  const out: Contribution[] = [];
  [...list]
    .filter((e) => e.enabled)
    .sort((a, b) => a.installedAt - b.installedAt)
    .forEach((ext, i) => {
      const extId = ext.manifest.id;
      (ext.manifest.contributes.itemActions ?? []).forEach((action, j) => {
        out.push({ kind: 'itemAction', id: `ext.${extId}.${action.id}`, order: 60 + i * 5 + j / 100, extId, action });
      });
      (ext.manifest.contributes.homeSections ?? []).forEach((sec, j) => {
        out.push({ kind: 'homeSection', id: `ext.${extId}.${sec.id}`, order: 45 + i + j / 10, extId, sectionId: sec.id });
      });
    });
  return out;
}

/** Changes when the registered contributions must change: another account, or another enabled list. */
export function registrationSignature(account: string | null, list: readonly InstalledExtension[]): string {
  return JSON.stringify([account, list.filter((e) => e.enabled).map((e) => [e.manifest, e.grants])]);
}
