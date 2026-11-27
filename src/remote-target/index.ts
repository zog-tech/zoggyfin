/**
 * Remote control target: a TV, the Mac app or a desktop browser that
 * another client of the same user controls through the Jellyfin server
 * (Zoggyfin's "Play on…" and Remote screen on a phone, or the Jellyfin web
 * client). The rules are in `rules.ts`; this file does the I/O.
 *
 * - While signed in, it listens on the server socket for `Play`,
 *   `Playstate` and `GeneralCommand`. The subscription keeps the socket
 *   open, so the session stays in the controllers' lists. A sign-out or an
 *   account switch ends it.
 * - It posts the capabilities on sign-in, account switch, app foreground,
 *   when the server answers again and each time the socket (re)connects (a
 *   new socket can be a new server session, with no capabilities).
 * - Commands go to the app-level player (`@/player`), never to an engine,
 *   through the same paths as a local press: the play router (a together
 *   session may take a Play) and the control gate apply.
 * - A Play fetches its items first. It takes a token, so a second Play (or
 *   an account switch) makes the first one stale.
 * - The player log gets each command's name and short ids only.
 *
 * Phones and tablets never start it (`targetSupport`).
 */
import { AppState, Platform } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { useSessionStore } from '@/auth/session-store';
import { createGate, createSerialRunner } from '@/lib/async-gate';
import { shortId } from '@/lib/diag-log';
import { diag } from '@/lib/diag-store';
import { useOnlineStore } from '@/lib/online';
import { toast } from '@/lib/toast';
import { isDesktop } from '@/platform/desktop';
import { features, isNativeTV, isTVPreview } from '@/platform/tv';
import { activePlayback, isAudioItem, playerController, queueHere } from '@/player';
import { playerState } from '@/player/store';
import { setAppMuted, setVolumeLevel, stepAppVolume, toggleAppMute, useVolume } from '@/settings/volume';

import {
  actionName,
  allowedBy,
  capabilitiesFor,
  orderByIds,
  parseMessage,
  playPlan,
  type RemoteAction,
  targetSupport,
  TICKS_PER_SECOND,
  type TargetSupport,
} from './rules';

/** A volume change from the slider or a remote reaches the server this long after the last move. */
const VOLUME_REPORT_MS = 500;

function touchOnlyBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return !window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** What this device can do as a target, or null on a phone or tablet. */
export function remoteTargetSupport(): TargetSupport | null {
  return targetSupport({
    nativeTV: isNativeTV,
    web: Platform.OS === 'web',
    tvPreview: isTVPreview,
    desktop: isDesktop,
    touchOnly: touchOnlyBrowser(),
    inAppVolume: features.inAppVolume,
  });
}

interface Attached {
  /** The session's token: a new one is another account (or a new sign-in). */
  token: string;
  userId: string;
  api: ReturnType<typeof getApi>;
  unsubscribe: () => void;
  offOpen: () => void;
}

let started = false;
let support: TargetSupport | null = null;
let attached: Attached | null = null;
const playGate = createGate();

const announce = createSerialRunner(async () => {
  const a = attached;
  if (!a || !support) return;
  try {
    // Native TVs and the Mac app keep their device Id; a browser's may be cleared.
    await jf.postCapabilities(a.api, capabilitiesFor(support, Platform.OS !== 'web' || isDesktop));
    diag('remote', 'announce', { commands: capabilitiesFor(support, false).SupportedCommands.length });
  } catch (e) {
    console.warn('[remote] capabilities were not sent', describeError(e).title);
  }
});

function announceSoon(): void {
  void announce.request().catch(() => undefined);
}

function detach(): void {
  playGate.cancel();
  announce.reset();
  if (!attached) return;
  attached.offOpen();
  attached.unsubscribe();
  attached = null;
}

function attach(): void {
  const s = useSessionStore.getState().session;
  if (attached && s && attached.token === s.token) return;
  detach();
  if (!s || !support) return;
  const api = getApi(s.serverUrl, s.token);
  const userId = s.userId;
  const unsubscribe = jf.subscribeRemoteCommands(api, (m) => onMessage(m, userId));
  const offOpen = jf.onSocketOpen(api, announceSoon);
  attached = { token: s.token, userId, api, unsubscribe, offOpen };
  announceSoon();
}

function onMessage(m: jf.RemoteSocketMessage, userId: string): void {
  if (!support || attached?.userId !== userId) return;
  const action = parseMessage(m, userId);
  if (!action) {
    diag('remote', 'ignored', { type: m.MessageType });
    return;
  }
  if (!allowedBy(support, action)) {
    diag('remote', 'unsupported', { name: actionName(action) });
    return;
  }
  diag('remote', 'command', {
    name: actionName(action),
    ...(action.kind === 'play' ? { items: action.itemIds.length, item: shortId(action.itemIds[action.startIndex]) } : null),
  });
  try {
    apply(action);
  } catch (e) {
    console.warn('[remote] command failed', describeError(e).title);
  }
}

function apply(action: RemoteAction): void {
  const st = playerState();
  const playing = !!st.now;
  switch (action.kind) {
    case 'play':
      void play(action);
      return;
    case 'stop':
      if (playing) void activePlayback.stopAndClose();
      return;
    case 'pause':
      if (playing && st.playing) activePlayback.pause();
      return;
    case 'unpause':
      if (playing && !st.playing) activePlayback.resume();
      return;
    case 'playPause':
      if (playing) activePlayback.togglePlay();
      return;
    case 'seek':
      if (playing) activePlayback.seekTo(action.positionTicks / TICKS_PER_SECOND);
      return;
    case 'next':
      if (playing) activePlayback.next();
      return;
    case 'previous':
      if (playing) activePlayback.previous();
      return;
    case 'skip':
      if (playing) activePlayback.skip(action.seconds);
      return;
    case 'setVolume':
      setVolumeLevel(action.level);
      return;
    case 'volumeStep':
      stepAppVolume(action.steps);
      return;
    case 'mute':
      if (features.inAppVolume) {
        if (action.muted === 'toggle') toggleAppMute();
        else setAppMuted(action.muted);
      } else if (playing) {
        activePlayback.setMuted(action.muted);
      }
      return;
    case 'audioTrack':
      activePlayback.selectTrack('audio', action.index);
      return;
    case 'subtitleTrack':
      activePlayback.selectTrack('subtitle', action.index);
      return;
    case 'message':
      toast(action.text, { icon: 'tv' });
      return;
  }
}

async function play(action: Extract<RemoteAction, { kind: 'play' }>): Promise<void> {
  const a = attached;
  if (!a) return;
  const token = playGate.begin();
  try {
    const items = orderByIds(await jf.getItemsByIds(a.api, a.userId, action.itemIds), action.itemIds);
    if (!playGate.current(token)) return;
    const plan = playPlan(action, items, playerState().now?.kind ?? null, isAudioItem);
    const player = playerController();
    switch (plan.kind) {
      case 'audio':
        player.play({
          item: plan.item,
          list: plan.list ?? undefined,
          index: plan.list ? plan.index : undefined,
          shuffle: plan.shuffle,
          startPositionTicks: plan.startPositionTicks,
        });
        return;
      case 'video':
        player.play({ item: plan.item, queue: plan.queue, startPositionTicks: plan.startPositionTicks });
        return;
      case 'queue':
        await queueHere(plan.items, plan.how);
        return;
      case 'mix':
        player.instantMix(plan.item);
        return;
      case 'refuse':
        toast(plan.text, { icon: 'tv' });
        return;
      case 'none':
        diag('remote', 'play-empty', { items: action.itemIds.length });
        return;
    }
  } catch (e) {
    if (!playGate.current(token)) return;
    toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
  }
}

/**
 * Starts the target once, at app start. It follows the signed-in session
 * from then on. Does nothing on phones and tablets.
 */
export function startRemoteTarget(): void {
  if (started) return;
  started = true;
  support = remoteTargetSupport();
  if (!support) return;
  attach();
  useSessionStore.subscribe((s, prev) => {
    if (s.session?.token !== prev.session?.token) attach();
  });
  useOnlineStore.subscribe((s, prev) => {
    if (s.reachable && prev.reachable !== true) announceSoon();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') announceSoon();
  });
  if (support.volume) {
    // The slider or a remote changed the app volume: the controller sees it soon, not at the next 10 s report.
    let timer: ReturnType<typeof setTimeout> | null = null;
    useVolume.subscribe((v, prev) => {
      if (v.level === prev.level && v.muted === prev.muted) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        activePlayback.reportNow('VolumeChange');
      }, VOLUME_REPORT_MS);
    });
  }
}
