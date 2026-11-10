/**
 * The app-level player interface. Screens call `usePlayer().play(...)` and
 * never talk to an engine. Video plays through expo-video (native) or an
 * HTML video element (web), behind `session.ts`; audio plays through
 * expo-audio behind `audio/session.ts`. One of them plays at a time.
 *
 * Extension media (a feed entry's or a detail reply's `media` reference):
 *
 *   playMedia(request: MediaPlayRequest): void
 *   usePlayer().playMedia(request)
 *
 *   interface MediaPlayRequest {
 *     extension: string;     // the manifest id
 *     mediaId: string;       // media.id
 *     playback: string;      // media.playback (a full URL on the extension's origin)
 *     title?: string; subtitle?: string; image?: string;  // what the card showed
 *     duration?: number;     // media.duration, seconds
 *     startSeconds?: number; // left out: the description's resume; 0 starts over
 *   }
 *
 * From a feed entry: `playMedia({ extension: ext.manifest.id, mediaId:
 * entry.media.id, playback: entry.media.playback, title: entry.title,
 * subtitle: entry.subtitle, image: entry.imageUrl, duration:
 * entry.media.duration })`. It refuses in a watch-together session and says
 * why in a toast, like IPTV films. It opens the video player.
 */
import { router } from 'expo-router';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { toast } from '@/lib/toast';

import { audioSession } from './audio/session';
import { controlGate } from './control-gate';
import { playRouter } from './play-router';
import { videoSession } from './session';
import { playerState, setPlayerState } from './store';
import type { ExternalPlayRequest, LivePlayRequest, MediaPlayRequest, PlayerController, PlayRequest } from './types';

export type {
  ExternalPlayRequest,
  ExternalProgress,
  ExternalQuality,
  ExternalRef,
  ExternalReportEvent,
  ExternalReportSnapshot,
  ExternalSegment,
  ExternalSource,
  ExternalStream,
  ExternalSubtitle,
  LiveChannelRef,
  LiveNowNext,
  LivePlayRequest,
  LiveProgramme,
  LiveSource,
  LiveStreamChoice,
  MediaPlayRequest,
  PlayerController,
  PlayRequest,
  SkipMode,
  VodPlayRequest,
  VodRef,
  VodSource,
} from './types';
export { usePlayerStore } from './store';
export { playRouter } from './play-router';

const AUDIO_TYPES = new Set(['Audio', 'AudioBook', 'MusicAlbum', 'MusicArtist', 'MusicGenre']);

export function isAudioItem(item: BaseItemDto): boolean {
  if (item.Type === 'Playlist') return item.MediaType === 'Audio';
  return AUDIO_TYPES.has(item.Type ?? '') || item.MediaType === 'Audio';
}

/** Opens the full player for what plays now: the music player for audio, the video player for video. */
export function openFullPlayer(): void {
  if (playerState().presentation !== 'full') setPlayerState({ presentation: 'full' });
  router.navigate(playerState().now?.kind === 'audio' ? '/now-playing' : '/player');
}

/** Transport for whatever plays now (mini player, keyboard shortcuts). */
export const activePlayback = {
  togglePlay(): void {
    if (playerState().now?.kind === 'audio') audioSession().togglePlay();
    else videoSession().togglePlay();
  },
  stop(): void {
    if (playerState().now?.kind === 'audio') void audioSession().stop();
    else void videoSession().stop();
  },
  next(): void {
    if (playerState().now?.kind === 'audio') audioSession().next();
    else void videoSession().playNext();
  },
  previous(): void {
    if (playerState().now?.kind === 'audio') audioSession().previous();
    else if (playerState().now?.live) videoSession().zap(-1);
  },
  skip(seconds: number): void {
    if (playerState().now?.kind === 'audio') audioSession().skip(seconds);
    else videoSession().skip(seconds);
  },
};

/**
 * Audio takes over from video: the video stops, and its full-screen player
 * closes first. Else the video player stays under the music player (both are
 * modal routes): its surface keeps the last frame (libmpv on the Mac does not
 * draw again after a stop), and Back shows an empty video player.
 */
export async function stopVideoForAudio(): Promise<void> {
  const st = playerState();
  if (st.now?.kind !== 'video') return;
  if (st.presentation === 'full') {
    // Once only: a second call (or the together code's own leave) before the route goes does nothing.
    setPlayerState({ presentation: 'hidden' });
    if (router.canGoBack()) router.back();
    else router.replace(useSessionStore.getState().session ? '/' : '/sign-in');
  }
  await videoSession().stop();
}

/**
 * Plays a request on this device, with no together routing. The together
 * host uses it for a guest's pick; screens use `usePlayer().play`.
 */
export function playHere(request: PlayRequest): void {
  if (isAudioItem(request.item)) {
    void (async () => {
      await stopVideoForAudio();
      await audioSession().play(request);
    })();
    return;
  }
  void (async () => {
    if (playerState().now?.kind === 'audio') await audioSession().stopForVideo();
    await videoSession().play(request);
  })();
  router.navigate('/player');
}

/**
 * Plays a live channel here. Live TV is not shared in a together session:
 * the group keeps one timeline, and a live stream has none to share.
 */
function playLiveHere(request: LivePlayRequest): void {
  if (playRouter.active || controlGate.active) {
    toast('Live TV does not play in a watch-together session. Leave the session first.', { icon: 'person.2.slash' });
    return;
  }
  void (async () => {
    if (playerState().now?.kind === 'audio') await audioSession().stopForVideo();
    await videoSession().playLive(request);
  })();
  router.navigate('/player');
}

/** True while a watch-together session runs: external titles do not play then. */
function inTogether(): boolean {
  return playRouter.active || controlGate.active;
}

/** Plays an external title (IPTV, extension media) here in the video player. */
function playExternalHere(request: ExternalPlayRequest): void {
  void (async () => {
    if (playerState().now?.kind === 'audio') await audioSession().stopForVideo();
    await videoSession().playExternal(request);
  })();
  router.navigate('/player');
}

/**
 * Plays an IPTV film or episode here. Not shared in a together session: the
 * other members have no access to this device's provider.
 */
function playVodHere(request: ExternalPlayRequest): void {
  if (inTogether()) {
    toast('IPTV films and series do not play in a watch-together session. Leave the session first.', { icon: 'person.2.slash' });
    return;
  }
  playExternalHere(request);
}

/**
 * Plays an extension's media here (see the top of this file). Not shared in
 * a together session: the other members may not have the extension.
 * `kind: "audio"` plays here too, with no picture.
 */
export function playMedia(request: MediaPlayRequest): void {
  if (inTogether()) {
    toast('Extension media does not play in a watch-together session. Leave the session first.', { icon: 'person.2.slash' });
    return;
  }
  // Loaded on first use: the player does not load the extension runtime (and its storage) before.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extensionPlayRequest } = require('@/extensions/media/play') as typeof import('@/extensions/media/play');
  const r = extensionPlayRequest(request);
  if ('error' in r) {
    toast(r.error, { icon: 'exclamationmark.triangle' });
    return;
  }
  playExternalHere(r.request);
}

/** True when a together session lets this device change its queue; else says why. */
function queueAllowed(): boolean {
  const lock = playRouter.queueLock();
  if (lock) toast(lock, { icon: 'lock.fill' });
  return !lock;
}

const controller: PlayerController = {
  available: true,
  play(request) {
    // In a together session the session decides first (play-router.ts).
    const routed = playRouter.route(request, 'user');
    if (routed) playHere(routed);
  },
  playLive(request) {
    playLiveHere(request);
  },
  playVod(request) {
    playVodHere(request);
  },
  playMedia(request) {
    playMedia(request);
  },
  playNext(item) {
    if (queueAllowed()) void audioSession().playNext(item);
  },
  addToQueue(item) {
    if (queueAllowed()) void audioSession().addToQueue(item);
  },
  instantMix(item) {
    if (queueAllowed()) void audioSession().instantMix(item);
  },
};

export function usePlayer(): PlayerController {
  return controller;
}
