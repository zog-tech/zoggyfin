import { Platform } from 'react-native';

import { useTvRemote } from '@/features/tv/use-tv-remote';
import { KeyInput } from '@/native/key-input';
import type { KeyPress } from '@/native/key-input-types';
import { activePlayback } from '@/player';
import { audioSession } from '@/player/audio/session';
import { audioState } from '@/player/audio/store';
import { usePlayerStore } from '@/player/store';
import { musicKeyAction, tvKeyFromEvent } from '@/player/tv-keys';

const hidden = { position: 'absolute', width: 0, height: 0 } as const;

/**
 * Web: Space plays or pauses and ←/→ seek while something plays and no full
 * player is open (the full players have their own keys). Shift+←/→ skip
 * tracks. Text fields keep their keys.
 */
export function GlobalPlayerKeys() {
  const active = usePlayerStore((s) => !!s.now && s.presentation !== 'full');
  if (Platform.OS !== 'web' || !active) return null;
  const onKey = (k: KeyPress) => {
    const long = audioState().longForm;
    switch (k.key) {
      case ' ':
      case 'k':
        activePlayback.togglePlay();
        break;
      case 'ArrowLeft':
        if (k.shift) activePlayback.previous();
        else activePlayback.skip(long ? -15 : -10);
        break;
      case 'ArrowRight':
        if (k.shift) activePlayback.next();
        else activePlayback.skip(long ? 30 : 10);
        break;
    }
  };
  return <KeyInput onKey={onKey} style={hidden} />;
}

/**
 * TV: the remote's rewind and fast forward while music is the current player, on
 * any screen (the music player too): Previous and Next, or a jump in an audiobook
 * (`musicKeyAction`). The video player has its own keys. A no-op off TV.
 */
export function TvMusicKeys() {
  const audio = usePlayerStore((s) => s.now?.kind === 'audio');
  useTvRemote(audio, (e) => {
    const ev = tvKeyFromEvent(e);
    const action = ev ? musicKeyAction(ev, audioState().longForm) : null;
    if (!action) return;
    if (action.type === 'previous') audioSession().previous();
    else if (action.type === 'next') audioSession().next();
    else audioSession().skip(action.seconds);
  });
  return null;
}
