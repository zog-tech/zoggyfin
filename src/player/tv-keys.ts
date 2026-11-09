/**
 * TV remote keys in the video player. Pure: no React, so it is unit-tested.
 *
 * With the controls shown, a single Left or Right press keeps its normal job
 * (the focus engine moves the focus), and a second press of the same key
 * within DOUBLE_PRESS_MS also seeks 10 s. With the controls hidden, Left,
 * Right, rewind and fast forward go through tap seek (tap-seek.ts) instead.
 */

/** Two presses of the same key closer than this are a double press (ms). */
export const DOUBLE_PRESS_MS = 400;

/** How far a double Left or Right seeks (s). */
export const DOUBLE_PRESS_SEEK = 10;

/** The remote keys the player knows. */
export type TvKey =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'select'
  | 'playPause'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'fastForward'
  | 'back'
  /** The remote's channel keys (Android TV remotes that have them). */
  | 'channelUp'
  | 'channelDown';

const TV_EVENT_KEYS: Record<string, TvKey> = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  select: 'select',
  playPause: 'playPause',
  play: 'play',
  pause: 'pause',
  rewind: 'rewind',
  fastForward: 'fastForward',
  channelUp: 'channelUp',
  channelDown: 'channelDown',
  // The media Next and Previous keys zap in Live TV; video has no job for them here.
  next: 'channelUp',
  previous: 'channelDown',
};

const TV_LONG_KEYS: Record<string, TvKey> = {
  longLeft: 'left',
  longRight: 'right',
  longUp: 'up',
  longDown: 'down',
  longSelect: 'select',
  longPlayPause: 'playPause',
  longRewind: 'rewind',
  longFastForward: 'fastForward',
};

/** A press of a key, or the start or end of a held key. */
export interface TvKeyEvent {
  key: TvKey;
  phase: 'press' | 'holdStart' | 'holdEnd';
}

/**
 * A react-native-tvos remote event as a key press or hold.
 *
 * Android TV (ReactAndroidHWInputDeviceHelper) sends a press as its key-up
 * (eventKeyAction 1); key-downs come only behind a feature flag, so a
 * key-down is not counted (no double count when the flag is on). A key held
 * over 300 ms sends one `longLeft` (etc.) key-down and, on release, a
 * `longLeft` key-up, and no plain event. tvOS sends one event (action -1).
 */
export function tvKeyFromEvent(e: { eventType?: string; eventKeyAction?: number | string | null }): TvKeyEvent | null {
  const action = e.eventKeyAction === null || e.eventKeyAction === undefined ? -1 : Number(e.eventKeyAction);
  const type = e.eventType ?? '';
  const held = TV_LONG_KEYS[type];
  if (held) return { key: held, phase: action === 1 ? 'holdEnd' : 'holdStart' };
  const key = TV_EVENT_KEYS[type];
  if (!key || action === 0) return null;
  return { key, phase: 'press' };
}

const WEB_KEYS: Record<string, TvKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'playPause',
  k: 'playPause',
  Escape: 'back',
  PageUp: 'channelUp',
  PageDown: 'channelDown',
};

/** The key of a keyboard press in the web TV preview. */
export function tvKeyFromWeb(key: string): TvKey | null {
  return WEB_KEYS[key] ?? null;
}

/** The last press that has not been paired yet. */
export interface PressMemory {
  key: string | null;
  at: number;
}

export const NO_PRESS: PressMemory = { key: null, at: 0 };

/**
 * Records a press. `double` is true when it pairs with the previous press of
 * the same key; the pair is then used up, so a third press starts a new pair.
 */
export function registerPress(
  prev: PressMemory,
  key: string,
  now: number,
  windowMs: number = DOUBLE_PRESS_MS,
): { double: boolean; memory: PressMemory } {
  const gap = now - prev.at;
  if (prev.key === key && gap >= 0 && gap <= windowMs) return { double: true, memory: NO_PRESS };
  return { double: false, memory: { key, at: now } };
}

/** A small stateful wrapper around registerPress. */
export function createDoublePress(windowMs: number = DOUBLE_PRESS_MS) {
  let memory = NO_PRESS;
  return {
    press(key: string, now: number = Date.now()): boolean {
      const r = registerPress(memory, key, now, windowMs);
      memory = r.memory;
      return r.double;
    },
    reset(): void {
      memory = NO_PRESS;
    },
  };
}

export type PlayerKeyAction =
  | { type: 'seek'; seconds: number }
  | { type: 'skip'; direction: 'back' | 'forward' }
  | { type: 'togglePlay' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'close' }
  | { type: 'wake' }
  | { type: 'none' };

/**
 * What a remote key does in the player. Select is left to the focused
 * control (a button, or the full-screen layer while the controls are hidden).
 */
export function playerKeyAction(key: TvKey, double: boolean): PlayerKeyAction {
  switch (key) {
    case 'left':
      return double ? { type: 'seek', seconds: -DOUBLE_PRESS_SEEK } : { type: 'wake' };
    case 'right':
      return double ? { type: 'seek', seconds: DOUBLE_PRESS_SEEK } : { type: 'wake' };
    case 'up':
    case 'down':
      return { type: 'wake' };
    case 'playPause':
      return { type: 'togglePlay' };
    case 'play':
      return { type: 'play' };
    case 'pause':
      return { type: 'pause' };
    case 'rewind':
      return { type: 'skip', direction: 'back' };
    case 'fastForward':
      return { type: 'skip', direction: 'forward' };
    case 'back':
      return { type: 'close' };
    case 'select':
    case 'channelUp':
    case 'channelDown':
      return { type: 'none' };
  }
}

/** What holds the TV focus in the video player. */
export type PlayerFocusOwner =
  /** The full-screen layer: Select plays or pauses (controls hidden, no prompt). */
  | 'layer'
  /** Skip Intro or Up Next: Select skips or plays the next episode. */
  | 'prompt'
  /** The controls (Play, the seek bar, the top row) or the error card. */
  | 'controls';

/**
 * Who takes the focus. With the controls hidden, a prompt (Skip Intro, Up
 * Next) takes it, so one Select uses it; else the full-screen layer does.
 * The remote keys still reach the player (useTvRemote), so Left and Right
 * keep seeking and Down still shows the controls. When the controls show,
 * a prompt that has the focus keeps it: the controls do not pull it to Play.
 */
export function playerFocusOwner(s: { controlsVisible: boolean; promptShown: boolean; promptFocused: boolean; error: boolean }): PlayerFocusOwner {
  if (s.error) return 'controls';
  if (!s.controlsVisible) return s.promptShown ? 'prompt' : 'layer';
  return s.promptShown && s.promptFocused ? 'prompt' : 'controls';
}

export type LiveKeyAction =
  | { type: 'zap'; delta: 1 | -1 }
  /** Show the controls (a live stream has nothing to seek). */
  | { type: 'wake' }
  /** Leave the channel card for the buttons above it. */
  | { type: 'toButtons' }
  | null;

/**
 * Where the TV focus is in the live player, for the zap keys.
 * - `hidden`: the controls are hidden.
 * - `card`: the controls show and the channel card (the LIVE row) has the focus.
 * - `video`: the controls show and no control has the focus.
 * - `buttons`: a button of the top or the centre row has the focus.
 */
export type LiveFocus = 'hidden' | 'card' | 'video' | 'buttons';

/**
 * Live TV keys, checked before the video keys (TiviMate style). The channel
 * keys always zap. Up is the next channel (like CH+) and Down the one
 * before, while the controls are hidden, on the channel card, or with no
 * control focused; on a button they move the focus. Left and Right leave the
 * card for the buttons, and elsewhere show the controls. Null: the key keeps
 * its video job (Select, Back, play and pause). A sheet (the channel list)
 * gets no keys here: the player stops listening while one is open.
 */
export function liveKeyAction(key: TvKey, focus: LiveFocus): LiveKeyAction {
  if (key === 'channelUp') return { type: 'zap', delta: 1 };
  if (key === 'channelDown') return { type: 'zap', delta: -1 };
  const zaps = focus !== 'buttons';
  if (zaps && key === 'up') return { type: 'zap', delta: 1 };
  if (zaps && key === 'down') return { type: 'zap', delta: -1 };
  if (focus === 'card' && (key === 'left' || key === 'right')) return { type: 'toButtons' };
  if (key === 'left' || key === 'right' || key === 'rewind' || key === 'fastForward') return { type: 'wake' };
  return null;
}

/** The seek feedback ("−20 s"): presses on the same side add up while it shows. */
export interface SeekFeedback {
  side: 'left' | 'right';
  seconds: number;
  key: number;
}

export function stackFeedback(prev: SeekFeedback | null, side: 'left' | 'right', seconds: number): SeekFeedback {
  const step = Math.abs(seconds);
  return {
    side,
    seconds: prev && prev.side === side ? prev.seconds + step : step,
    key: (prev?.key ?? 0) + 1,
  };
}

// ---------------------------------------------------------------------------
// Scrubbing with the remote (the seek bar has the focus)
// ---------------------------------------------------------------------------

/** The scrub seeks this long after the last Left or Right press (ms). Select seeks at once. */
export const SCRUB_COMMIT_MS = 800;

/** Presses closer than this (ms) in the same direction are one run (a held key). */
export const SCRUB_RUN_MS = 600;

/** At most one step per this long (ms), whatever the remote's key-repeat rate: about 7 a second. */
export const SCRUB_MIN_GAP_MS = 140;

/** A run of Left or Right presses on the seek bar (a held key repeats). */
export interface ScrubRun {
  dir: -1 | 0 | 1;
  /** When the run began (ms). */
  start: number;
  /** The last press (ms). */
  at: number;
  /** The last press that moved the target (ms). */
  applied: number;
}

export const NO_RUN: ScrubRun = { dir: 0, start: 0, at: 0, applied: 0 };

/** The step for a key held this long (ms): 10 s for 1.5 s, then 30 s, and 60 s after 4 s. A tap is 10 s. */
export function scrubStep(heldMs: number): number {
  if (heldMs < 1500) return 10;
  if (heldMs < 4000) return 30;
  return 60;
}

/** Records a press. `apply` is false for a repeat that comes too soon after the last step. */
export function nextRun(run: ScrubRun, dir: -1 | 1, now: number): { run: ScrubRun; apply: boolean } {
  const same = run.dir === dir && now - run.at >= 0 && now - run.at <= SCRUB_RUN_MS;
  if (!same) return { run: { dir, start: now, at: now, applied: now }, apply: true };
  const apply = now - run.applied >= SCRUB_MIN_GAP_MS;
  return { run: { dir, start: run.start, at: now, applied: apply ? now : run.applied }, apply };
}

/** The new scrub target: one step of the run from `from`, inside the video. */
export function scrubTarget(from: number, run: ScrubRun, duration: number): number {
  const to = from + run.dir * scrubStep(run.at - run.start);
  return Math.min(Math.max(0, to), duration > 0 ? duration : to);
}
