/**
 * iOS and Android: the app draws Jellyfin text subtitles itself
 * (`SubtitleOverlay`). Subtitles inside an HLS stream (Live TV, IPTV films)
 * are drawn by AVPlayer or ExoPlayer with the system caption settings;
 * expo-video has no API to style them, so there is nothing to apply here.
 */
import type { SubtitleAppearance } from '@/settings/subtitle-style';

export function applyEngineSubtitleStyle(_a: SubtitleAppearance): void {}
