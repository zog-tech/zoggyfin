/**
 * The audio playback session: owns the queue, drives the audio engine,
 * keeps the shared player store current, reports progress per track,
 * keeps long-form positions, runs the sleep timer and saves the queue so
 * it comes back after a restart.
 *
 * It writes the player log (`lib/diag-store.ts`, area `music`): play
 * requests, track starts and their source, play and pause and the branch
 * taken, controls that a together session took, the queue end, Autoplay
 * requests and the sleep timer. Only ids, kinds and counts: no names.
 */
import type { Api } from '@jellyfin/sdk';
import * as Network from 'expo-network';
import { AppState, type NativeEventSubscription } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto, LyricDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { checkDownloadedFiles, chooseMedia, downloadedChildren, findDownload, localExtraUri, readLocalText, documentsDir, serverOrLocal } from '@/downloads';
import { addToOutbox } from '@/downloads/outbox-store';
import { resolveImage } from '@/images/resolve-image';
import { errorText, shortId, uriKind } from '@/lib/diag-log';
import { diag } from '@/lib/diag-store';
import { isOffline } from '@/lib/online';
import { randomId } from '@/lib/id';
import { toast } from '@/lib/toast';
import { bitrateFor, usePlaybackSettings } from '@/settings/playback';
import { followAppVolume, reportVolume } from '@/settings/volume';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { audioCapabilities } from '../capabilities';
import { controlGate, queueGate, togglePauses, type UserControl } from '../control-gate';
import { buildDeviceProfile } from '../device-profile';
import { playbackInfoBody } from '../stream';
import { isForeignDownload, outboxOnly, withOutbox } from '../outbox-transport';
import { ProgressReporter, secondsToTicks, ticksToSecondsExact, toServerReport } from '../progress-reporter';
import { initialPlayerState, type NowPlaying, playerState, setPlayerState } from '../store';
import type { StreamServer } from '../stream';
import { chapterAt, chaptersOf } from '../timeline';
import type { PlayRequest } from '../types';
import { type AudioEngineEvent, audioEngine, type EngineTrack } from './engine';
import { type AudioItem, artistLine, isAudioItemLike, slimItem } from './item';
import { isLongFormItem, isLongFormList } from './long-form';
import { fromLyricDto, mayHaveLyrics } from './lyrics';
import { resumeSeconds } from './positions';
import { positions } from './resume';
import {
  addToQueue,
  advance,
  appendAutoplay,
  dropAutoplay,
  back,
  clearUpcoming,
  currentEntry,
  jumpTo,
  moveEntry,
  nextRepeat,
  playNext,
  playNow,
  type QueueEntry,
  type QueueSource,
  type QueueState,
  removeEntry,
  replaceItem,
  restoreQueue,
  setShuffle,
  upcomingEntries,
  upcomingEntry,
  upcomingIndex,
} from './queue';
import { isCatalogSong } from './catalog';
import { linkCatalogSong } from './catalog-links';
import { liteNow } from '@/platform/lite-now';
import { fadeBetween, fadeGain, fadeLength, type FadePoint, inFadeWindow, overlapDue } from './crossfade';
import { pickRadio, RADIO_BATCH, type RadioConditions, radioPluginSeeds, radioSeeds, radioWanted, rememberPlayed } from './radio';
import { sleepDue, sleepFadeVolume, sleepOff, type SleepTimer } from './sleep-timer';
import { elementGain, volumeProduct } from '../volume';
import { audioState, initialAudioState, setAudioState } from './store';
import { formatLine, hasCodecInfo, predictPlayMethod, universalAudioUrl } from './stream-url';

/**
 * A listen-together guest: where each track comes from (its own download, or
 * the host's file over the session port), set by the session. Null: the
 * normal rules (download, else the server).
 */
export type SharedSource = (item: AudioItem) => string | null;

const QUEUE_KEY = 'audio.queue.v1';
const POSITION_KEY = 'audio.position.v1';
const RATE_KEY = 'audio.longFormRate';
/** Previous restarts the track when it has played longer than this. */
const RESTART_SECONDS = 3;
/** A catalog song: the server fetches the file before PlaybackInfo answers, which can take a while. */
const CATALOG_FETCH_TIMEOUT_MS = 3 * 60_000;

interface Ctx {
  api: Api;
  userId: string;
  serverId: string;
  server: StreamServer;
}

/** The download record when the item is another server's download (not the active server), else null. */
function foreignRecord(itemId: string | null | undefined) {
  const r = findDownload(itemId);
  const active = useSessionStore.getState().session?.serverId;
  // With no account signed in, every download counts as another server's: no server calls.
  return r && r.state === 'completed' && (!active || isForeignDownload(r, active)) ? r : null;
}

function context(): Ctx {
  const s = useSessionStore.getState().session;
  if (!s) throw new Error('Sign in to play.');
  return {
    api: getApi(s.serverUrl, s.token),
    userId: s.userId,
    serverId: s.serverId,
    server: { baseUrl: s.serverUrl, token: s.token, deviceId: clientIdentity().deviceId },
  };
}

async function onCellular(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false;
  }
}

/** Containers whose tracks the server lists for us. */
const CONTAINERS = new Set(['MusicAlbum', 'MusicArtist', 'Playlist', 'MusicGenre', 'Genre', 'Folder', 'CollectionFolder']);

function artwork(item: BaseItemDto, server: StreamServer): string | undefined {
  const local = findDownload(item.Id);
  if (local?.state === 'completed' && local.images.primary && isOffline()) return localExtraUri(local, local.images.primary) ?? undefined;
  try {
    const img = resolveImage(item, 'square', { width: 600, height: 600 }, { baseUrl: server.baseUrl, token: server.token });
    return img.kind === 'remote' && !img.crop ? img.uri : undefined;
  } catch {
    return undefined;
  }
}

interface SavedQueue {
  serverId: string;
  userId: string;
  queue: QueueState<AudioItem>;
  longForm: boolean;
}

interface SavedPositionLine {
  key: string;
  position: number;
}

interface TrackInfo {
  playSessionId: string;
  playMethod: 'DirectPlay' | 'Transcode' | 'DirectStream';
  url: string;
  /** True for a stream from the server (not a download, not a listen-together host's file). */
  remote?: boolean;
}

class AudioSession {
  private engine = audioEngine();
  private reporter: ProgressReporter | null = null;
  private reporterKey: string | null = null;
  private tracks = new Map<string, TrackInfo>();
  private loadId = 0;
  private positions = positions;
  private lastLocalSave = 0;
  private lastPositionSave = 0;
  private appState: NativeEventSubscription | null = null;
  private sleepHandle: ReturnType<typeof setInterval> | null = null;
  private bitrate = 0;
  /** For the gap measurement between tracks (development builds log it). */
  private lastStatus: { key: string; position: number; duration: number; at: number } | null = null;
  private pendingGap: { from: string; endsAt: number } | null = null;
  /** Listen together (guest): the source of each track; the queue is the host's. */
  private shared: SharedSource | null = null;
  /** Nearby (true): no progress reports. SyncPlay (false): the guest's own server gets them. */
  private sharedNoReports = true;
  private trackListeners = new Set<(key: string) => void>();
  /** The queue entry whose catalog song the server is fetching now (`fetchCatalogSong`). */
  private catalogFetch: string | null = null;
  /** Autoplay (`radio.ts`): the request that runs now, the queue end it ran for, and recently played song ids. */
  private radioRun: { tail: string; done: Promise<boolean> } | null = null;
  private radioTried: string | null = null;
  private recent: string[] = [];
  /** "Crossfade songs" (`crossfade.ts`): the fade's share of the volume, and its fine-step timer. */
  private fadeVolume = 1;
  /** The current track fades in: it came after a fade-out. */
  private fadeIn = false;
  /** The entry that fades out at its end (from the last check). */
  private fadeOutKey: string | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether the engine was last told to cue the next song for a crossfade (`nextOverlaps`). */
  private sentOverlap = false;
  /** When the current track began by itself (ms), for the fade-in before its first status. */
  private trackStartedAt = 0;

  constructor() {
    this.engine.subscribe(this.onEngine);
    // The web and the Mac app: the app's own volume slider (a no-op elsewhere).
    followAppVolume((level) => {
      this.userVolume = elementGain(level);
      this.applyVolume();
    });
  }

  // ---- Engine events ------------------------------------------------------------

  private onEngine = (e: AudioEngineEvent) => {
    const st = playerState();
    if (st.now?.kind !== 'audio') return;
    switch (e.type) {
      case 'status': {
        const key = this.engine.currentKey;
        const status = e.buffering ? 'buffering' : e.loaded ? 'ready' : st.status === 'loading' ? 'loading' : 'buffering';
        const patch: Partial<typeof st> = { position: e.position, status, buffered: e.position };
        if (e.duration > 0 && Number.isFinite(e.duration) && Math.abs(e.duration - st.duration) > 0.5) patch.duration = e.duration;
        if (e.playing !== st.playing) {
          patch.playing = e.playing;
          this.reporter?.tick(e.playing ? 'Unpause' : 'Pause');
          if (!e.playing) this.saveNow();
        }
        setPlayerState(patch);
        this.updateFade(e.position, e.duration > 0 ? e.duration : playerState().duration);
        this.measureGap(key, e.position, e.duration);
        this.throttledSaves(e.position);
        break;
      }
      case 'track':
        this.onTrack(e.key, e.overlap === true);
        break;
      case 'ended':
        void this.onQueueEnd();
        break;
      case 'remote':
        // The lock screen: the same next and previous as the app's buttons, so a track
        // that is not in the native window (a catalog song, the one before) still plays.
        if (e.command === 'next') this.next();
        else this.previous();
        break;
      case 'error':
        diag('music', 'engine-error', { message: errorText(e.message) });
        if (this.recoverAfterAddressSwitch()) break;
        setPlayerState({ status: 'error', error: e.message });
        break;
    }
  };

  /** The track URL that was started again after an address switch, so a second failure shows the error. */
  private recovered: string | null = null;

  /**
   * The app moved to another address of the server (`servers/connection.ts`).
   * The track keeps its old address until it fails; then it starts again on
   * the new address at the same position.
   */
  private recoverAfterAddressSwitch(): boolean {
    const url = playerState().now?.plan.url;
    const s = useSessionStore.getState().session;
    if (!url || !s || !/^https?:/i.test(url) || url.startsWith(`${s.serverUrl}/`) || this.recovered === url) return false;
    this.recovered = url;
    const position = this.engine.loaded ? this.engine.position : playerState().position;
    void this.startCurrent({ autoplay: true, startSeconds: position });
    return true;
  }

  /** Logs the silence between two tracks: when the next track really started minus when the last one should have ended. */
  private measureGap(key: string | null, position: number, duration: number) {
    if (!key) return;
    const now = Date.now();
    const rate = playerState().rate || 1;
    if (this.pendingGap && key !== this.pendingGap.from && position > 0) {
      const startedAt = now - (position * 1000) / rate;
      const gap = Math.round(startedAt - this.pendingGap.endsAt);
      if (__DEV__) console.log(`[audio] gap between tracks: ${gap} ms`);
      this.pendingGap = null;
    }
    if (duration > 0) this.lastStatus = { key, position, duration, at: now };
  }

  private throttledSaves(position: number) {
    const now = Date.now();
    if (now - this.lastPositionSave > 5000) {
      this.lastPositionSave = now;
      this.savePositionLine(position);
    }
    if (audioState().longForm && now - this.lastLocalSave > 5000) {
      this.lastLocalSave = now;
      this.saveLocalPosition(position);
    }
  }

  private saveLocalPosition(position = this.engine.position) {
    const entry = currentEntry(audioState().queue);
    if (!entry || !audioState().longForm) return;
    this.positions.save(entry.item.Id, position, playerState().duration || ticksToSecondsExact(entry.item.RunTimeTicks));
  }

  private savePositionLine(position: number) {
    const entry = currentEntry(audioState().queue);
    if (!entry) return;
    writeJson(POSITION_KEY, { key: entry.key, position } satisfies SavedPositionLine);
  }

  private saveNow() {
    const position = this.engine.loaded ? this.engine.position : playerState().position;
    this.savePositionLine(position);
    this.saveLocalPosition(position);
  }

  /** The playlist moved by itself: the end of a track (gapless), or the lock screen / headset. */
  private onTrack(key: string, overlap = false) {
    const q = audioState().queue;
    const up = upcomingIndex(q);
    const prev = currentEntry(q);
    let index: number;
    if (up !== null && q.entries[up]?.key === key) index = up;
    else index = q.entries.findIndex((en) => en.key === key);
    if (index < 0) return;
    const natural = index === up;
    const last = this.lastStatus;
    // An overlap has no gap to measure: the old song still plays.
    if (natural && !overlap && last && prev && last.key === prev.key) {
      const rate = playerState().rate || 1;
      this.pendingGap = { from: prev.key, endsAt: last.at + ((last.duration - last.position) * 1000) / rate };
    }
    const duration = playerState().duration;
    void this.finishReporter(natural ? duration : this.engine.position);
    if (natural && prev && audioState().longForm) void this.finishedLongItem(prev.item);
    const nq = { ...q, index };
    setAudioState({ queue: nq, resumedAt: null });
    const entry = currentEntry(nq);
    if (!entry) return;
    this.recent = rememberPlayed(this.recent, entry.item.Id);
    // A song that follows a fade-out starts silent and fades in.
    this.fadeIn = natural && !!prev && prev.key === this.fadeOutKey;
    this.trackStartedAt = Date.now();
    this.updateFade(0, ticksToSecondsExact(entry.item.RunTimeTicks));
    this.trackListeners.forEach((l) => l(entry.key));
    // Sleep timer "end of track": the next track has already begun, so pause it at its start.
    const sleep = audioState().sleep;
    if (sleepDue(sleep, { now: Date.now(), itemKey: entry.key, position: 0, trackEnded: true }) && sleep.kind === 'end') {
      diag('music', 'sleep-pause', { kind: 'end' });
      this.engine.pause();
      this.engine.seekTo(0);
      this.setSleep(sleepOff);
    }
    this.publish(entry, 0, 'ready');
    this.startReporter(entry);
    this.afterTrackStart(entry);
    if (audioState().longForm) {
      const resume = resumeSeconds(this.positions.get(entry.item.Id), ticksToSecondsExact(entry.item.UserData?.PlaybackPositionTicks), ticksToSecondsExact(entry.item.RunTimeTicks));
      if (resume > 0) {
        this.engine.seekTo(resume);
        setAudioState({ resumedAt: Date.now() });
      }
    }
    this.syncNext();
    this.persistQueue();
    void this.extendRadio();
  }

  private async onQueueEnd() {
    const id = this.loadId;
    const q = audioState().queue;
    const entry = currentEntry(q);
    diag('music', 'queue-end', { id, index: q.index, length: q.entries.length, sleepEnd: audioState().sleep.kind === 'end' });
    await this.finishReporter(playerState().duration);
    // A track started (or the player stopped) during the last report: that one owns the engine now.
    if (id !== this.loadId) return;
    if (entry && audioState().longForm) void this.finishedLongItem(entry.item);
    // A catalog song was not preloaded (nextTrackFor): the queue goes on with it here.
    // The sleep timer "end of track" stops here as before.
    const nq = audioState().sleep.kind === 'end' ? null : advance(audioState().queue);
    const target = nq ? currentEntry(nq) : null;
    if (nq && target && isCatalogSong(target.item)) {
      diag('music', 'queue-end-next', { how: 'catalog' });
      setAudioState({ queue: nq, resumedAt: null });
      void this.startCurrent({ autoplay: true, startSeconds: 0 });
      return;
    }
    // Autoplay had no songs ready (a slow server, or the queue ran out fast): wait for it once.
    // The ended player is unloaded first: a song that joins the native queue now could start by
    // itself (iOS keeps the rate after the last item) and move the queue under this wait.
    if (!nq && audioState().sleep.kind !== 'end' && entry) {
      diag('music', 'queue-end-next', { how: 'radio-wait' });
      this.engine.unload();
      await this.extendRadio();
      if (id !== this.loadId || currentEntry(audioState().queue)?.key !== entry.key) return;
      const more = advance(audioState().queue);
      diag('music', 'queue-end-radio', { more: !!more });
      if (more) {
        setAudioState({ queue: more, resumedAt: null });
        void this.startCurrent({ autoplay: true, startSeconds: 0 });
        return;
      }
    }
    diag('music', 'queue-end-stop', { advanced: !!nq });
    this.engine.unload();
    if (audioState().sleep.kind === 'end') this.setSleep(sleepOff);
    setPlayerState({ status: 'ended', playing: false, position: 0 });
    this.savePositionLine(0);
    refreshAfterPlayback(entry?.item);
  }

  /** A long item played to its end: forget the local position and mark it played. */
  private async finishedLongItem(item: AudioItem) {
    this.positions.forget(item.Id);
    let ids: { userId: string; serverId: string } | null = null;
    const other = foreignRecord(item.Id);
    if (other) {
      // Another server's download: the outbox marks it played on that server.
      addToOutbox({ serverId: other.serverId, userId: other.userId, itemId: item.Id, positionTicks: 0, runTimeTicks: item.RunTimeTicks ?? null, played: true, at: Date.now() });
      return;
    }
    try {
      const { api, userId, serverId } = context();
      ids = { userId, serverId };
      if (isOffline()) throw new Error('Network Error');
      await jf.setPlayed(api, userId, item.Id, true);
    } catch (e) {
      // Offline: the outbox marks it played when the server is back.
      if (ids) addToOutbox({ ...ids, itemId: item.Id, positionTicks: 0, runTimeTicks: item.RunTimeTicks ?? null, played: true, at: Date.now() });
      else console.warn('[audio] mark played failed', describeError(e).title);
    }
  }

  // ---- Starting tracks ---------------------------------------------------------

  /**
   * The engine track for a queue entry. A server transcode is a progressive
   * stream with no byte seeking, so a transcode that starts later than 0
   * asks the server to start there (`StartTimeTicks`) and tells the engine
   * the offset. A direct-play file starts at 0 and the engine seeks in it.
   */
  private trackFor(entry: QueueEntry<AudioItem> | null, startSeconds = 0, reuseSessionId?: string): EngineTrack | null {
    if (!entry) return null;
    const profile = buildDeviceProfile(audioCapabilities(), { maxBitrate: this.bitrate || bitrateFor(usePlaybackSettings.getState(), false) });
    const playSessionId = reuseSessionId ?? randomId().replace(/-/g, '');
    const sharedUri = this.shared?.(entry.item) ?? null;
    if (sharedUri) {
      this.tracks.set(entry.key, { playSessionId, playMethod: 'DirectPlay', url: sharedUri });
      return { key: entry.key, uri: sharedUri };
    }
    // A guest with no file for this track streams it from the server only when it is signed in to that server.
    const active = useSessionStore.getState().session?.serverId;
    if (this.shared && (!active || (entry.item.ServerId && entry.item.ServerId !== active))) return null;
    const maxBitrate = profile.MaxStreamingBitrate ?? this.bitrate;
    const predicted = predictPlayMethod(entry.item, profile, maxBitrate);
    const offset = predicted === 'Transcode' && startSeconds > 0.5 ? startSeconds : 0;
    // A downloaded track plays from the device; the server URL is built only when it is not.
    // A download from any saved server plays from the device.
    // The server (and a sign-in) is needed only for a track that is not on the device.
    const choice = chooseMedia(findDownload(entry.item.Id), documentsDir(), null, () => {
      const { server, userId } = context();
      return universalAudioUrl(server, entry.item.Id, profile, {
        userId,
        maxBitrate,
        playSessionId,
        startTicks: offset ? secondsToTicks(offset) : undefined,
      });
    });
    const remote = choice.kind !== 'local';
    const playMethod = remote ? predicted : 'DirectPlay';
    this.tracks.set(entry.key, { playSessionId, playMethod, url: choice.uri, remote });
    return { key: entry.key, uri: choice.uri, offset: remote ? offset : 0 };
  }

  /**
   * The track to preload after the current one. A catalog song that would
   * stream from the server is not preloaded: the preload would make the
   * server fetch it now (`catalog.ts`). `onQueueEnd` starts it instead.
   */
  private nextTrackFor(entry: QueueEntry<AudioItem> | null): EngineTrack | null {
    const track = this.trackFor(entry);
    if (track && entry && isCatalogSong(entry.item) && /^https?:/i.test(track.uri)) return null;
    return track;
  }

  private nowPlaying(entry: QueueEntry<AudioItem>, q: QueueState<AudioItem>): NowPlaying {
    const info = this.tracks.get(entry.key);
    const duration = ticksToSecondsExact(entry.item.RunTimeTicks);
    const next = upcomingEntry(q);
    return {
      kind: 'audio',
      item: entry.item,
      queue: upcomingEntries(q).slice(0, 50).map((e) => e.item),
      plan: {
        url: info?.url ?? '',
        isHls: false,
        playMethod: info?.playMethod ?? 'DirectPlay',
        mediaSourceId: entry.item.MediaSources?.[0]?.Id ?? entry.item.Id,
        playSessionId: info?.playSessionId ?? null,
        audio: [],
        subtitles: [],
        audioIndex: null,
        subtitleIndex: null,
        burnedSubtitle: false,
      },
      segments: [],
      chapters: chaptersOf(entry.item.Chapters, duration),
      trickplay: null,
      bitrateChoice: null,
      bitrate: this.bitrate,
      next: next && next.key !== entry.key ? next.item : null,
    };
  }

  /** Writes the shared store for the current entry. */
  private publish(entry: QueueEntry<AudioItem>, position: number, status: 'loading' | 'ready') {
    const q = audioState().queue;
    const st = playerState();
    setPlayerState({
      now: this.nowPlaying(entry, q),
      status,
      error: null,
      position,
      duration: ticksToSecondsExact(entry.item.RunTimeTicks) || st.duration,
      buffered: 0,
      presentation: st.presentation === 'hidden' ? 'mini' : st.presentation,
      cues: null,
      pip: false,
    });
    setAudioState({ format: formatLine(entry.item) });
  }

  /** Loads the current entry into the engine. */
  private async startCurrent(opts: { autoplay: boolean; startSeconds?: number }): Promise<void> {
    const id = ++this.loadId;
    let entry = currentEntry(audioState().queue);
    diag('music', 'start', { id, autoplay: opts.autoplay, start: opts.startSeconds ?? null, item: shortId(entry?.item.Id), index: audioState().queue.index });
    if (!entry) return;
    await this.finishReporter(this.engine.loaded ? this.engine.position : playerState().position);
    const cellular = await onCellular();
    this.bitrate = bitrateFor(usePlaybackSettings.getState(), cellular);
    if (id !== this.loadId) {
      diag('music', 'start-stale', { id, at: 'network' });
      return;
    }
    entry = this.savedDownloadEntry(entry);
    const catalog = this.needsCatalogFetch(entry);
    diag('music', 'start-network', { id, cellular, offline: isOffline(), catalog });
    if (catalog) {
      const saved = await this.fetchCatalogSong(entry, id, opts.startSeconds ?? 0);
      if (id !== this.loadId) {
        diag('music', 'start-stale', { id, at: 'catalog' });
        return;
      }
      if (saved) entry = saved;
    }
    const q = audioState().queue;
    const duration = ticksToSecondsExact(entry.item.RunTimeTicks);
    let start = opts.startSeconds ?? 0;
    let resumed = false;
    if (opts.startSeconds === undefined && (audioState().longForm || isLongFormItem(entry.item))) {
      start = resumeSeconds(this.positions.get(entry.item.Id), ticksToSecondsExact(entry.item.UserData?.PlaybackPositionTicks), duration);
      resumed = start > 0;
    }
    const current = this.trackFor(entry, start);
    if (!current) {
      // The queue has moved to this entry: the old track must not play on under it.
      this.engine.unload();
      this.publish(entry, start, 'loading');
      setPlayerState({ status: 'error', error: 'This track is not on this device. Sign in to its server to play it.', playing: false });
      return;
    }
    const nextEntry = upcomingEntry(q);
    const next = nextEntry ? this.nextTrackFor(nextEntry) : null;
    const info = this.tracks.get(entry.key);
    diag('music', 'start-track', {
      id,
      source: info?.remote ? 'stream' : this.shared ? 'shared' : 'download',
      uri: uriKind(current.uri),
      method: info?.playMethod ?? null,
      start,
      resumed,
      next: !!next,
      nextEntry: !!nextEntry,
      longForm: audioState().longForm,
    });
    this.publish(entry, start, 'loading');
    setAudioState({ resumedAt: resumed ? Date.now() : null });
    // In a session the group rate applies (the session sets it).
    if (!controlGate.active) {
      const rate = audioState().longForm ? Number(storage.getString(RATE_KEY) ?? '1') || 1 : 1;
      this.engine.setRate(rate);
      setPlayerState({ rate });
    }
    // A track that starts by a press (or a new queue) does not fade in.
    this.fadeIn = false;
    // A load puts the next song in the playlist; the next fade check cues it when a crossfade applies.
    this.sentOverlap = false;
    await this.engine.load(current, next, start, opts.autoplay);
    if (id !== this.loadId) {
      diag('music', 'start-stale', { id, at: 'load' });
      return;
    }
    this.recent = rememberPlayed(this.recent, entry.item.Id);
    this.updateFade(start, duration);
    this.trackListeners.forEach((l) => l(entry.key));
    this.startReporter(entry);
    this.afterTrackStart(entry);
    this.watchAppState();
    this.persistQueue();
    void this.extendRadio();
  }

  // ---- Autoplay (similar music after the queue) -------------------------------------

  /** The Autoplay switch (queue toolbar, Settings). Off removes the similar songs that wait in the queue. */
  setAutoplay(on: boolean): void {
    usePlaybackSettings.getState().update({ autoplaySimilar: on });
    if (on) {
      this.radioTried = null;
      void this.extendRadio();
      return;
    }
    const q = audioState().queue;
    const nq = dropAutoplay(q);
    if (nq === q) return;
    setAudioState({ queue: nq });
    this.syncNext();
    this.persistQueue();
  }

  private radioConditions(): RadioConditions {
    return {
      enabled: usePlaybackSettings.getState().autoplaySimilar,
      longForm: audioState().longForm,
      together: !!this.shared || controlGate.active || queueGate.locked !== null,
    };
  }

  /**
   * Adds similar songs when the queue is about to end (`radio.ts`). One
   * request per queue end: a second call for the same end gets the running
   * one; a new queue starts its own (the old one finds itself stale). A queue
   * end with no songs is not asked again, unless the request failed: then
   * the next call (the queue end itself) tries once more.
   * Resolves true when songs were added.
   */
  private extendRadio(): Promise<boolean> {
    const q = audioState().queue;
    const tail = q.entries[q.entries.length - 1];
    if (tail && this.radioRun?.tail === tail.key) return this.radioRun.done;
    if (!tail || this.radioTried === tail.key || isOffline() || !radioWanted(q, this.radioConditions())) return Promise.resolve(false);
    this.radioTried = tail.key;
    diag('music', 'radio-ask', { tail: shortId(tail.key), length: q.entries.length, index: q.index });
    const run = {
      tail: tail.key,
      done: this.fetchRadio(tail.key).finally(() => {
        if (this.radioRun === run) this.radioRun = null;
      }),
    };
    this.radioRun = run;
    return run.done;
  }

  private async fetchRadio(tailKey: string): Promise<boolean> {
    let ctx: Ctx;
    try {
      ctx = context();
    } catch {
      return false;
    }
    // The queue changed while the server answered (a new album, songs added): the next track start decides again.
    const stale = () => {
      const q = audioState().queue;
      return q.entries[q.entries.length - 1]?.key !== tailKey || !radioWanted(q, this.radioConditions());
    };
    const add = (mix: BaseItemDto[]): boolean => {
      const q = audioState().queue;
      const songs = pickRadio(mix.filter((i) => i.Id).map(slimItem), q, this.recent);
      diag('music', 'radio-answer', { mix: mix.length, songs: songs.length });
      if (!songs.length) return false;
      setAudioState({ queue: appendAutoplay(q, songs) });
      // After the queue ended the engine is unloaded (`onQueueEnd`), so this preloads nothing there.
      this.syncNext();
      this.persistQueue();
      return true;
    };
    // A failed request may try again at the queue end; an answer with no new songs does not.
    const failed = () => {
      diag('music', 'radio-failed');
      if (this.radioTried === tailKey) this.radioTried = null;
      return false;
    };
    // The library first. A catalog song that is not in the library yet has no mix.
    for (const seed of radioSeeds(audioState().queue, (item) => !isCatalogSong(item))) {
      let mix: BaseItemDto[];
      try {
        mix = await jf.getInstantMix(ctx.api, ctx.userId, seed as BaseItemDto);
      } catch {
        if (stale()) return false;
        const radio = await jf.getOnDemandRadio(ctx.api, radioPluginSeeds(audioState().queue), RADIO_BATCH * 2);
        if (stale()) return false;
        return radio ? add(radio) : failed();
      }
      if (stale()) return false;
      if (add(mix)) return true;
    }
    // Then the catalog plugin's radio, when the server has it (null: no plugin).
    const radio = await jf.getOnDemandRadio(ctx.api, radioPluginSeeds(audioState().queue), RADIO_BATCH * 2);
    if (stale()) return false;
    return radio ? add(radio) : false;
  }

  // ---- Crossfade songs -----------------------------------------------------------

  /** The fade conditions now, and whether the change to the next song fades at all. */
  private fadePlan(): { seconds: number; fadeOut: boolean; plain: boolean; nextKey: string | null } | null {
    const seconds = usePlaybackSettings.getState().fadeSeconds;
    if (seconds <= 0) return null;
    const a = audioState();
    const entry = currentEntry(a.queue);
    if (!entry) return null;
    const next = upcomingEntry(a.queue);
    const conditions = { seconds, longForm: a.longForm, repeatOne: a.queue.repeat === 'one', together: !!this.shared || controlGate.active || this.groupMuted };
    // A catalog song is not preloaded: it starts after its fetch, with no fade-in, so the song before it does not fade out.
    const nextItem = next && next.key !== entry.key && !isCatalogSong(next.item) ? next.item : null;
    return { seconds, fadeOut: fadeBetween(entry.item, nextItem, conditions), plain: !conditions.longForm && !conditions.together, nextKey: nextItem && next ? next.key : null };
  }

  /**
   * True when the next song must wait on the second deck for a true
   * crossfade (`mixer.ts`). Not in Lite mode (a second player costs memory),
   * not at another speed, and not when the sleep timer stops at the end of
   * this song: then the older fade on one player applies.
   */
  private nextOverlaps(): boolean {
    const plan = this.fadePlan();
    if (!plan?.fadeOut || !plan.nextKey) return false;
    return !liteNow() && (playerState().rate || 1) === 1 && audioState().sleep.kind !== 'end';
  }

  private fadePoint(position: number, duration: number): FadePoint | null {
    const plan = this.fadePlan();
    if (!plan) return null;
    const entry = currentEntry(audioState().queue);
    if (!entry) return null;
    const { seconds } = plan;
    // The next song is cued on the second deck: it starts over the end of this one, at full
    // volume on its side of the mix, so this player's own volume does not fade.
    if (plan.fadeOut && plan.nextKey && this.engine.cuedKey === plan.nextKey) {
      this.fadeOutKey = null;
      if (playerState().playing && overlapDue(position, duration, seconds)) this.engine.startOverlap(fadeLength(seconds, duration));
      return { position, duration, seconds, fadeIn: this.fadeIn && plan.plain, fadeOut: false };
    }
    const fadeOut = plan.fadeOut;
    const fadeIn = this.fadeIn && plan.plain;
    const point = { position, duration, seconds, fadeIn, fadeOut };
    // Marked only once the fade-out has begun: a Next press earlier also moves the native
    // playlist on by itself (gapless), and that song must not fade in.
    this.fadeOutKey = fadeOut && fadeGain({ ...point, fadeIn: false }) < 1 ? entry.key : null;
    return point;
  }

  /**
   * Sets the fade's share of the volume for this position. The engine's
   * status comes every 500 ms; inside a fade window a timer steps the volume
   * every 100 ms, so the fade sounds smooth.
   */
  /**
   * The position for a fade step. Right after a track change the engine still
   * gives the old track's position until the new track's first status: then
   * the time since the change counts.
   */
  private fadePosition(): number {
    const position = this.engine.livePosition();
    if (!this.fadeIn) return position;
    const since = ((Date.now() - this.trackStartedAt) / 1000) * (playerState().rate || 1);
    return position > since + 1 ? since : position;
  }

  private updateFade(position: number, duration: number): void {
    // The setting, the queue or the speed changed what the next change is: move the next song to its place.
    if (this.engine.loaded && this.nextOverlaps() !== this.sentOverlap) this.syncNext();
    const p = this.fadePoint(position, duration);
    const gain = p ? fadeGain(p) : 1;
    if (gain !== this.fadeVolume) {
      this.fadeVolume = gain;
      this.applyVolume();
    }
    const fine = !!p && this.engine.loaded && playerState().playing && inFadeWindow(p);
    if (fine && !this.fadeTimer) {
      this.fadeTimer = setInterval(() => this.updateFade(this.fadePosition(), playerState().duration), 100);
    } else if (!fine && this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /**
   * A catalog song whose saved song is downloaded: the queue entry takes the
   * saved song, so the player shows its clean name and plays the file.
   */
  private savedDownloadEntry(entry: QueueEntry<AudioItem>): QueueEntry<AudioItem> {
    if (!isCatalogSong(entry.item)) return entry;
    const rec = findDownload(entry.item.Id);
    if (rec?.state !== 'completed' || rec.itemId === entry.item.Id || !rec.item.Id) return entry;
    const q = audioState().queue;
    const nq = replaceItem(q, entry.key, slimItem(rec.item));
    const saved = currentEntry(nq);
    if (nq === q || saved?.key !== entry.key) return entry;
    setAudioState({ queue: nq });
    return saved;
  }

  /** A catalog song that would stream from the active server (not a download, not a listen-together guest). */
  private needsCatalogFetch(entry: QueueEntry<AudioItem>): boolean {
    if (!isCatalogSong(entry.item) || this.shared || isOffline()) return false;
    if (findDownload(entry.item.Id)?.state === 'completed') return false;
    const active = useSessionStore.getState().session?.serverId;
    return !!active && (!entry.item.ServerId || entry.item.ServerId === active);
  }

  /**
   * A catalog song is not on the server's disk yet. Before, its stream request
   * itself waited while the server fetched the file, and on iOS the player
   * could stay paused once the answer came: the song started only when the
   * user pressed play. Now PlaybackInfo comes first: the server fetches the
   * file to its library before it answers, and the song then has its real
   * id, a clean name and its album (as in `downloads/manager.ts`). The queue
   * entry takes that item, and the stream that follows answers at once.
   * Returns the entry with the saved item, or null to go on with the catalog
   * entry as before (any failure: the stream request fetches it then).
   */
  private async fetchCatalogSong(entry: QueueEntry<AudioItem>, id: number, start: number): Promise<QueueEntry<AudioItem> | null> {
    let ctx: Ctx;
    try {
      ctx = context();
    } catch {
      return null;
    }
    // The fetch can take a while: the old track stops and the player shows this song as loading.
    this.engine.unload();
    this.publish(entry, start, 'loading');
    this.catalogFetch = entry.key;
    const began = Date.now();
    diag('music', 'catalog-fetch', { id, item: shortId(entry.item.Id) });
    try {
      const profile = buildDeviceProfile(audioCapabilities(), { maxBitrate: this.bitrate || bitrateFor(usePlaybackSettings.getState(), false) });
      const body = playbackInfoBody({ userId: ctx.userId, profile, maxBitrate: profile.MaxStreamingBitrate ?? this.bitrate });
      await jf.getPlaybackInfo(ctx.api, entry.item.Id, body, { timeoutMs: CATALOG_FETCH_TIMEOUT_MS });
      if (id !== this.loadId) return null;
      const full = await jf.getItem(ctx.api, ctx.userId, entry.item.Id);
      if (id !== this.loadId || !full.Id) return null;
      // Rows that still list the catalog id show the saved song as playing through the link.
      linkCatalogSong(entry.item.Id, full.Id);
      const q = audioState().queue;
      const nq = replaceItem(q, entry.key, slimItem(full));
      const saved = currentEntry(nq);
      if (nq === q || saved?.key !== entry.key) return null;
      setAudioState({ queue: nq });
      diag('music', 'catalog-done', { id, ms: Date.now() - began, ok: true });
      return saved;
    } catch (e) {
      diag('music', 'catalog-done', { id, ms: Date.now() - began, ok: false, error: errorText(e) });
      if (id === this.loadId) console.warn('[audio] catalog fetch failed', describeError(e).title);
      return null;
    } finally {
      if (this.catalogFetch === entry.key) this.catalogFetch = null;
    }
  }

  /** What a progress report carries: the position, the mute and volume, and the queue (the remote's Next and Previous). */
  private snapshot = () => {
    const st = playerState();
    return {
      positionTicks: secondsToTicks(this.engine.loaded ? this.engine.position : st.position),
      isPaused: !st.playing,
      ...reportVolume(this.userMuted),
      playbackRate: st.rate,
      audioStreamIndex: null,
      subtitleStreamIndex: null,
      queue: audioState().queue.entries.map((e) => e.item.Id),
    };
  };

  private startReporter(entry: QueueEntry<AudioItem>) {
    // A nearby guest plays the host's queue: its server does not get progress for it.
    if (this.shared && this.sharedNoReports) return;
    const info = this.tracks.get(entry.key);
    const other = foreignRecord(entry.item.Id);
    if (other) {
      // Another server's download: its progress goes only into the outbox, for that server and user.
      const reporter = new ProgressReporter(
        outboxOnly({ serverId: other.serverId, userId: other.userId, runTimeTicks: entry.item.RunTimeTicks ?? null }),
        this.snapshot,
      );
      reporter.start({ itemId: entry.item.Id, mediaSourceId: entry.item.MediaSources?.[0]?.Id ?? entry.item.Id, playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
      this.reporter = reporter;
      this.reporterKey = entry.key;
      return;
    }
    let api: Api;
    try {
      api = context().api;
    } catch {
      return;
    }
    const ids = useSessionStore.getState().session;
    const base = {
        start: (r: Parameters<typeof toServerReport>[0]) => jf.reportPlaybackStart(api, toServerReport(r)),
        progress: (r: Parameters<typeof toServerReport>[0]) => jf.reportPlaybackProgress(api, toServerReport(r)),
        stopped: (r: Parameters<typeof toServerReport>[0]) =>
          jf.reportPlaybackStopped(api, {
            ItemId: r.itemId,
            MediaSourceId: r.mediaSourceId,
            PlaySessionId: r.playSessionId,
            PositionTicks: r.positionTicks,
          }),
    };
    const reporter = new ProgressReporter(
      ids ? withOutbox(base, { serverId: ids.serverId, userId: ids.userId, runTimeTicks: entry.item.RunTimeTicks ?? null }) : base,
      this.snapshot,
      undefined,
      undefined,
      (e) => console.warn('[audio] progress report failed', describeError(e).title),
    );
    reporter.start({
      itemId: entry.item.Id,
      mediaSourceId: entry.item.MediaSources?.[0]?.Id ?? entry.item.Id,
      playSessionId: info?.playSessionId ?? null,
      playMethod: info?.playMethod ?? 'DirectPlay',
      canSeek: true,
    });
    this.reporter = reporter;
    this.reporterKey = entry.key;
  }

  private async finishReporter(position: number) {
    const r = this.reporter;
    this.reporter = null;
    this.reporterKey = null;
    if (r) await r.stop({ positionTicks: secondsToTicks(position) });
  }

  /** Lock screen, lyrics. */
  private afterTrackStart(entry: QueueEntry<AudioItem>) {
    try {
      const { server } = context();
      const item = entry.item;
      this.engine.setLockScreen(
        { title: item.Name ?? 'Audio', artist: artistLine(item) ?? undefined, albumTitle: item.Album ?? undefined, artworkUrl: artwork(item, server) },
        audioState().longForm ? 'seek' : 'tracks',
      );
    } catch {
      // Not signed in.
    }
    void this.loadLyrics(entry.item);
    void this.fillMediaInfo(entry);
  }

  /**
   * A song played from a tile has only its container ("mov,mp4,m4a,…"), not
   * the codec, so the format line and the play-method guess are weak. Fetch
   * the full item once, in the background. This never reloads the track.
   */
  private async fillMediaInfo(entry: QueueEntry<AudioItem>) {
    const item = entry.item;
    if (hasCodecInfo(item) || foreignRecord(item.Id) || isOffline()) return;
    try {
      const { api, userId } = context();
      const full = await jf.getItem(api, userId, item.Id);
      if (currentEntry(audioState().queue)?.key !== entry.key) return;
      const slim = slimItem(full);
      if (!hasCodecInfo(slim)) return;
      setAudioState({ format: formatLine(slim) });
      const info = this.tracks.get(entry.key);
      // The guess decides how a later seek works (see seekTranscode).
      if (info?.remote && this.engine.currentKey === entry.key) {
        const profile = buildDeviceProfile(audioCapabilities(), { maxBitrate: this.bitrate || bitrateFor(usePlaybackSettings.getState(), false) });
        info.playMethod = predictPlayMethod(slim, profile, profile.MaxStreamingBitrate ?? this.bitrate);
      }
    } catch {
      // Not signed in or the server is away: keep the container line.
    }
  }

  private async loadLyrics(item: AudioItem) {
    const itemId = item.Id;
    const cur = audioState().lyrics;
    if (cur?.itemId === itemId && cur.status !== 'loading') return;
    setAudioState({ lyrics: { itemId, status: 'loading' } });
    try {
      const { api } = context();
      const local = findDownload(itemId);
      const saved = local?.state === 'completed' && local.hasLyrics ? localExtraUri(local, 'lyrics.json') : null;
      const text = saved ? await readLocalText(saved) : null;
      // Another server's download: only its saved lyrics, never a call to the active server.
      // No request when the item has no lyrics: the 404 would log a CORS error on the web.
      const ask = !text && !foreignRecord(itemId) && mayHaveLyrics(item);
      const dto = text ? (JSON.parse(text) as LyricDto) : ask ? await jf.getLyrics(api, itemId) : null;
      const lyrics = fromLyricDto(dto);
      if (currentEntry(audioState().queue)?.item.Id !== itemId) return;
      setAudioState({ lyrics: lyrics ? { itemId, status: 'ready', lyrics } : { itemId, status: 'none' } });
    } catch {
      if (currentEntry(audioState().queue)?.item.Id === itemId) setAudioState({ lyrics: { itemId, status: 'none' } });
    }
  }

  /** Makes the engine's next track match the queue's. */
  private syncNext() {
    if (!this.engine.loaded) {
      diag('music', 'sync-next', { loaded: false });
      return;
    }
    const q = audioState().queue;
    const next = upcomingEntry(q);
    const overlap = this.nextOverlaps();
    this.sentOverlap = overlap;
    diag('music', 'sync-next', { loaded: true, next: shortId(next?.key), same: !!next && this.engine.nextKey === next.key, overlap });
    if (next && this.engine.nextKey === next.key && this.tracks.has(next.key)) {
      this.engine.setNext({ key: next.key, uri: this.tracks.get(next.key)?.url ?? '' }, overlap);
    } else {
      this.engine.setNext(this.nextTrackFor(next), overlap);
    }
    const entry = currentEntry(q);
    if (entry) {
      const now = playerState().now;
      if (now?.kind === 'audio' && now.item.Id === entry.item.Id) {
        const fresh = this.nowPlaying(entry, q);
        setPlayerState({ now: { ...fresh, plan: now.plan } });
      }
    }
  }

  private watchAppState() {
    if (this.appState) return;
    this.appState = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        this.reporter?.tick('Background');
        this.saveNow();
      }
    });
  }

  // ---- Persistence ---------------------------------------------------------------

  private persistQueue() {
    // A guest's queue is the host's: it does not come back after a restart.
    if (this.shared) return;
    try {
      const { serverId, userId } = context();
      const a = audioState();
      if (!a.queue.entries.length) {
        storage.remove(QUEUE_KEY);
        return;
      }
      writeJson(QUEUE_KEY, { serverId, userId, queue: a.queue, longForm: a.longForm } satisfies SavedQueue);
    } catch {
      // Not signed in.
    }
  }

  /** Brings back the last queue (paused) after an app restart. */
  restore(): void {
    if (playerState().now) return;
    const s = useSessionStore.getState().session;
    if (!s) return;
    diag('music', 'restore');
    const saved = readJson<SavedQueue | null>(QUEUE_KEY, null);
    if (!saved || saved.serverId !== s.serverId || saved.userId !== s.userId) return;
    const queue = restoreQueue(saved.queue, isAudioItemLike);
    if (!queue) return;
    const line = readJson<SavedPositionLine | null>(POSITION_KEY, null);
    const entry = currentEntry(queue);
    if (!entry) return;
    const position = line?.key === entry.key ? Math.max(0, line.position) : 0;
    setAudioState({ ...initialAudioState, queue, longForm: saved.longForm === true });
    setPlayerState({
      ...initialPlayerState,
      now: this.nowPlaying(entry, queue),
      status: 'ready',
      playing: false,
      position,
      duration: ticksToSecondsExact(entry.item.RunTimeTicks),
      presentation: 'mini',
    });
    setAudioState({ format: formatLine(entry.item) });
    diag('music', 'restored', { item: shortId(entry.item.Id), position, length: queue.entries.length });
  }

  // ---- Public API ------------------------------------------------------------------

  /** True (with a toast) when a listen-together host owns the queue. */
  private queueLocked(): boolean {
    const message = queueGate.locked;
    if (message) toast(message, { icon: 'lock.fill' });
    return message !== null;
  }

  private gate(c: UserControl): boolean {
    const taken = controlGate.intercept(c);
    if (taken) diag('music', 'gate', { action: c.action });
    return taken;
  }

  /** Plays a request: a song with its album, a container (album, artist, playlist, genre) or a single item. */
  async play(request: PlayRequest): Promise<void> {
    if (this.queueLocked()) return;
    const id = ++this.loadId;
    diag('music', 'play', {
      id,
      list: request.list?.length ?? null,
      container: CONTAINERS.has(request.item.Type ?? ''),
      type: request.item.Type ?? null,
      queue: request.queue?.length ?? 0,
      shuffle: !!request.shuffle,
      start: request.startPositionTicks !== undefined,
      item: shortId(request.item.Id),
    });
    try {
      let items: BaseItemDto[];
      let start = 0;
      let ctxItem: BaseItemDto | null = request.context ?? null;
      if (request.list?.length) {
        items = request.list;
        start = Math.max(0, request.index ?? request.list.findIndex((i) => i.Id === request.item.Id));
      } else if (CONTAINERS.has(request.item.Type ?? '')) {
        if (playerState().now?.kind !== 'audio') setPlayerState({ ...initialPlayerState, status: 'loading', presentation: 'mini', now: null });
        items = await this.tracksOf(request.item);
        ctxItem = request.item;
      } else {
        items = [request.item, ...(request.queue ?? [])];
      }
      if (id !== this.loadId) return;
      const playable = items.filter((i) => i.Id && (i.MediaType === 'Audio' || i.Type === 'Audio' || i.Type === 'AudioBook'));
      if (!playable.length) {
        toast('Nothing to play here yet.');
        return;
      }
      // Downloads whose file is gone become "not downloaded": those tracks stream from the server.
      await checkDownloadedFiles(playable.map((i) => i.Id));
      if (id !== this.loadId) return;
      const startItem = items[start];
      const startIndex = Math.max(0, playable.findIndex((i) => i.Id === startItem?.Id));
      const source: QueueSource | null = ctxItem ? { name: ctxItem.Name ?? null, id: ctxItem.Id ?? null, type: ctxItem.Type ?? null } : null;
      const longForm = isLongFormList(playable, ctxItem);
      await this.playList(playable, request.shuffle && !request.list ? Math.floor(Math.random() * playable.length) : startIndex, {
        shuffle: !!request.shuffle,
        source,
        longForm,
        startSeconds: request.startPositionTicks !== undefined ? ticksToSecondsExact(request.startPositionTicks) : undefined,
      });
    } catch (e) {
      diag('music', 'play-failed', { id, stale: id !== this.loadId, error: errorText(e) });
      if (id !== this.loadId) return;
      setPlayerState({ status: 'error', error: describeError(e).title });
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  }

  async playList(items: BaseItemDto[], startIndex: number, opts: { shuffle: boolean; source: QueueSource | null; longForm: boolean; startSeconds?: number }) {
    const q = playNow(items.map(slimItem), startIndex, { shuffle: opts.shuffle, source: opts.source, repeat: audioState().queue.repeat });
    this.tracks.clear();
    // A new list starts with sound, like a new video.
    this.clearMute();
    setAudioState({ queue: q, longForm: opts.longForm, resumedAt: null });
    await this.startCurrent({ autoplay: true, startSeconds: opts.startSeconds });
  }

  private async tracksOf(item: BaseItemDto): Promise<BaseItemDto[]> {
    if (!CONTAINERS.has(item.Type ?? '')) return [item];
    // With no account signed in, only the downloaded tracks.
    if (!useSessionStore.getState().session) return downloadedChildren(item.Id) ?? [];
    const { api, userId } = context();
    return serverOrLocal(() => jf.getAudioTracks(api, userId, item), () => downloadedChildren(item.Id));
  }

  private async editQueue(item: BaseItemDto, how: 'next' | 'end') {
    if (this.queueLocked()) return;
    try {
      const items = (await this.tracksOf(item)).filter((i) => i.Id).map(slimItem);
      if (!items.length) {
        toast('Nothing to add.');
        return;
      }
      const q = audioState().queue;
      const wasEmpty = q.index < 0 || !playerState().now || playerState().now?.kind !== 'audio';
      if (wasEmpty) {
        await this.playList(items, 0, { shuffle: false, source: null, longForm: isLongFormList(items, item) });
        return;
      }
      setAudioState({ queue: how === 'next' ? playNext(q, items) : addToQueue(q, items) });
      this.syncNext();
      this.persistQueue();
      const many = items.length > 1 ? `${items.length} items ` : '';
      toast(how === 'next' ? (many ? `${many}play next` : 'Playing next') : many ? `${many}added to queue` : 'Added to queue', { icon: 'checkmark' });
    } catch (e) {
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  }

  playNext(item: BaseItemDto): Promise<void> {
    return this.editQueue(item, 'next');
  }

  addToQueue(item: BaseItemDto): Promise<void> {
    return this.editQueue(item, 'end');
  }

  async instantMix(item: BaseItemDto): Promise<void> {
    if (this.queueLocked()) return;
    try {
      const { api, userId } = context();
      const mix = await jf.getInstantMix(api, userId, item);
      if (!mix.length) {
        toast('The server found no songs for a mix.');
        return;
      }
      await this.playList(mix, 0, { shuffle: false, source: { name: `${item.Name ?? 'Instant'} mix`, id: null, type: 'InstantMix' }, longForm: false });
    } catch (e) {
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  }

  togglePlay(): void {
    diag('music', 'toggle', { playing: playerState().playing, status: playerState().status, pause: togglePauses(playerState().playing) });
    if (togglePauses(playerState().playing)) this.pause();
    else this.resume();
  }

  resume(): void {
    if (this.gate({ action: 'play' })) return;
    this.doResume();
  }

  private doResume(): void {
    // The server is fetching the current catalog song: it starts when the fetch ends.
    if (this.catalogFetch && this.catalogFetch === currentEntry(audioState().queue)?.key) {
      diag('music', 'resume', { branch: 'catalog-wait' });
      return;
    }
    if (!this.engine.loaded) {
      const st = playerState();
      diag('music', 'resume', { branch: 'not-loaded', status: st.status });
      void this.startCurrent({ autoplay: true, startSeconds: st.status === 'ended' ? 0 : st.position });
      return;
    }
    diag('music', 'resume', { branch: 'engine-play', status: playerState().status });
    this.engine.play();
  }

  pause(): void {
    if (this.gate({ action: 'pause' })) return;
    this.doPause();
  }

  private doPause(): void {
    diag('music', 'pause');
    this.engine.pause();
    this.saveNow();
  }

  seekTo(seconds: number): void {
    const { duration } = playerState();
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.5) : seconds);
    if (this.gate({ action: 'seek', position: target })) return;
    this.doSeek(target);
  }

  private doSeek(target: number): void {
    setPlayerState({ position: target });
    if (!this.engine.loaded) return;
    if (this.seekTranscode(target)) return;
    this.engine.seekTo(target);
    this.reporter?.tick('Seek');
    setAudioState({ resumedAt: null });
  }

  /**
   * A seek in a server transcode. The progressive stream cannot seek by
   * bytes: the browser asks for a byte range, and the server starts a new
   * transcode from 0, so the song started again. Instead, ask the server
   * for a new stream that starts at `target`, in the same play session.
   * The reporter keeps running: for the server this is a seek, not a new
   * playback.
   */
  private seekTranscode(target: number): boolean {
    const key = this.engine.currentKey;
    const info = key ? this.tracks.get(key) : undefined;
    if (!key || !info?.remote || info.playMethod !== 'Transcode') return false;
    const q = audioState().queue;
    const entry = currentEntry(q);
    if (!entry || entry.key !== key) return false;
    const current = this.trackFor(entry, target, info.playSessionId);
    if (!current) return false;
    const nextKey = this.engine.nextKey;
    const nextInfo = nextKey ? this.tracks.get(nextKey) : undefined;
    const next = nextKey && nextInfo ? { key: nextKey, uri: nextInfo.url } : null;
    const autoplay = playerState().playing;
    const id = ++this.loadId;
    this.sentOverlap = false;
    void this.engine.load(current, next, target, autoplay).then(() => {
      if (id !== this.loadId) return;
      this.reporter?.tick('Seek');
    });
    setAudioState({ resumedAt: null });
    return true;
  }

  skip(delta: number): void {
    this.seekTo((this.engine.loaded ? this.engine.position : playerState().position) + delta);
  }

  /** Next: the gapless path when the engine already has the next track loaded. */
  next(): void {
    if (this.gate({ action: 'next' })) return;
    this.doNext();
  }

  private doNext(autoplay = true): void {
    const q = audioState().queue;
    const nq = advance(q, true);
    if (!nq) return;
    const target = nq.entries[nq.index];
    if (!target) return;
    if (this.engine.loaded && upcomingIndex(q) === nq.index && this.engine.nextKey === target.key && q.repeat !== 'one') {
      this.engine.next();
      return;
    }
    setAudioState({ queue: nq });
    void this.startCurrent({ autoplay, startSeconds: 0 });
  }

  previous(): void {
    if (this.gate({ action: 'previous' })) return;
    this.doPrevious();
  }

  private doPrevious(autoplay = true): void {
    const position = this.engine.loaded ? this.engine.position : playerState().position;
    if (position > RESTART_SECONDS) {
      this.doSeek(0);
      return;
    }
    const nq = back(audioState().queue);
    if (!nq) {
      this.doSeek(0);
      return;
    }
    setAudioState({ queue: nq });
    void this.startCurrent({ autoplay, startSeconds: 0 });
  }

  /** Long-form: the previous or next chapter, or the track when there are no chapters. */
  chapterStep(dir: -1 | 1): void {
    const now = playerState().now;
    const chapters = now?.chapters ?? [];
    const position = this.engine.loaded ? this.engine.position : playerState().position;
    if (!chapters.length) {
      if (dir < 0) this.previous();
      else this.next();
      return;
    }
    const cur = chapterAt(chapters, position);
    const i = cur ? chapters.indexOf(cur) : 0;
    if (dir < 0) {
      const target = cur && position - cur.start > RESTART_SECONDS ? cur : chapters[i - 1];
      if (target) this.seekTo(target.start);
      else this.previous();
    } else {
      const target = chapters[i + 1];
      if (target) this.seekTo(target.start);
      else this.next();
    }
  }

  jump(key: string): void {
    if (this.gate({ action: 'jump', key })) return;
    this.doJump(key);
  }

  private doJump(key: string, autoplay = true): void {
    const q = audioState().queue;
    const nq = jumpTo(q, key);
    if (nq === q || nq.index === q.index) return;
    setAudioState({ queue: nq });
    void this.startCurrent({ autoplay, startSeconds: 0 });
  }

  move(from: number, to: number): void {
    if (this.queueLocked()) return;
    setAudioState({ queue: moveEntry(audioState().queue, from, to) });
    this.syncNext();
    this.persistQueue();
  }

  remove(key: string): void {
    if (this.queueLocked()) return;
    setAudioState({ queue: removeEntry(audioState().queue, key) });
    this.tracks.delete(key);
    this.syncNext();
    this.persistQueue();
  }

  clearQueue(): void {
    if (this.queueLocked()) return;
    setAudioState({ queue: clearUpcoming(audioState().queue) });
    this.syncNext();
    this.persistQueue();
  }

  toggleShuffle(): void {
    const q = audioState().queue;
    if (this.gate({ action: 'shuffle', on: !q.shuffle })) return;
    this.doShuffle(!q.shuffle);
  }

  private doShuffle(on: boolean): void {
    const q = audioState().queue;
    if (q.shuffle === on) return;
    setAudioState({ queue: setShuffle(q, on) });
    this.syncNext();
    this.persistQueue();
  }

  cycleRepeat(): void {
    const q = audioState().queue;
    if (this.gate({ action: 'repeat', mode: nextRepeat(q.repeat) })) return;
    this.doRepeat(nextRepeat(q.repeat));
  }

  private doRepeat(mode: QueueState<AudioItem>['repeat']): void {
    const q = audioState().queue;
    setAudioState({ queue: { ...q, repeat: mode } });
    this.syncNext();
    this.persistQueue();
  }

  setRate(rate: number): void {
    if (this.gate({ action: 'rate', rate })) return;
    this.doRate(rate);
  }

  private doRate(rate: number): void {
    this.engine.setRate(rate);
    setPlayerState({ rate });
    if (audioState().longForm) storage.set(RATE_KEY, String(rate));
    this.reporter?.tick('TimeUpdate');
  }

  setSleep(timer: SleepTimer): void {
    setAudioState({ sleep: timer });
    if (this.sleepHandle) clearInterval(this.sleepHandle);
    this.sleepHandle = null;
    this.setSleepVolume(1);
    if (timer.kind === 'off') return;
    this.sleepHandle = setInterval(() => {
      const t = audioState().sleep;
      const now = Date.now();
      const entry = currentEntry(audioState().queue);
      this.setSleepVolume(sleepFadeVolume(t, now));
      if (sleepDue(t, { now, itemKey: entry?.key ?? null, position: this.engine.position, trackEnded: false })) {
        diag('music', 'sleep-pause', { kind: t.kind });
        this.pause();
        this.setSleepVolume(1);
        this.setSleep(sleepOff);
        toast('Sleep timer: paused', { icon: 'checkmark' });
      }
    }, 1000);
  }

  /** The sleep timer's fade (1: no fade). */
  private sleepVolume = 1;
  /** Listen together: another device plays the sound ("Sound plays on"); this one plays in sync with no sound. */
  private groupMuted = false;
  /** The web and the Mac app: the app's volume slider, as an element gain (1 elsewhere). */
  private userVolume = 1;
  /** The player's own mute (a remote controller on a TV, which has no app volume). */
  private userMuted = false;

  private setSleepVolume(volume: number): void {
    this.sleepVolume = volume;
    this.applyVolume();
  }

  private applyVolume(): void {
    // The mixer multiplies its crossfade gains onto this, so an overlap keeps the user's level.
    this.engine.setVolume(this.groupMuted || this.userMuted ? 0 : volumeProduct(this.userVolume, this.sleepVolume, this.fadeVolume));
  }

  /** The player's own mute. The music keeps playing with no sound. */
  setMuted(muted: boolean): void {
    if (muted === this.userMuted) return;
    this.userMuted = muted;
    setPlayerState({ muted });
    this.applyVolume();
    this.reporter?.tick('VolumeChange');
  }

  /** A progress report now (a remote controller waits for the new state). */
  reportNow(event: 'VolumeChange' | 'TimeUpdate' = 'TimeUpdate'): void {
    this.reporter?.tick(event);
  }

  private clearMute(): void {
    if (!this.userMuted) return;
    this.userMuted = false;
    this.applyVolume();
  }

  // ---- Listen together ---------------------------------------------------------------

  /** Listen together: true while another device plays the session's sound. The player keeps playing in sync. */
  setGroupMuted(muted: boolean): void {
    if (muted === this.groupMuted) return;
    this.groupMuted = muted;
    this.applyVolume();
  }

  /**
   * The player controls with no gate: the together session uses them after it
   * decided for the group, so a group command does not come back to it.
   */
  readonly direct = {
    play: () => this.doResume(),
    pause: () => this.doPause(),
    seek: (seconds: number) => this.doSeek(Math.max(0, seconds)),
    rate: (rate: number) => {
      this.engine.setRate(rate);
      setPlayerState({ rate });
    },
    /** `autoplay`: the new track starts (else it loads paused: the group is paused). */
    next: (autoplay = true) => this.doNext(autoplay),
    previous: (autoplay = true) => this.doPrevious(autoplay),
    jump: (key: string, autoplay = true) => this.doJump(key, autoplay),
    shuffle: (on: boolean) => this.doShuffle(on),
    repeat: (mode: QueueState<AudioItem>['repeat']) => this.doRepeat(mode),
    /** The position now (seconds): the last engine status moved on by the time since it came. */
    position: () => (this.engine.loaded ? this.engine.livePosition() : playerState().position),
    track: () => (this.engine.loaded ? this.engine.currentKey : null),
  };

  /** Called with the queue entry key each time another track starts (gapless or loaded). */
  onTrackChange(listener: (key: string) => void): () => void {
    this.trackListeners.add(listener);
    return () => this.trackListeners.delete(listener);
  }

  /**
   * A listen-together guest: plays the host's queue. `source` gives each
   * track's URL (own download or the host's file). The player starts paused
   * at `startSeconds` of the entry `key`; the session starts it.
   */
  async loadShared(queue: QueueState<AudioItem>, longForm: boolean, source: SharedSource, startSeconds: number, opts: { reports?: boolean; autoplay?: boolean } = {}): Promise<void> {
    this.shared = source;
    this.sharedNoReports = !opts.reports;
    this.tracks.clear();
    setAudioState({ queue, longForm, resumedAt: null });
    await this.startCurrent({ autoplay: opts.autoplay ?? false, startSeconds });
  }

  /** The host's queue changed: keep the current track when it is still current, else move to the new one (playing when `autoplay`). */
  updateShared(queue: QueueState<AudioItem>, longForm: boolean, autoplay = false): void {
    if (!this.shared) return;
    const cur = currentEntry(audioState().queue);
    const next = currentEntry(queue);
    setAudioState({ queue, longForm });
    if (cur && next && cur.key === next.key) {
      this.syncNext();
      return;
    }
    void this.startCurrent({ autoplay, startSeconds: 0 });
  }

  /** The group plays another entry: load it at `startSeconds`, paused unless `autoplay`. */
  async moveShared(key: string, startSeconds: number, autoplay = false): Promise<void> {
    const q = audioState().queue;
    const nq = jumpTo(q, key);
    if (nq === q && currentEntry(q)?.key !== key) return;
    setAudioState({ queue: nq });
    await this.startCurrent({ autoplay, startSeconds });
  }

  /** The guest's session is over: the queue stays, the normal sources apply again. */
  leaveShared(): void {
    this.shared = null;
  }

  /** The remaining seconds of the current track, or null. */
  remaining(): number | null {
    const d = playerState().duration;
    return this.engine.loaded && d > 0 ? Math.max(0, d - this.engine.livePosition()) : null;
  }

  /** Refreshes Recently played and the item pages, for example when the player closes. */
  refreshLists(): void {
    this.reporter?.tick('TimeUpdate');
    this.saveNow();
    setTimeout(() => refreshAfterPlayback(playerState().now?.item), 1500);
  }

  async stop(): Promise<void> {
    diag('music', 'stop');
    this.loadId++;
    this.saveNow();
    await this.finishReporter(this.engine.loaded ? this.engine.position : playerState().position);
    this.engine.unload();
    this.setSleep(sleepOff);
    this.clearMute();
    const item = playerState().now?.item;
    setAudioState({ ...initialAudioState, queue: { ...initialAudioState.queue, repeat: audioState().queue.repeat } });
    setPlayerState({ ...initialPlayerState });
    storage.remove(QUEUE_KEY);
    storage.remove(POSITION_KEY);
    refreshAfterPlayback(item);
  }

  /** Stops the engine for a video, keeping nothing. */
  async stopForVideo(): Promise<void> {
    await this.stop();
    this.engine.resetAudioMode();
  }
}

function refreshAfterPlayback(item: BaseItemDto | undefined) {
  const s = useSessionStore.getState().session;
  if (!s) return;
  const scope = { serverId: s.serverId, userId: s.userId };
  void queryClient.invalidateQueries({ queryKey: queryKeys.resume(scope, 'Audio') });
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.all(scope), 'played'] });
  if (item?.Id) void queryClient.invalidateQueries({ queryKey: queryKeys.item(scope, item.Id) });
}

let session: AudioSession | null = null;

export function audioSession(): AudioSession {
  session ??= new AudioSession();
  return session;
}
