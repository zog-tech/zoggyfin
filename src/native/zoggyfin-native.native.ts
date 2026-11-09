/**
 * The local native module (modules/zoggyfin-native). Optional: an older
 * development build without it falls back to safe answers.
 */
import { requireOptionalNativeModule } from 'expo';

import type { AndroidDecoders, DecoderInfo } from '@/player/device-profile';

interface ZoggyfinNativeModule {
  isHardwareDecodeSupported(codec: string): boolean;
  excludeFromBackup?(path: string): boolean;
  /** iOS: AVFoundation passthrough export (SeekableMp4.swift). */
  makeSeekableMp4?(path: string): Promise<string>;
}

const mod = requireOptionalNativeModule<ZoggyfinNativeModule>('ZoggyfinNative');

export function isHardwareDecodeSupported(codec: 'av1' | 'hevc' | 'h264' | 'vp9'): boolean {
  try {
    return mod?.isHardwareDecodeSupported(codec) ?? codec !== 'av1';
  } catch {
    return codec !== 'av1';
  }
}

/** Keeps a download folder out of device backups. False when the build has no support for it. */
export function excludeFromBackup(path: string): boolean {
  try {
    return mod?.excludeFromBackup?.(path) ?? false;
  } catch {
    return false;
  }
}

export const hasNativeKeyInput = mod !== null;

interface ZoggyfinAndroidModule {
  decoders(): Record<string, unknown>;
  setAutoPictureInPicture(enabled: boolean): void;
  makeSeekableMp4?(path: string): Promise<string>;
}

/** The Android part of the module (decoders, Picture in Picture on Home). Null on iOS and in older builds. */
const android = requireOptionalNativeModule<ZoggyfinAndroidModule>('ZoggyfinAndroid');

function decoderInfo(v: unknown): DecoderInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && x > 0 ? x : 0);
  return {
    hardware: o.hardware === true,
    software: o.software === true,
    maxLevel: num(o.maxLevel),
    tenBit: o.tenBit === true,
    // Builds before the size report send no size: 0 means unknown, so no limit.
    maxWidth: num(o.maxWidth),
    maxHeight: num(o.maxHeight),
  };
}

/** The decoders of an Android device (MediaCodecList). Null when the build has no module. */
export function androidDecoders(): AndroidDecoders | null {
  if (!android) return null;
  try {
    const raw = android.decoders();
    const codecs: AndroidDecoders['codecs'] = {};
    for (const [key, value] of Object.entries(raw)) {
      const info = decoderInfo(value);
      if (info) codecs[key] = info;
    }
    const hdr = Array.isArray(raw.hdr) ? raw.hdr.filter((x): x is string => typeof x === 'string') : [];
    return { codecs, hdr, sdk: typeof raw.sdk === 'number' ? raw.sdk : 0 };
  } catch {
    return null;
  }
}

/**
 * Android 8 to 11: Picture in Picture starts on Home while this is true.
 * Android 12 and later use expo-video's `startsPictureInPictureAutomatically`.
 */
export function setAutoPictureInPicture(enabled: boolean): void {
  try {
    android?.setAutoPictureInPicture(enabled);
  } catch {
    // An older build: no Picture in Picture on Home.
  }
}

/**
 * Rewrites a fragmented MP4 with no index (a transcoded download) as a
 * plain MP4 with the index at the front. ExoPlayer cannot seek in the
 * fragmented one, and a nearby host shares its download with Android
 * guests. Android: MediaMuxer; iOS: AVFoundation passthrough export.
 * "skipped" when the file is not fragmented or the build has no function.
 */
export async function makeSeekableMp4(path: string): Promise<'done' | 'skipped' | 'failed'> {
  const owner = typeof android?.makeSeekableMp4 === 'function' ? android : typeof mod?.makeSeekableMp4 === 'function' ? mod : null;
  const fn = owner?.makeSeekableMp4;
  if (!owner || typeof fn !== 'function') return 'skipped';
  try {
    const r = await fn.call(owner, path);
    return r === 'done' || r === 'failed' ? r : 'skipped';
  } catch {
    return 'failed';
  }
}
