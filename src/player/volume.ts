/**
 * The app's own volume on pointer platforms (the web and the Mac app): one
 * level for music and video, with a mute switch. Phones and TVs use the
 * hardware volume and never change it, so their gain stays 1.
 *
 * The level is where the slider sits (0 to 1). Ears hear loudness on a log
 * scale, so the players get it on a cubic curve: libmpv applies that curve
 * to its `volume` property itself (`mpvVolume`), and HTML media elements
 * get `elementGain`, so a level sounds the same in music and in video.
 *
 * Pure, so it is unit-tested.
 */
import type { IconName } from '@/components/icon';

export interface VolumeState {
  /** Where the slider sits, 0 to 1. */
  level: number;
  muted: boolean;
}

export const DEFAULT_VOLUME: VolumeState = { level: 1, muted: false };

/** One key press (Up or Down in the video player): 5 %. */
export const VOLUME_STEP = 0.05;

/** Unmute at a level of 0 brings the sound back here, not at silence. */
export const UNMUTE_LEVEL = 0.5;

/** The saved shape's version (`settings/volume.ts`). */
export const VOLUME_VERSION = 1;

/** 0 to 1, in steps of 1 %. A value that is not a number is full volume, never a surprise silence. */
export function clampVolume(level: number): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 1;
  return Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
}

/** A new level from the slider. A move up unmutes; a move to 0 keeps the mute as it is. */
export function withLevel(state: VolumeState, level: number): VolumeState {
  const next = clampVolume(level);
  const muted = next > 0 ? false : state.muted;
  if (next === state.level && muted === state.muted) return state;
  return { level: next, muted };
}

/** `steps` key presses up (positive) or down. Up from mute starts at the muted level. */
export function stepVolume(state: VolumeState, steps: number): VolumeState {
  return withLevel(state, state.level + steps * VOLUME_STEP);
}

/** The speaker button: mute, or unmute. Unmute at level 0 goes to `UNMUTE_LEVEL`. */
export function toggleMute(state: VolumeState): VolumeState {
  if (state.muted || state.level === 0) return { level: state.level > 0 ? state.level : UNMUTE_LEVEL, muted: false };
  return { ...state, muted: true };
}

/** The level that plays: 0 when muted. */
export function audibleLevel(state: VolumeState): number {
  return state.muted ? 0 : clampVolume(state.level);
}

/**
 * The mute and volume a progress report carries (the remote controller reads
 * them). With the app's own volume (`app`): its switch and level, 0 to 100.
 * Without it (phones, TVs): the player's mute, and no level, since the
 * hardware volume is not the app's to report.
 */
export function reportedVolume(app: VolumeState | null, playerMuted: boolean): { isMuted: boolean; volumeLevel: number | null } {
  if (!app) return { isMuted: playerMuted, volumeLevel: null };
  return { isMuted: playerMuted || audibleLevel(app) === 0, volumeLevel: Math.round(clampVolume(app.level) * 100) };
}

/** The gain of an HTML media element (`volume`, linear amplitude) for a level: the cubic curve. */
export function elementGain(level: number): number {
  const l = clampVolume(level);
  return l * l * l;
}

/** libmpv's `volume` property (0 to 100) for a level. libmpv applies the cubic curve itself. */
export function mpvVolume(level: number): number {
  return Math.round(clampVolume(level) * 100);
}

/**
 * The volume the music engine gets: the product of every share. A share of 0
 * (group mute) silences it; crossfade gains apply in the mixer on top.
 */
export function volumeProduct(...shares: number[]): number {
  let out = 1;
  for (const s of shares) out *= Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 1;
  return out;
}

export type VolumeIcon = Extract<IconName, 'speaker.slash.fill' | 'speaker.wave.1.fill' | 'speaker.wave.2.fill' | 'speaker.wave.3.fill'>;

/** The speaker glyph for the state: a slash when silent, then one to three waves. */
export function volumeIcon(state: VolumeState): VolumeIcon {
  const l = audibleLevel(state);
  if (l === 0) return 'speaker.slash.fill';
  if (l < 0.34) return 'speaker.wave.1.fill';
  if (l < 0.67) return 'speaker.wave.2.fill';
  return 'speaker.wave.3.fill';
}

/** What a screen reader says for the slider. */
export function volumeText(state: VolumeState): string {
  return state.muted ? 'Muted' : `${Math.round(clampVolume(state.level) * 100)} percent`;
}

/** The saved value over the default. A bad or older shape gets the default fields. Never throws. */
export function readVolume(saved: unknown): VolumeState {
  if (!saved || typeof saved !== 'object') return DEFAULT_VOLUME;
  const rec = saved as Record<string, unknown>;
  if (rec.version !== VOLUME_VERSION) return DEFAULT_VOLUME;
  return {
    level: typeof rec.level === 'number' ? clampVolume(rec.level) : DEFAULT_VOLUME.level,
    muted: typeof rec.muted === 'boolean' ? rec.muted : DEFAULT_VOLUME.muted,
  };
}

/** The shape to save. */
export function savedVolume(state: VolumeState): { version: number; level: number; muted: boolean } {
  return { version: VOLUME_VERSION, level: clampVolume(state.level), muted: state.muted };
}
