/**
 * Applies "Sound plays on" (speaker.ts) to this device's audio player: while
 * another device plays the session's sound, the audio engine's volume is 0.
 * It follows the together store, so the volume comes back by itself when
 * the session ends, the device leaves, or the host picks every device again.
 */
import { audioSession } from '@/player/audio/session';

import { muteSession } from './speaker';
import { togetherState, useTogetherStore } from './store';

let unsub: (() => void) | null = null;

/** Starts once (the nearby controller calls it). */
export function watchSpeakerOutput(): void {
  if (unsub) return;
  let muted = false;
  const apply = () => {
    const next = muteSession(togetherState());
    if (next === muted) return;
    muted = next;
    audioSession().setGroupMuted(next);
  };
  unsub = useTogetherStore.subscribe(apply);
  apply();
}
