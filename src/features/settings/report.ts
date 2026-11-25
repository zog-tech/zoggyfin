/**
 * "Report a problem": the header facts of a report, from what the device
 * says. The report itself is `buildReport` in `lib/diag-log.ts`. Nothing
 * here names a server, an account or a song. Pure, so it is unit-tested.
 */
import type { ReportInfo } from '@/lib/diag-log';

export interface DeviceFacts {
  /** `Platform.OS`. */
  os: string;
  /** `Platform.Version` (a number on Android, a string on iOS, absent on the web). */
  osVersion: string | number | null | undefined;
  tv: boolean;
  /** The Mac app (the web build inside Tauri). */
  desktop: boolean;
  /** The Mac app's own version, when it runs. */
  desktopVersion: string | null;
  nativeVersion: string | null;
  nativeBuild: string | null;
  /** The JS version from `app.json`, when the binary gives none. */
  fallbackVersion: string;
  updateId: string | null;
  runtimeVersion: string | null;
  lite: boolean;
}

/** `ios`, `android tv`, `macos app` or `web`. */
export function platformLabel(f: Pick<DeviceFacts, 'os' | 'tv' | 'desktop'>): string {
  if (f.desktop) return 'macos app';
  return f.tv ? `${f.os} tv` : f.os;
}

/** `0.1.1 (22)`, or the Mac app's version. */
export function versionLabel(f: Pick<DeviceFacts, 'desktopVersion' | 'nativeVersion' | 'nativeBuild' | 'fallbackVersion'>): string {
  if (f.desktopVersion) return f.desktopVersion;
  const v = f.nativeVersion ?? f.fallbackVersion;
  return f.nativeBuild ? `${v} (${f.nativeBuild})` : v;
}

export function reportInfo(f: DeviceFacts, now: number): ReportInfo {
  return {
    appVersion: versionLabel(f),
    updateId: f.updateId,
    runtimeVersion: f.runtimeVersion,
    platform: platformLabel(f),
    osVersion: f.osVersion === null || f.osVersion === undefined ? '' : String(f.osVersion),
    lite: f.lite,
    now,
  };
}
