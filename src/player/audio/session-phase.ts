/**
 * Whether the audio session can still give sound (iOS). Another app (the
 * camera, a call) can interrupt the session: expo-audio pauses the player and
 * marks the session inactive. When the other app sends no "interruption
 * ended", nothing activates the session again, and a later play shows
 * "playing" with no sound. The engine watches for a pause that it did not ask
 * for ('lost') and activates the session again before the next play.
 *
 * Pure, so it is unit-tested. Like the other state machines, `transition`
 * returns the same value when an event does not apply.
 */

export type SessionPhase =
  /** Paused, stopped or not loaded, by the app's own choice. */
  | 'idle'
  /** The app asked to play. */
  | 'playing'
  /** The player stopped while the app wanted it to play: an interruption or a remote pause. */
  | 'lost';

export type SessionEvent =
  | { type: 'play' }
  | { type: 'pause' }
  /** A status from the player. `finished`: the last track ended. */
  | { type: 'status'; playing: boolean; buffering: boolean; loaded: boolean; finished: boolean }
  /** The engine set the audio mode and activated the session again. */
  | { type: 'restored' };

export function transition(phase: SessionPhase, e: SessionEvent): SessionPhase {
  switch (e.type) {
    case 'play':
      return phase === 'playing' ? phase : 'playing';
    case 'pause':
      // A pause keeps 'lost': the next play must still activate the session.
      return phase === 'playing' ? 'idle' : phase;
    case 'restored':
      return phase === 'lost' ? 'idle' : phase;
    case 'status':
      if (phase === 'playing') {
        if (e.finished) return 'idle';
        // A buffering player waits for data; a player that is not loaded is between tracks.
        if (!e.playing && !e.buffering && e.loaded) return 'lost';
        return phase;
      }
      // The player plays again by itself (lock screen, headset, end of the interruption).
      if (phase === 'lost' && e.playing) return 'playing';
      return phase;
  }
}

/** True when the player started again by itself after the session was lost: activate it and play once more. */
export function resumedByItself(prev: SessionPhase, next: SessionPhase): boolean {
  return prev === 'lost' && next === 'playing';
}
