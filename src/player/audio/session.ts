/**
 * The audio playback session: owns the queue, drives the audio engine,
 * keeps the shared player store current, reports progress per track,
 * keeps long-form positions, runs the sleep timer and saves the queue so
 * it comes back after a restart.
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
import { isOffline } from '@/lib/online';
import { randomId } from '@/lib/id';
import { toast } from '@/lib/toast';
import { bitrateFor, usePlaybackSettings } from '@/settings/playback';
import { readJson, writeJson } from '@/storage/json';
import { storage } from '@/storage/kv';

import { mediaCapabilities } from '../capabilities';
import { controlGate, queueGate, togglePauses, type UserControl } from '../control-gate';
import { buildDeviceProfile } from '../device-profile';
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
  restoreQueue,
  setShuffle,
  upcomingEntries,
  upcomingEntry,
  upcomingIndex,
} from './queue';
import { isCatalogSong } from './catalog';
import { sleepDue, sleepFadeVolume, sleepOff, type SleepTimer } from './sleep-timer';
import { audioState, initialAudioState, setAudioState } from './store';
import { formatLine, predictPlayMethod, universalAudioUrl } from './stream-url';

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

  constructor() {
    this.engine.subscribe(this.onEngine);
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
        if (e.duration > 0 && Math.abs(e.duration - st.duration) > 0.5) patch.duration = e.duration;
        if (e.playing !== st.playing) {
          patch.playing = e.playing;
          this.reporter?.tick(e.playing ? 'Unpause' : 'Pause');
          if (!e.playing) this.saveNow();
        }
        setPlayerState(patch);
        this.measureGap(key, e.position, e.duration);
        this.throttledSaves(e.position);
        break;
      }
      case 'track':
        this.onTrack(e.key);
        break;
      case 'ended':
        void this.onQueueEnd();
        break;
      case 'error':
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
  private onTrack(key: string) {
    const q = audioState().queue;
    const up = upcomingIndex(q);
    const prev = currentEntry(q);
    let index: number;
    if (up !== null && q.entries[up]?.key === key) index = up;
    else index = q.entries.findIndex((en) => en.key === key);
    if (index < 0) return;
    const natural = index === up;
    const last = this.lastStatus;
    if (natural && last && prev && last.key === prev.key) {
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
    this.trackListeners.forEach((l) => l(entry.key));
    // Sleep timer "end of track": the next track has already begun, so pause it at its start.
    const sleep = audioState().sleep;
    if (sleepDue(sleep, { now: Date.now(), itemKey: entry.key, position: 0, trackEnded: true }) && sleep.kind === 'end') {
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
  }

  private async onQueueEnd() {
    const id = this.loadId;
    const q = audioState().queue;
    const entry = currentEntry(q);
    await this.finishReporter(playerState().duration);
    // A track started (or the player stopped) during the last report: that one owns the engine now.
    if (id !== this.loadId) return;
    if (entry && audioState().longForm) void this.finishedLongItem(entry.item);
    // A catalog song was not preloaded (nextTrackFor): the queue goes on with it here.
    // The sleep timer "end of track" stops here as before.
    const nq = audioState().sleep.kind === 'end' ? null : advance(audioState().queue);
    const target = nq ? currentEntry(nq) : null;
    if (nq && target && isCatalogSong(target.item)) {
      setAudioState({ queue: nq, resumedAt: null });
      void this.startCurrent({ autoplay: true, startSeconds: 0 });
      return;
    }
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

  private trackFor(entry: QueueEntry<AudioItem> | null): EngineTrack | null {
    if (!entry) return null;
    const profile = buildDeviceProfile(mediaCapabilities(), { maxBitrate: this.bitrate || bitrateFor(usePlaybackSettings.getState(), false) });
    const playSessionId = randomId().replace(/-/g, '');
    const sharedUri = this.shared?.(entry.item) ?? null;
    if (sharedUri) {
      this.tracks.set(entry.key, { playSessionId, playMethod: 'DirectPlay', url: sharedUri });
      return { key: entry.key, uri: sharedUri };
    }
    // A guest with no file for this track streams it from the server only when it is signed in to that server.
    const active = useSessionStore.getState().session?.serverId;
    if (this.shared && (!active || (entry.item.ServerId && entry.item.ServerId !== active))) return null;
    // A downloaded track plays from the device; the server URL is built only when it is not.
    // A download from any saved server plays from the device.
    // The server (and a sign-in) is needed only for a track that is not on the device.
    const choice = chooseMedia(findDownload(entry.item.Id), documentsDir(), null, () => {
      const { server, userId } = context();
      return universalAudioUrl(server, entry.item.Id, profile, { userId, maxBitrate: profile.MaxStreamingBitrate ?? this.bitrate, playSessionId });
    });
    const playMethod = choice.kind === 'local' ? 'DirectPlay' : predictPlayMethod(entry.item, profile, profile.MaxStreamingBitrate ?? this.bitrate);
    this.tracks.set(entry.key, { playSessionId, playMethod, url: choice.uri });
    return { key: entry.key, uri: choice.uri };
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
    const q = audioState().queue;
    const entry = currentEntry(q);
    if (!entry) return;
    await this.finishReporter(this.engine.loaded ? this.engine.position : playerState().position);
    this.bitrate = bitrateFor(usePlaybackSettings.getState(), await onCellular());
    if (id !== this.loadId) return;
    const duration = ticksToSecondsExact(entry.item.RunTimeTicks);
    let start = opts.startSeconds ?? 0;
    let resumed = false;
    if (opts.startSeconds === undefined && (audioState().longForm || isLongFormItem(entry.item))) {
      start = resumeSeconds(this.positions.get(entry.item.Id), ticksToSecondsExact(entry.item.UserData?.PlaybackPositionTicks), duration);
      resumed = start > 0;
    }
    const current = this.trackFor(entry);
    if (!current) {
      // The queue has moved to this entry: the old track must not play on under it.
      this.engine.unload();
      this.publish(entry, start, 'loading');
      setPlayerState({ status: 'error', error: 'This track is not on this device. Sign in to its server to play it.', playing: false });
      return;
    }
    const nextEntry = upcomingEntry(q);
    const next = nextEntry ? this.nextTrackFor(nextEntry) : null;
    this.publish(entry, start, 'loading');
    setAudioState({ resumedAt: resumed ? Date.now() : null });
    // In a session the group rate applies (the session sets it).
    if (!controlGate.active) {
      const rate = audioState().longForm ? Number(storage.getString(RATE_KEY) ?? '1') || 1 : 1;
      this.engine.setRate(rate);
      setPlayerState({ rate });
    }
    await this.engine.load(current, next, start, opts.autoplay);
    if (id !== this.loadId) return;
    this.trackListeners.forEach((l) => l(entry.key));
    this.startReporter(entry);
    this.afterTrackStart(entry);
    this.watchAppState();
    this.persistQueue();
  }

  private startReporter(entry: QueueEntry<AudioItem>) {
    // A nearby guest plays the host's queue: its server does not get progress for it.
    if (this.shared && this.sharedNoReports) return;
    const info = this.tracks.get(entry.key);
    const other = foreignRecord(entry.item.Id);
    if (other) {
      // Another server's download: its progress goes only into the outbox, for that server and user.
      const reporter = new ProgressReporter(
        outboxOnly({ serverId: other.serverId, userId: other.userId, runTimeTicks: entry.item.RunTimeTicks ?? null }),
        () => {
          const st = playerState();
          return {
            positionTicks: secondsToTicks(this.engine.loaded ? this.engine.position : st.position),
            isPaused: !st.playing,
            isMuted: false,
            playbackRate: st.rate,
            audioStreamIndex: null,
            subtitleStreamIndex: null,
          };
        },
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
      () => {
        const st = playerState();
        return {
          positionTicks: secondsToTicks(this.engine.loaded ? this.engine.position : st.position),
          isPaused: !st.playing,
          isMuted: false,
          playbackRate: st.rate,
          audioStreamIndex: null,
          subtitleStreamIndex: null,
        };
      },
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
    if (!this.engine.loaded) return;
    const q = audioState().queue;
    const next = upcomingEntry(q);
    if (next && this.engine.nextKey === next.key && this.tracks.has(next.key)) {
      this.engine.setNext({ key: next.key, uri: this.tracks.get(next.key)?.url ?? '' });
    } else {
      this.engine.setNext(this.nextTrackFor(next));
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
  }

  // ---- Public API ------------------------------------------------------------------

  /** True (with a toast) when a listen-together host owns the queue. */
  private queueLocked(): boolean {
    const message = queueGate.locked;
    if (message) toast(message, { icon: 'lock.fill' });
    return message !== null;
  }

  private gate(c: UserControl): boolean {
    return controlGate.intercept(c);
  }

  /** Plays a request: a song with its album, a container (album, artist, playlist, genre) or a single item. */
  async play(request: PlayRequest): Promise<void> {
    if (this.queueLocked()) return;
    const id = ++this.loadId;
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
      if (id !== this.loadId) return;
      setPlayerState({ status: 'error', error: describeError(e).title });
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  }

  async playList(items: BaseItemDto[], startIndex: number, opts: { shuffle: boolean; source: QueueSource | null; longForm: boolean; startSeconds?: number }) {
    const q = playNow(items.map(slimItem), startIndex, { shuffle: opts.shuffle, source: opts.source, repeat: audioState().queue.repeat });
    this.tracks.clear();
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
    if (togglePauses(playerState().playing)) this.pause();
    else this.resume();
  }

  resume(): void {
    if (this.gate({ action: 'play' })) return;
    this.doResume();
  }

  private doResume(): void {
    if (!this.engine.loaded) {
      const st = playerState();
      void this.startCurrent({ autoplay: true, startSeconds: st.status === 'ended' ? 0 : st.position });
      return;
    }
    this.engine.play();
  }

  pause(): void {
    if (this.gate({ action: 'pause' })) return;
    this.doPause();
  }

  private doPause(): void {
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
    this.engine.seekTo(target);
    this.reporter?.tick('Seek');
    setAudioState({ resumedAt: null });
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
    this.engine.setVolume(1);
    if (timer.kind === 'off') return;
    this.sleepHandle = setInterval(() => {
      const t = audioState().sleep;
      const now = Date.now();
      const entry = currentEntry(audioState().queue);
      this.engine.setVolume(sleepFadeVolume(t, now));
      if (sleepDue(t, { now, itemKey: entry?.key ?? null, position: this.engine.position, trackEnded: false })) {
        this.pause();
        this.engine.setVolume(1);
        this.setSleep(sleepOff);
        toast('Sleep timer: paused', { icon: 'checkmark' });
      }
    }, 1000);
  }

  // ---- Listen together ---------------------------------------------------------------

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
    this.loadId++;
    this.saveNow();
    await this.finishReporter(this.engine.loaded ? this.engine.position : playerState().position);
    this.engine.unload();
    this.setSleep(sleepOff);
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
