/**
 * The over-the-air update this app runs. The native version stays the same
 * after an update, so the update ID tells which code a device really runs.
 */
import * as Updates from 'expo-updates';

export interface OtaInfo {
  /** The first 8 characters of the update ID. */
  id: string;
  createdAt: Date | null;
}

/** The running update, or null for the code in the build (and on web and in development). */
export function runningOta(): OtaInfo | null {
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.updateId) return null;
  return { id: Updates.updateId.slice(0, 8), createdAt: Updates.createdAt ?? null };
}

/** The runtime version of this binary (the OTA updates it can take), or null on the web and in development. */
export function runtimeVersionNow(): string | null {
  try {
    return Updates.runtimeVersion ?? null;
  } catch {
    return null;
  }
}

/** The version for the server: `0.1.0+c66a06bb` when an update runs. Pure. */
export function versionWithOta(version: string, ota: OtaInfo | null): string {
  return ota ? `${version}+${ota.id}` : version;
}

/** The update for the Settings row: `Update c66a06bb, 20 Oct`. Pure. */
export function otaLabel(ota: OtaInfo | null): string | null {
  if (!ota) return null;
  const date = ota.createdAt ? ota.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  return date ? `Update ${ota.id}, ${date}` : `Update ${ota.id}`;
}
