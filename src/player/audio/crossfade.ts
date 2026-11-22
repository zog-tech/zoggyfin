/**
 * "Fade between songs": the volume falls over the last seconds of a song and
 * rises over the first seconds of the next one.
 *
 * The music engine (one expo-audio playlist) plays one track at a time, so
 * two songs cannot overlap. A true crossfade needs a second player. This
 * fade gives a soft change between songs with the engine as it is, and it
 * keeps gapless play.
 *
 * - No fade between two songs that follow each other on the same album
 *   (a live album or a DJ mix must stay seamless).
 * - No fade for long-form items, with Repeat one, or in a together session.
 * - A fade is at most a quarter of the song, so a short song keeps its middle.
 * - The curve is equal-power (a sine), which sounds even to the ear.
 *
 * Pure, so it is unit-tested.
 */

/** The choices in Settings, in seconds. 0 is Off. */
export const FADE_CHOICES: readonly number[] = [0, 2, 4, 6, 8, 10, 12];

export interface FadeTrack {
  AlbumId?: string | null;
  IndexNumber?: number | null;
  ParentIndexNumber?: number | null;
}

/** True when `next` is the song after `prev` on the same album (the next track, or track 1 of the next disc). */
export function continuousAlbum(prev: FadeTrack, next: FadeTrack): boolean {
  if (!prev.AlbumId || prev.AlbumId !== next.AlbumId) return false;
  const a = prev.IndexNumber;
  const b = next.IndexNumber;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  const discA = prev.ParentIndexNumber ?? 1;
  const discB = next.ParentIndexNumber ?? 1;
  return (discA === discB && b === a + 1) || (discB === discA + 1 && b === 1);
}

export interface FadeConditions {
  seconds: number;
  longForm: boolean;
  repeatOne: boolean;
  together: boolean;
}

/** True when the change from `prev` to `next` fades. */
export function fadeBetween(prev: FadeTrack | null, next: FadeTrack | null, c: FadeConditions): boolean {
  if (c.seconds <= 0 || c.longForm || c.repeatOne || c.together || !prev || !next) return false;
  return !continuousAlbum(prev, next);
}

export interface FadePoint {
  /** Seconds into the song. */
  position: number;
  /** The song's length in seconds (0 when not known yet). */
  duration: number;
  seconds: number;
  /** The song fades in at its start (it came after a fade-out). */
  fadeIn: boolean;
  /** The song fades out at its end. */
  fadeOut: boolean;
}

/** The fade's share of the volume now, 0–1. */
export function fadeGain(p: FadePoint): number {
  if (p.seconds <= 0) return 1;
  const len = p.duration > 0 ? Math.min(p.seconds, p.duration / 4) : p.seconds;
  if (len <= 0) return 1;
  let x = 1;
  if (p.fadeIn) x = Math.min(x, Math.max(0, p.position) / len);
  if (p.fadeOut && p.duration > 0) x = Math.min(x, Math.max(0, p.duration - p.position) / len);
  return x >= 1 ? 1 : Math.sin((Math.max(0, x) * Math.PI) / 2);
}

/** True while the song is inside a fade window, so the volume needs fine steps. */
export function inFadeWindow(p: FadePoint): boolean {
  return fadeGain(p) < 1 || (p.fadeOut && p.duration > 0 && p.duration - p.position <= Math.min(p.seconds, p.duration / 4) + 1);
}

/** The Settings label for a choice. */
export function fadeLabel(seconds: number): string {
  return seconds > 0 ? `${seconds} s` : 'Off';
}
