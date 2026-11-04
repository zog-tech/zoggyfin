/**
 * The video playback session: asks the server how to play an item, drives
 * the engine, keeps the shared store current and reports progress.
 * One session at a time; screens use it through `usePlayer()`.
 */
import type { Api } from '@jellyfin/sdk';
import * as Network from 'expo-network';
import { AppState, type NativeEventSubscription } from 'react-native';

import { getApi } from '@/api/client';
import { describeError, errorText } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { checkDownloadedFiles, type DownloadRecord, findDownload, localExtraUri, localFileFor, readLocalText } from '@/downloads';
import { outboxPosition } from '@/downloads/outbox-store';
import { useDownloadsStore } from '@/downloads/store';
import { resolveImage } from '@/images/resolve-image';
import { isOffline } from '@/lib/online';
import { bitrateFor, usePlaybackSettings } from '@/settings/playback';

import { mediaCapabilities } from './capabilities';
import { controlGate, togglePauses } from './control-gate';
import { playRouter } from './play-router';
import { buildDeviceProfile } from './device-profile';
import { getEngine } from './engine';
import { sameEmbeddedTracks } from './embedded-tracks';
import type { EmbeddedTracks, EngineEvent } from './engine-types';
import { isForeignDownload, outboxOnly, withOutbox } from './outbox-transport';
import { ProgressReporter, type ProgressTransport, secondsToTicks, ticksToSecondsExact, toServerReport } from './progress-reporter';
import { normalizeSegments } from './segments';
import { chooseTracks, rememberChoice, titleKey } from './track-prefs';
import { loadTrackPrefs, saveTrackPrefs } from './track-prefs-store';
import { setPlayerState, initialPlayerState, playerState, type LiveNow, type NowPlaying, type VodNow } from './store';
import { audioOptions, audioSwitchNeedsStream, pickSource, planStream, playbackInfoBody, type StreamPlan, type StreamServer } from './stream';
import { chaptersOf, pickTrickplay } from './timeline';
import type { LivePlayRequest, LiveStreamChoice, PlayRequest, VodPlayRequest, VodRef } from './types';
import { parseVtt } from './vtt';
import { type LiveRestarts, nextLiveRestart } from './live-restart';
import { tsBridge } from '@/native/ts-bridge';

interface Ctx {
  api: Api;
  userId: string;
  serverId: string;
  server: StreamServer;
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

/** A completed download of this item, from any saved server, or null. It plays from the device. */
function downloaded(itemId: string | null | undefined): DownloadRecord | null {
  const r = findDownload(itemId);
  return r && r.state === 'completed' && localFileFor(r.itemId) ? r : null;
}

/** True when the download is from a server that is not the active one: no server calls for it. */
function foreign(r: DownloadRecord): boolean {
  const active = useSessionStore.getState().session?.serverId;
  // With no account signed in, every download counts as another server's: no server calls, progress to the outbox.
  return !active || isForeignDownload(r, active);
}

/** The stream plan for a downloaded file: the file itself, with its saved subtitles. */
function localPlan(r: DownloadRecord, uri: string): StreamPlan {
  const source = r.item.MediaSources?.[0] ?? {};
  const audio = r.method === 'original' ? audioOptions(source) : [];
  return {
    url: uri,
    isHls: false,
    playMethod: 'DirectPlay',
    mediaSourceId: r.mediaSourceId,
    playSessionId: null,
    audio,
    subtitles: r.subtitles.map((sub) => ({
      index: sub.index,
      label: sub.label,
      language: sub.language,
      isDefault: sub.isDefault,
      isForced: sub.isForced,
      isText: true,
      url: localExtraUri(r, sub.file),
    })),
    audioIndex: audio.find((a) => a.isDefault)?.index ?? audio[0]?.index ?? null,
    subtitleIndex: null,
    burnedSubtitle: false,
    isLocal: true,
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

function artworkUrl(item: BaseItemDto, server: StreamServer): string | undefined {
  try {
    const img = resolveImage(item, 'landscape', { width: 640, height: 360 }, { baseUrl: server.baseUrl, token: server.token });
    return img.kind === 'remote' && !img.crop ? img.uri : undefined;
  } catch {
    return undefined;
  }
}

function subtitleLine(item: BaseItemDto): string | undefined {
  if (item.Type === 'Episode') {
    const se = item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} E${item.IndexNumber}` : null;
    return [item.SeriesName, se].filter(Boolean).join(' · ') || undefined;
  }
  return item.ProductionYear ? String(item.ProductionYear) : undefined;
}

/** The plan of a live stream: no Jellyfin source, no tracks, no quality choice. */
function livePlan(url: string, isHls: boolean): StreamPlan {
  return {
    url,
    isHls,
    playMethod: 'DirectStream',
    mediaSourceId: '',
    playSessionId: null,
    audio: [],
    subtitles: [],
    audioIndex: null,
    subtitleIndex: null,
    burnedSubtitle: false,
  };
}

/** The artwork for the lock screen: only http(s) logos (a data or file URI is not one the system loads). */
function liveArtwork(logo: string | null): string | undefined {
  return logo && /^https?:\/\//i.test(logo) ? logo : undefined;
}

/** The item the player screen, the mini player and the next-up card show for an IPTV film or episode. */
function vodItem(ref: VodRef, providerId: string): BaseItemDto {
  const item: BaseItemDto = { Id: `iptv-vod:${providerId}:${ref.kind}:${ref.id}`, Name: ref.title, Type: ref.kind === 'episode' ? 'Episode' : 'Movie' };
  if (ref.kind === 'episode') {
    item.SeriesName = ref.seriesName;
    item.ParentIndexNumber = ref.season;
    item.IndexNumber = ref.episode;
  } else if (ref.year) item.ProductionYear = ref.year;
  if (ref.duration) item.RunTimeTicks = secondsToTicks(ref.duration);
  return item;
}

/** How often the position of a film or an episode is saved while it plays (ms). */
const VOD_SAVE_MS = 10_000;

/** The streams of the live channel that loads now, and the next one to try. */
interface LiveAttempt {
  id: number;
  candidates: LiveStreamChoice[];
  next: number;
  userAgent: string | null;
  unsupported: string | null;
  /** The TS bridge session this attempt started (iOS), stopped when the attempt ends. */
  bridgeId?: string;
  /** The stream played: a later failure restarts the channel by itself (`live-restart.ts`). */
  played?: boolean;
}

interface LoadOptions {
  startSeconds: number;
  audioIndex?: number | null;
  subtitleIndex?: number | null;
  bitrateChoice?: number | null;
  forceStream?: boolean;
  autoplay?: boolean;
}

class VideoSession {
  private engine = getEngine();
  private reporter: ProgressReporter | null = null;
  private appState: NativeEventSubscription | null = null;
  /** Guards against an old load finishing after a newer one started. */
  private loadId = 0;
  private lastRequest: PlayRequest | null = null;
  /** The live channel that plays (or loads), for Try Again and the next stream form. */
  private liveAttempt: LiveAttempt | null = null;
  /** The recent automatic restarts of the live channel that plays. */
  private liveRestarts: LiveRestarts | null = null;
  /** The IPTV film or episode that loads or plays, with its stream forms. */
  private vodAttempt: (LiveAttempt & { start: number }) | null = null;
  /** The film or episode has played: its position may be saved (a failed load must not wipe a saved one). */
  private vodPlayed = false;
  private vodSavedAt = 0;
  /** IPTV: the saved track choice was applied to the stream that loads (once per kind and load). */
  private tracksApplied = { audio: false, subtitle: false };

  constructor() {
    this.engine.subscribe(this.onEngine);
    useDownloadsStore.subscribe((s, prev) => {
      const itemId = playerState().now?.item.Id;
      if (itemId && s.records[itemId] !== prev.records[itemId]) void this.switchToDownload(itemId);
    });
  }

  /**
   * The download of the streamed item completed: the item continues from the
   * file at the same position. Not in a together session, where the group
   * keeps one timeline.
   */
  private async switchToDownload(itemId: string): Promise<void> {
    const st = playerState();
    const now = st.now;
    if (!now || now.kind !== 'video' || now.live || now.vod || now.plan.isLocal || now.item.Id !== itemId) return;
    if (st.status === 'error' || st.status === 'ended' || playRouter.active || controlGate.active) return;
    const r = downloaded(itemId);
    if (!r) return;
    const id = ++this.loadId;
    const position = this.engine.position || st.position;
    const request: PlayRequest = { item: now.item, queue: now.queue, startPositionTicks: secondsToTicks(position), autoplay: st.playing };
    // The server's stream (and its transcode) stops; the file then plays in a new player.
    await this.finishCurrent();
    if (id !== this.loadId) return;
    this.lastRequest = request;
    try {
      await this.playLocal(id, r, request);
    } catch (e) {
      if (id !== this.loadId) return;
      console.warn('[player] switch to the download failed', e);
      setPlayerState({ status: 'error', error: errorText(e) });
    }
  }

  private onEngine = (e: EngineEvent) => {
    const st = playerState();
    if (!st.now) return;
    switch (e.type) {
      case 'status':
        if (e.status === 'error') {
          if (st.now.live) {
            if (this.restartLive()) break;
            this.liveFailed(e.error);
            break;
          }
          if (st.now.vod) {
            this.vodFailed(e.error);
            break;
          }
          if (this.recoverAfterAddressSwitch()) break;
          setPlayerState({ status: 'error', error: e.error ?? 'The video could not be played.' });
          void this.reporter?.stop({ positionTicks: secondsToTicks(st.position) });
        } else if (e.status === 'loading') setPlayerState({ status: st.status === 'loading' ? 'loading' : 'buffering' });
        else if (e.status === 'ready') setPlayerState({ status: 'ready' });
        break;
      case 'playing':
        if (e.playing !== st.playing) {
          setPlayerState({ playing: e.playing });
          this.reporter?.tick(e.playing ? 'Unpause' : 'Pause');
          if (e.playing && st.now.live && this.liveAttempt) this.liveAttempt.played = true;
          if (st.now.vod) {
            if (e.playing) this.vodPlayed = true;
            else this.saveVod(false);
          }
        }
        break;
      case 'time':
        setPlayerState({ position: e.position, buffered: e.buffered });
        if (st.now.vod && this.vodPlayed && e.position >= 5 && Date.now() - this.vodSavedAt >= VOD_SAVE_MS) this.saveVod(false);
        break;
      case 'duration':
        // A live stream has no length (some players report the size of the live window).
        if (e.duration > 0 && !st.now.live) setPlayerState({ duration: e.duration });
        break;
      case 'rate':
        setPlayerState({ rate: e.rate });
        break;
      case 'muted':
        setPlayerState({ muted: e.muted });
        break;
      case 'pip':
        setPlayerState({ pip: e.active });
        break;
      case 'video':
        setPlayerState({ video: e.video });
        break;
      case 'ended':
        if (st.now.live) setPlayerState({ status: 'error', error: 'The channel stopped sending.', playing: false });
        else {
          if (st.now.vod) this.saveVod(true);
          void this.onEnded();
        }
        break;
      case 'remote':
        if (st.now.live) this.zap(e.command === 'next' ? 1 : -1);
        else if (e.command === 'next' && st.now.next) void this.playNext();
        break;
      case 'embedded':
        // Jellyfin items use the server's streams; only IPTV has no other list.
        if (st.now.live || st.now.vod) this.onEmbedded(e.tracks);
        break;
    }
  };

  /** IPTV: the key the track choice of the title that plays is kept by (a series shares one). */
  private trackKey(): string | null {
    const now = playerState().now;
    if (now?.vod) {
      const ref = now.vod.items[now.vod.index];
      if (!ref) return null;
      return titleKey(now.vod.source.providerId, ref.kind === 'episode' ? { kind: 'series', id: ref.seriesId ?? ref.id } : { kind: 'film', id: ref.id });
    }
    const live = now?.live;
    const ch = live?.channels[live.index];
    if (!live || !ch) return null;
    const t = live.source.titleOf?.(ch.id) ?? { providerId: live.source.providerId, channelId: ch.id };
    return titleKey(t.providerId, { kind: 'live', id: t.channelId });
  }

  /** A new stream loads: its tracks are not known yet. */
  private resetEmbedded(): void {
    this.tracksApplied = { audio: false, subtitle: false };
    if (playerState().embedded) setPlayerState({ embedded: null });
  }

  /** The engine listed the stream's tracks: show them, and select the saved choice the first time. */
  private onEmbedded(tracks: EmbeddedTracks): void {
    const prev = playerState().embedded;
    if (!prev || !sameEmbeddedTracks(prev, tracks)) setPlayerState({ embedded: tracks });
    const engine = this.engine.embedded;
    const key = this.trackKey();
    const audio = !this.tracksApplied.audio && tracks.audio.length > 0;
    const subtitle = !this.tracksApplied.subtitle && tracks.subtitles.length > 0;
    if (!engine || !key || (!audio && !subtitle)) return;
    const choice = chooseTracks(tracks, loadTrackPrefs(), key);
    if (audio) {
      this.tracksApplied.audio = true;
      if (choice.audioId !== undefined) engine.selectAudio(choice.audioId);
    }
    if (subtitle) {
      this.tracksApplied.subtitle = true;
      if (choice.subtitleId !== undefined) engine.selectSubtitle(choice.subtitleId);
    }
  }

  /** IPTV: plays another audio track of the stream, and keeps the choice for the title. */
  selectEmbeddedAudio(id: string): void {
    const t = playerState().embedded;
    const track = t?.audio.find((x) => x.id === id);
    if (!t || !track || !this.engine.embedded || t.audioId === id) return;
    this.engine.embedded.selectAudio(id);
    setPlayerState({ embedded: { ...t, audioId: id } });
    const key = this.trackKey();
    if (key) saveTrackPrefs(rememberChoice(loadTrackPrefs(), key, 'audio', track, Date.now()));
  }

  /** IPTV: shows a subtitle of the stream (null: off), and keeps the choice for the title. */
  selectEmbeddedSubtitle(id: string | null): void {
    const t = playerState().embedded;
    const track = id === null ? null : t?.subtitles.find((x) => x.id === id);
    if (!t || track === undefined || !this.engine.embedded || t.subtitleId === id) return;
    this.engine.embedded.selectSubtitle(id);
    setPlayerState({ embedded: { ...t, subtitleId: id } });
    const key = this.trackKey();
    if (key) saveTrackPrefs(rememberChoice(loadTrackPrefs(), key, 'subtitle', track, Date.now()));
  }

  private snapshot = () => {
    const st = playerState();
    return {
      positionTicks: secondsToTicks(this.engine.position || st.position),
      isPaused: !st.playing,
      isMuted: st.muted,
      playbackRate: st.rate,
      audioStreamIndex: st.now?.plan.audioIndex ?? null,
      subtitleStreamIndex: st.now?.plan.subtitleIndex ?? null,
    };
  };

  private makeReporter(api: Api, item: BaseItemDto): ProgressReporter {
    const s = useSessionStore.getState().session;
    const transport: ProgressTransport = {
        start: (r) => jf.reportPlaybackStart(api, toServerReport(r)),
        progress: (r) => jf.reportPlaybackProgress(api, toServerReport(r)),
        stopped: (r) =>
          jf.reportPlaybackStopped(api, {
            ItemId: r.itemId,
            MediaSourceId: r.mediaSourceId,
            PlaySessionId: r.playSessionId,
            PositionTicks: r.positionTicks,
          }),
    };
    return new ProgressReporter(
      s ? withOutbox(transport, { serverId: s.serverId, userId: s.userId, runTimeTicks: item.RunTimeTicks ?? null }) : transport,
      this.snapshot,
      undefined,
      undefined,
      (e) => console.warn('[player] progress report failed', describeError(e).title),
    );
  }

  /** Starts an item. Containers (show, season, collection) resolve to an episode or item first. */
  async play(request: PlayRequest): Promise<void> {
    const id = ++this.loadId;
    // A server item replaces a live channel: its TS bridge session (iOS) ends too.
    this.endLiveAttempt();
    this.vodAttempt = null;
    await this.finishCurrent();
    this.lastRequest = request;
    setPlayerState({ ...initialPlayerState, status: 'loading', presentation: 'full' });
    try {
      // A download whose file is gone becomes "not downloaded" here: the item then streams from the server.
      await checkDownloadedFiles([request.item.Id]);
      if (id !== this.loadId) return;
      const local = downloaded(request.item.Id);
      if (local) {
        await this.playLocal(id, local, request);
        return;
      }
      const { api, userId } = context();
      const target = await jf.resolvePlayable(api, userId, request.item);
      if (!target?.Id) throw new Error('Nothing to play here yet.');
      if (target.Id !== request.item.Id) {
        // A show or season resolved to an episode: a download of that episode plays from the device.
        await checkDownloadedFiles([target.Id]);
        if (id !== this.loadId) return;
        const localTarget = downloaded(target.Id);
        if (localTarget) {
          await this.playLocal(id, localTarget, request);
          return;
        }
      }
      // The full item has chapters, trickplay info and the user's position.
      const item = await jf.getItem(api, userId, target.Id);
      if (id !== this.loadId) return;
      const resume = ticksToSecondsExact(item.UserData?.PlaybackPositionTicks);
      const start =
        request.startPositionTicks !== undefined
          ? ticksToSecondsExact(request.startPositionTicks)
          : target === request.item || target.Id === request.item.Id
            ? resume
            : ticksToSecondsExact(target.UserData?.PlaybackPositionTicks);
      await this.load(id, item, request.queue ?? [], { startSeconds: start, autoplay: request.autoplay });
    } catch (e) {
      if (id !== this.loadId) return;
      console.warn('[player] play failed', e);
      setPlayerState({ status: 'error', error: errorText(e) });
    }
  }

  /** Plays a downloaded file. The server is asked for the saved position only when it answers. */
  private async playLocal(id: number, r: DownloadRecord, request: PlayRequest): Promise<void> {
    const other = foreign(r);
    let item: BaseItemDto = r.item;
    if (!isOffline() && !other) {
      const { api, userId } = context();
      try {
        const fresh = await Promise.race([
          jf.getItem(api, userId, r.itemId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (fresh) item = { ...r.item, UserData: fresh.UserData, Chapters: fresh.Chapters ?? r.item.Chapters, Trickplay: fresh.Trickplay };
      } catch {
        // Offline: the saved facts are enough.
      }
    }
    if (id !== this.loadId) return;
    const uri = localFileFor(r.itemId);
    if (!uri) throw new Error('The downloaded file is missing. Download it again.');
    const plan = localPlan(r, uri);
    // With no fresh facts from the server, a position that waits in the outbox is the newest one.
    const pending = item === r.item ? outboxPosition(r.serverId, r.userId, r.itemId) : null;
    const start =
      request.startPositionTicks !== undefined
        ? ticksToSecondsExact(request.startPositionTicks)
        : ticksToSecondsExact(pending ?? item.UserData?.PlaybackPositionTicks);
    const queue = request.queue ?? [];
    setPlayerState({
      now: {
        kind: 'video',
        item,
        queue,
        plan,
        segments: [],
        chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
        trickplay: isOffline() || other ? null : pickTrickplay(item.Trickplay, plan.mediaSourceId),
        bitrateChoice: null,
        bitrate: 0,
        next: queue[0] ?? null,
      },
      status: 'loading',
      error: null,
      position: start,
      duration: ticksToSecondsExact(item.RunTimeTicks),
      cues: null,
      video: null,
    });
    this.engine.load({
      uri,
      isHls: false,
      startSeconds: start,
      title: item.Name ?? 'Video',
      subtitle: subtitleLine(item),
      artworkUri: undefined,
      autoplay: request.autoplay,
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);
    this.reporter = this.localReporter(r, item);
    this.reporter.start({ itemId: r.itemId, mediaSourceId: plan.mediaSourceId, playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
    this.watchAppState();
    const def = plan.subtitles.find((sub) => sub.isDefault);
    if (def) void this.selectSubtitle(def.index);
  }

  /**
   * The reporter of a download: the active server (with the outbox when it
   * does not answer), or for another server's download only the outbox,
   * tagged with that server and user.
   */
  private localReporter(r: DownloadRecord, item: BaseItemDto): ProgressReporter {
    if (!foreign(r)) return this.makeReporter(context().api, item);
    return new ProgressReporter(
      outboxOnly({ serverId: r.serverId, userId: r.userId, runTimeTicks: item.RunTimeTicks ?? null }),
      this.snapshot,
      undefined,
      undefined,
      (e) => console.warn('[player] progress report failed', describeError(e).title),
    );
  }

  /**
   * Plays a file the server did not plan: this device's download, or a
   * nearby host's file (watch together). Needs no server. Progress of a
   * download goes to its own server (see `localReporter`).
   */
  async playSource(src: { item: BaseItemDto; uri: string; startSeconds: number; autoplay: boolean; record: DownloadRecord | null; readAhead?: number }): Promise<void> {
    const id = ++this.loadId;
    await this.finishCurrent();
    if (id !== this.loadId) return;
    this.lastRequest = null;
    const r = src.record;
    const item = r?.item ?? src.item;
    const plan: StreamPlan = r
      ? localPlan(r, src.uri)
      : {
          url: src.uri,
          isHls: false,
          playMethod: 'DirectPlay',
          mediaSourceId: item.MediaSources?.[0]?.Id ?? '',
          playSessionId: null,
          audio: [],
          subtitles: [],
          audioIndex: null,
          subtitleIndex: null,
          burnedSubtitle: false,
          isLocal: true,
          fromPeer: true,
        };
    setPlayerState({
      ...initialPlayerState,
      presentation: 'full',
      now: {
        kind: 'video',
        item,
        queue: [],
        plan,
        segments: [],
        chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
        trickplay: null,
        bitrateChoice: null,
        bitrate: 0,
        next: null,
      },
      status: 'loading',
      position: src.startSeconds,
      duration: ticksToSecondsExact(item.RunTimeTicks),
    });
    this.engine.load({ uri: src.uri, isHls: false, startSeconds: src.startSeconds, title: item.Name ?? 'Video', subtitle: subtitleLine(item), autoplay: src.autoplay, readAhead: src.readAhead });
    if (r) {
      this.reporter = this.localReporter(r, item);
      this.reporter.start({ itemId: r.itemId, mediaSourceId: plan.mediaSourceId, playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
      this.watchAppState();
    }
    const def = plan.subtitles.find((sub) => sub.isDefault);
    if (def) void this.selectSubtitle(def.index);
  }

  /**
   * Plays a live channel (IPTV). The source gives the streams to try; the
   * next one loads when one fails, and the source's message shows when none
   * plays. No Jellyfin item and no progress reports. `presentation` keeps
   * the current one (channel up and down from the mini player).
   */
  async playLive(request: LivePlayRequest, opts: { keepPresentation?: boolean } = {}): Promise<void> {
    const id = ++this.loadId;
    const presentation = opts.keepPresentation ? playerState().presentation : 'full';
    await this.finishCurrent();
    if (id !== this.loadId) return;
    this.lastRequest = null;
    this.endLiveAttempt();
    const index = Math.min(Math.max(0, request.index), request.channels.length - 1);
    const ch = request.channels[index];
    if (!ch) return;
    const live: LiveNow = { channels: request.channels, index, source: request.source };
    const t = request.source.titleOf?.(ch.id) ?? { providerId: request.source.providerId, channelId: ch.id };
    const item: BaseItemDto = { Id: `iptv:${t.providerId}:${t.channelId}`, Name: ch.name, Type: 'TvChannel' };
    setPlayerState({
      ...initialPlayerState,
      rate: 1,
      presentation,
      now: { kind: 'video', item, queue: [], plan: livePlan('', false), segments: [], chapters: [], trickplay: null, bitrateChoice: null, bitrate: 0, next: null, live },
      status: 'loading',
    });
    const stream = await request.source.resolve(ch.id);
    if (id !== this.loadId) return;
    this.liveAttempt = { id, candidates: stream.candidates, next: 0, userAgent: stream.userAgent, unsupported: stream.unsupported };
    request.source.onStart?.(ch.id);
    // No stream form for this device (a plain .ts channel on iOS): say so at once.
    if (!this.loadNextLive()) this.liveFailed(undefined);
  }

  /** Ends the live attempt and its TS bridge session, if any. */
  private endLiveAttempt(): void {
    const bridgeId = this.liveAttempt?.bridgeId;
    this.liveAttempt = null;
    if (bridgeId) void tsBridge?.stop(bridgeId).catch(() => undefined);
  }

  /** Loads the next stream form of the live channel, or shows why it does not play. True when one loads. */
  private loadNextLive(): boolean {
    const a = this.liveAttempt;
    const now = playerState().now;
    const live = now?.live;
    if (!a || !now || !live || a.id !== this.loadId) return false;
    const choice = a.candidates[a.next];
    if (!choice) return false;
    a.next++;
    if (choice.bridge) {
      if (!tsBridge) return this.loadNextLive();
      setPlayerState({ status: 'loading', error: null });
      // The bridge waits for its first segments (a few seconds), then serves a local HLS playlist.
      const headers: Record<string, string> = a.userAgent ? { 'User-Agent': a.userAgent } : {};
      tsBridge.start(choice.url, headers).then(
        (session) => {
          if (this.liveAttempt !== a || a.id !== this.loadId) {
            void tsBridge?.stop(session.id).catch(() => undefined);
            return;
          }
          a.bridgeId = session.id;
          this.loadLiveSource(a, { url: session.playlistUrl, isHls: true });
        },
        () => {
          // Never show the bridge's error: it may hold the stream URL. The attempt's message says enough.
          if (this.liveAttempt === a && a.id === this.loadId) this.liveFailed(undefined);
        },
      );
      return true;
    }
    this.loadLiveSource(a, choice);
    return true;
  }

  /** Points the engine at one stream form of the live channel. */
  private loadLiveSource(a: LiveAttempt, choice: LiveStreamChoice): void {
    const now = playerState().now;
    const live = now?.live;
    if (!now || !live) return;
    const ch = live.channels[live.index];
    setPlayerState({ now: { ...now, plan: livePlan(choice.url, choice.isHls) }, status: 'loading', error: null });
    this.resetEmbedded();
    this.engine.load({
      uri: choice.url,
      isHls: choice.isHls,
      startSeconds: 0,
      title: ch.name,
      subtitle: live.source.nowLine?.(ch.id) ?? (ch.group || 'Live TV'),
      artworkUri: liveArtwork(ch.logo),
      autoplay: true,
      userAgent: a.userAgent,
    });
  }

  /**
   * A live channel that played failed (broken data from the provider, or the
   * player stuck with no progress): start it again, a few times at most.
   */
  private restartLive(): boolean {
    const live = playerState().now?.live;
    const a = this.liveAttempt;
    if (!live || !a?.played || a.id !== this.loadId) return false;
    const ch = live.channels[live.index];
    const next = nextLiveRestart(this.liveRestarts, `${live.source.providerId}:${ch?.id ?? ''}`, Date.now());
    if (!next) return false;
    this.liveRestarts = next;
    if (__DEV__) console.log('[player] the live stream stopped: starting the channel again');
    this.retryLive();
    return true;
  }

  /** A live stream failed: try its next form, else show the source's message or the player's. */
  private liveFailed(error: string | undefined): void {
    if (this.loadNextLive()) return;
    const a = this.liveAttempt;
    // The player's own error text can hold the stream URL (and the credentials in it): never show it.
    const text = a?.unsupported ?? (error && !/https?:|\/\//i.test(error) ? error : null) ?? 'The channel could not be played.';
    setPlayerState({ status: 'error', error: text, playing: false });
    // The provider may say why (every stream of the account in use): that text replaces the general one.
    const live = playerState().now?.live;
    const ch = live?.channels[live.index];
    if (!a || a.unsupported || !live?.source.explainFailure || !ch) return;
    void live.source.explainFailure(ch.id).then(
      (why) => {
        if (why && this.liveAttempt === a && a.id === this.loadId && playerState().status === 'error') setPlayerState({ error: why });
      },
      () => undefined,
    );
  }

  /** Channel up (+1) or down (-1) in the list the channel was played from. */
  zap(delta: number): void {
    const live = playerState().now?.live;
    if (!live || live.channels.length < 2) return;
    const n = live.channels.length;
    const index = (((live.index + delta) % n) + n) % n;
    void this.playLive({ channels: live.channels, index, source: live.source }, { keepPresentation: true });
  }

  /** Switches to a channel of the current list (the channel list in the player). */
  playChannelAt(index: number): void {
    const live = playerState().now?.live;
    if (!live || index === live.index) return;
    void this.playLive({ channels: live.channels, index, source: live.source }, { keepPresentation: true });
  }

  /**
   * Plays an IPTV film or episode. The source gives the streams to try (the
   * next one loads when one fails) and keeps the positions on the device.
   * Seekable, with no Jellyfin item, no progress reports and no server calls.
   * The episode after `index` in `items` is the next-up episode.
   */
  async playVod(request: VodPlayRequest, opts: { keepPresentation?: boolean } = {}): Promise<void> {
    const id = ++this.loadId;
    const presentation = opts.keepPresentation ? playerState().presentation : 'full';
    await this.finishCurrent();
    if (id !== this.loadId) return;
    this.lastRequest = null;
    this.endLiveAttempt();
    this.vodAttempt = null;
    this.vodPlayed = false;
    this.vodSavedAt = Date.now();
    const index = Math.min(Math.max(0, request.index), request.items.length - 1);
    const ref = request.items[index];
    if (!ref) return;
    const providerId = request.source.providerId;
    const vod: VodNow = { items: request.items, index, source: request.source };
    const nextRef = request.items[index + 1];
    const start = Math.max(0, request.startSeconds ?? 0);
    setPlayerState({
      ...initialPlayerState,
      rate: playerState().rate,
      presentation,
      now: {
        kind: 'video',
        item: vodItem(ref, providerId),
        queue: [],
        plan: livePlan('', false),
        segments: [],
        chapters: [],
        trickplay: null,
        bitrateChoice: null,
        bitrate: 0,
        next: nextRef ? vodItem(nextRef, providerId) : null,
        vod,
      },
      status: 'loading',
      position: start,
      duration: ref.duration ?? 0,
    });
    const stream = await request.source.resolve(ref);
    if (id !== this.loadId) return;
    this.vodAttempt = { id, candidates: stream.candidates, next: 0, userAgent: stream.userAgent, unsupported: stream.unsupported, start };
    if (!this.loadNextVod()) this.vodFailed(undefined);
  }

  /** Loads the next stream form of the film or episode. True when one loads. */
  private loadNextVod(): boolean {
    const a = this.vodAttempt;
    const now = playerState().now;
    const vod = now?.vod;
    if (!a || !now || !vod || a.id !== this.loadId) return false;
    const choice = a.candidates[a.next];
    if (!choice) return false;
    a.next++;
    const ref = vod.items[vod.index];
    const subtitle =
      ref.kind === 'episode'
        ? [ref.seriesName, ref.season !== undefined && ref.episode !== undefined ? `S${ref.season} E${ref.episode}` : null].filter(Boolean).join(' · ')
        : ref.year
          ? String(ref.year)
          : '';
    // A form that failed after it played a while: the next one starts where it stopped.
    const start = this.vodPlayed ? this.engine.position || playerState().position : a.start;
    setPlayerState({ now: { ...now, plan: { ...livePlan(choice.url, choice.isHls), playMethod: 'DirectPlay' } }, status: 'loading', error: null });
    this.resetEmbedded();
    this.engine.load({
      uri: choice.url,
      isHls: choice.isHls,
      startSeconds: start,
      title: ref.title,
      subtitle: subtitle || undefined,
      artworkUri: liveArtwork(ref.poster),
      autoplay: true,
      userAgent: a.userAgent,
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);
    return true;
  }

  /** A film or episode stream failed: try its next form, else show why. */
  private vodFailed(error: string | undefined): void {
    if (this.loadNextVod()) return;
    const a = this.vodAttempt;
    // The player's own error text can hold the stream URL (and the credentials in it): never show it.
    const clean = error && !/https?:|\/\//i.test(error) ? error : null;
    // A form that never started: the format is the likely reason. One that played and stopped: the player's reason.
    const text = (this.vodPlayed ? clean : (a?.unsupported ?? clean)) ?? 'This title could not be played.';
    setPlayerState({ status: 'error', error: text, playing: false });
  }

  /** Gives the source the position of the film or episode that plays. */
  private saveVod(ended: boolean): void {
    const st = playerState();
    const vod = st.now?.vod;
    if (!vod || !this.vodPlayed) return;
    const ref = vod.items[vod.index];
    if (!ref) return;
    this.vodSavedAt = Date.now();
    const position = this.engine.position || st.position;
    try {
      vod.source.savePosition(ref, ended ? st.duration || position : position, st.duration, ended);
    } catch (e) {
      console.warn('[player] the position was not saved', e instanceof Error ? e.name : 'error');
    }
  }

  /** Starts the film or episode again where it was (Try again, a reload). */
  private restartVod(): void {
    const st = playerState();
    const vod = st.now?.vod;
    if (!vod) return;
    const position = this.vodPlayed ? this.engine.position || st.position : (this.vodAttempt?.start ?? st.position);
    void this.playVod({ items: vod.items, index: vod.index, source: vod.source, startSeconds: position }, { keepPresentation: true });
  }

  private async load(id: number, item: BaseItemDto, queue: BaseItemDto[], opts: LoadOptions): Promise<void> {
    const { api, userId, server } = context();
    const settings = usePlaybackSettings.getState();
    const bitrate = opts.bitrateChoice ?? bitrateFor(settings, await onCellular());
    const profile = buildDeviceProfile(mediaCapabilities(), { maxBitrate: bitrate });
    const current = playerState().now;
    const keep = current && current.item.Id === item.Id ? current : null;
    const sameItem = keep !== null;
    const keepSource = keep ? keep.plan.mediaSourceId : undefined;
    const info = await jf.getPlaybackInfo(
      api,
      item.Id ?? '',
      playbackInfoBody({
        userId,
        profile,
        maxBitrate: bitrate,
        startTicks: secondsToTicks(opts.startSeconds),
        mediaSourceId: keepSource,
        audioIndex: opts.audioIndex,
        subtitleIndex: opts.subtitleIndex,
        forceStream: opts.forceStream,
      }),
    );
    if (id !== this.loadId) return;
    const source = pickSource(info.MediaSources, keepSource);
    if (!source) throw new Error('The server has no playable version of this item.');
    const plan = planStream(server, item.Id ?? '', source, info.PlaySessionId ?? null, {
      audioIndex: opts.audioIndex,
      subtitleIndex: opts.subtitleIndex,
    });
    const next: NowPlaying = {
      kind: 'video',
      item,
      queue,
      plan,
      segments: keep ? keep.segments : [],
      chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
      trickplay: pickTrickplay(item.Trickplay, plan.mediaSourceId),
      bitrateChoice: opts.bitrateChoice ?? null,
      bitrate,
      next: keep ? keep.next : (queue[0] ?? null),
    };
    setPlayerState({
      now: next,
      status: 'loading',
      error: null,
      position: opts.startSeconds,
      duration: ticksToSecondsExact(item.RunTimeTicks) || playerState().duration,
      cues: sameItem ? playerState().cues : null,
      video: null,
    });
    this.engine.load({
      uri: plan.url,
      isHls: plan.isHls,
      startSeconds: opts.startSeconds,
      title: item.Name ?? 'Video',
      subtitle: subtitleLine(item),
      artworkUri: artworkUrl(item, server),
      autoplay: opts.autoplay,
      audioIndex: plan.audioIndex,
      streams: { audio: plan.audio.map((a) => a.index), subtitles: plan.subtitles.filter((x) => !x.isExternal).map((x) => x.index) },
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);

    this.reporter = this.makeReporter(api, item);
    this.reporter.start({
      itemId: item.Id ?? '',
      mediaSourceId: plan.mediaSourceId,
      playSessionId: plan.playSessionId,
      playMethod: plan.playMethod,
      canSeek: true,
    });
    this.watchAppState();

    if (!sameItem) {
      void this.loadExtras(id, api, userId, item, source.HasSegments !== false, queue);
      const def = plan.subtitles.find((s) => s.index === source.DefaultSubtitleStreamIndex && (s.isText || this.engineTracks(plan)));
      if (def && opts.subtitleIndex === undefined) void this.selectSubtitle(def.index);
    }
  }

  private async loadExtras(id: number, api: Api, userId: string, item: BaseItemDto, hasSegments: boolean, queue: BaseItemDto[]) {
    const [segments, next] = await Promise.all([
      hasSegments ? jf.getMediaSegments(api, item.Id ?? '') : Promise.resolve([]),
      item.Type === 'Episode' && !queue.length ? jf.getNextEpisode(api, userId, item).catch(() => null) : Promise.resolve(queue[0] ?? null),
    ]);
    if (id !== this.loadId) return;
    const now = playerState().now;
    if (!now || now.item.Id !== item.Id) return;
    setPlayerState({ now: { ...now, segments: normalizeSegments(segments), next } });
  }

  private watchAppState() {
    if (this.appState) return;
    this.appState = AppState.addEventListener('change', (s) => {
      if (s === 'background') this.reporter?.tick('Background');
    });
  }

  /** The stream URL that was reloaded after an address switch, so a second failure shows the error. */
  private recovered: string | null = null;

  /**
   * The app moved to another address of the server while this stream played
   * (`servers/connection.ts`). The stream keeps its old address until it
   * fails; then it starts again on the new address at the same position.
   * A transcode needs a new session for that, which `reload` asks for.
   */
  private recoverAfterAddressSwitch(): boolean {
    const now = playerState().now;
    const s = useSessionStore.getState().session;
    if (!now || now.plan.isLocal || !s || !now.plan.url) return false;
    if (now.plan.url.startsWith(`${s.serverUrl}/`) || this.recovered === now.plan.url) return false;
    this.recovered = now.plan.url;
    if (__DEV__) console.log('[player] the server address changed: the stream starts again on the new address');
    void this.reload({});
    return true;
  }

  /** Reloads the current item at the current position with new stream options. */
  private async reload(opts: Omit<LoadOptions, 'startSeconds'>): Promise<void> {
    const st = playerState();
    if (!st.now) return;
    if (st.now.live) {
      // A live stream has no other forms to ask the server for: start the channel again.
      this.retryLive();
      return;
    }
    if (st.now.vod) {
      // An IPTV title has no server to ask for another form: start it again where it was.
      this.restartVod();
      return;
    }
    if (st.now.plan.isLocal) {
      // A downloaded file has its tracks inside; the server is not asked for another stream.
      if (st.status === 'error' && this.lastRequest) void this.play({ ...this.lastRequest, startPositionTicks: secondsToTicks(st.position) });
      return;
    }
    const id = ++this.loadId;
    const position = this.engine.position || st.position;
    const now = st.now;
    await this.reporter?.stop({ positionTicks: secondsToTicks(position) });
    try {
      await this.load(id, now.item, now.queue, {
        startSeconds: position,
        audioIndex: opts.audioIndex !== undefined ? opts.audioIndex : now.plan.audioIndex,
        subtitleIndex: opts.subtitleIndex !== undefined ? opts.subtitleIndex : now.plan.subtitleIndex,
        bitrateChoice: opts.bitrateChoice !== undefined ? opts.bitrateChoice : now.bitrateChoice,
        forceStream: opts.forceStream,
      });
    } catch (e) {
      console.warn('[player] reload failed', e);
      if (id === this.loadId) setPlayerState({ status: 'error', error: errorText(e) });
    }
  }

  private retryLive(): void {
    const live = playerState().now?.live;
    if (live) void this.playLive({ channels: live.channels, index: live.index, source: live.source }, { keepPresentation: true });
  }

  retry(): void {
    const st = playerState();
    if (st.now?.live) this.retryLive();
    else if (st.now?.vod) this.restartVod();
    else if (st.now) void this.reload({});
    else if (this.lastRequest) void this.play(this.lastRequest);
  }

  togglePlay(): void {
    if (togglePauses(playerState().playing)) this.pause();
    else this.play_();
  }

  play_(): void {
    if (controlGate.intercept({ action: 'play' })) return;
    this.engine.play();
  }

  pause(): void {
    if (controlGate.intercept({ action: 'pause' })) return;
    this.engine.pause();
  }

  seekTo(seconds: number): void {
    const { duration, now } = playerState();
    // Live: no seeking (the stream plays at the live edge).
    if (now?.live) return;
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.5) : seconds);
    if (controlGate.intercept({ action: 'seek', position: target })) return;
    this.directSeek(target);
  }

  /**
   * Player changes that skip the control gate. Watch together uses them to
   * apply the group's commands, so a remote command does not echo.
   */
  readonly direct = {
    play: () => this.engine.play(),
    pause: () => this.engine.pause(),
    seek: (seconds: number) => this.directSeek(seconds),
    rate: (rate: number) => {
      this.engine.setRate(rate);
      setPlayerState({ rate });
    },
    position: () => this.engine.position || playerState().position,
  };

  private directSeek(target: number): void {
    this.engine.seekTo(target);
    setPlayerState({ position: target });
    this.reporter?.tick('Seek');
  }

  skip(delta: number): void {
    this.seekTo((this.engine.position || playerState().position) + delta);
  }

  setRate(rate: number): void {
    if (controlGate.intercept({ action: 'rate', rate })) return;
    this.direct.rate(rate);
  }

  toggleMuted(): void {
    const muted = !playerState().muted;
    this.engine.setMuted(muted);
    setPlayerState({ muted });
  }

  startPip(): void {
    this.engine.startPip();
  }

  get pipSupported(): boolean {
    return this.engine.pipSupported;
  }

  toggleFullscreen(element: unknown): void {
    this.engine.toggleFullscreen?.(element);
  }

  /** The engine switches tracks inside this file itself (libmpv, direct play). */
  private engineTracks(plan: StreamPlan): boolean {
    return !!this.engine.tracks && plan.playMethod === 'DirectPlay';
  }

  async selectAudio(index: number): Promise<void> {
    const now = playerState().now;
    if (!now || now.plan.audioIndex === index) return;
    if (this.engineTracks(now.plan)) {
      this.engine.tracks?.selectAudio(index);
      setPlayerState({ now: { ...now, plan: { ...now.plan, audioIndex: index } } });
      this.reporter?.tick('AudioTrackChange');
      return;
    }
    // A direct-played file plays its default track: another track needs a remux from the server.
    const def = now.plan.audio.find((a) => a.isDefault) ?? now.plan.audio[0];
    const forceStream = audioSwitchNeedsStream(now.plan, index) && now.plan.playMethod !== 'Transcode' && def?.index !== index;
    await this.reload({ audioIndex: index, forceStream });
    this.reporter?.tick('AudioTrackChange');
  }

  /** null turns subtitles off. Text subtitles load as WebVTT; image subtitles need a burned-in stream. */
  async selectSubtitle(index: number | null): Promise<void> {
    const now = playerState().now;
    if (!now) return;
    const option = index === null ? null : now.plan.subtitles.find((s) => s.index === index);
    if (this.engineTracks(now.plan)) {
      // The engine draws every subtitle format itself (ASS styling, PGS pictures).
      this.engine.tracks?.selectSubtitle(
        option ? { index: option.index, url: option.isExternal ? option.url : null, label: option.label, language: option.language } : null,
      );
      setPlayerState({ cues: null });
      this.setPlanSubtitle(option ? option.index : null);
      return;
    }
    if (!option) {
      setPlayerState({ cues: null });
      if (now.plan.burnedSubtitle) await this.reload({ subtitleIndex: null });
      else this.setPlanSubtitle(null);
      return;
    }
    if (!option.isText || (!option.url && !now.plan.burnedSubtitle)) {
      // Image subtitles: the server burns them in. A text subtitle without a URL needs a fresh answer.
      setPlayerState({ cues: null });
      await this.reload({ subtitleIndex: option.index });
      if (option.isText) await this.loadCues(option.index);
      return;
    }
    if (now.plan.burnedSubtitle) {
      await this.reload({ subtitleIndex: option.index });
    } else {
      this.setPlanSubtitle(option.index);
    }
    await this.loadCues(option.index);
  }

  private setPlanSubtitle(index: number | null) {
    const now = playerState().now;
    if (!now) return;
    setPlayerState({ now: { ...now, plan: { ...now.plan, subtitleIndex: index } } });
    this.reporter?.tick('SubtitleTrackChange');
  }

  private async loadCues(index: number) {
    const now = playerState().now;
    const option = now?.plan.subtitles.find((s) => s.index === index);
    if (!option?.url) return;
    try {
      const { api } = context();
      const text = /^(file|asset):/.test(option.url) ? ((await readLocalText(option.url)) ?? '') : await jf.getText(api, option.url);
      if (playerState().now?.plan.subtitleIndex !== index) return;
      setPlayerState({ cues: parseVtt(text) });
    } catch (e) {
      setPlayerState({ cues: null });
      console.warn('[player] subtitles failed', describeError(e).title);
    }
  }

  async setQuality(bitrate: number | null): Promise<void> {
    const now = playerState().now;
    if (!now || now.bitrateChoice === bitrate) return;
    await this.reload({ bitrateChoice: bitrate });
  }

  /** Refreshes Continue Watching and the item page, for example when the player minimizes. */
  refreshLists(): void {
    this.reporter?.tick('TimeUpdate');
    setTimeout(() => refreshAfterPlayback(playerState().now?.item), 1500);
  }

  async playNext(): Promise<void> {
    const now = playerState().now;
    if (now?.live) {
      this.zap(1);
      return;
    }
    if (now?.vod) {
      const vod = now.vod;
      if (vod.index + 1 >= vod.items.length) return;
      // Moving on to the next episode (Play Now, the countdown, the remote's Next) counts as watched.
      this.saveVod(true);
      this.vodPlayed = false;
      await this.playVod({ items: vod.items, index: vod.index + 1, source: vod.source, startSeconds: 0 }, { keepPresentation: true });
      return;
    }
    if (!now?.next) return;
    const rest = now.queue[0]?.Id === now.next.Id ? now.queue.slice(1) : [];
    // In a together session the next episode goes to the group (see play-router.ts).
    const request = playRouter.route({ item: now.next, queue: rest, startPositionTicks: 0 }, 'next');
    if (request) await this.play(request);
  }

  private async onEnded() {
    const now = playerState().now;
    // In a together session the session says who starts the next episode (the host, or the member who picked it).
    const mayAutoplay = playRouter.active ? playRouter.autoplay() : !controlGate.active;
    if (now?.next && usePlaybackSettings.getState().autoplayNext && mayAutoplay) {
      await this.playNext();
      return;
    }
    setPlayerState({ status: 'ended', playing: false });
    // In a session the player stays at the end: the group stops there and can seek back.
    if (controlGate.active) return;
    await this.stop();
  }

  /** Ends playback, reports the last position and refreshes Continue Watching. */
  async stop(): Promise<void> {
    this.loadId++;
    this.endLiveAttempt();
    await this.finishCurrent();
    setPlayerState({ ...initialPlayerState });
  }

  private async finishCurrent(): Promise<void> {
    const st = playerState();
    const reporter = this.reporter;
    this.reporter = null;
    const position = this.engine.position || st.position;
    // An IPTV title keeps its position on the device (never on the server).
    if (st.now?.vod) this.saveVod(st.status === 'ended');
    this.vodPlayed = false;
    this.engine.unload();
    if (reporter) {
      await reporter.stop({ positionTicks: secondsToTicks(position), isPaused: true });
      refreshAfterPlayback(st.now?.item);
    }
  }
}

/** Continue Watching, Next Up and the item page change after playback. */
function refreshAfterPlayback(item: BaseItemDto | undefined) {
  const s = useSessionStore.getState().session;
  if (!s) return;
  const scope = { serverId: s.serverId, userId: s.userId };
  void queryClient.invalidateQueries({ queryKey: queryKeys.resume(scope, 'Video') });
  // Prefix match: Next Up on Home and on every show page.
  void queryClient.invalidateQueries({ queryKey: queryKeys.nextUp(scope).slice(0, -1) });
  if (item?.Id) void queryClient.invalidateQueries({ queryKey: queryKeys.item(scope, item.Id) });
}

let session: VideoSession | null = null;

export function videoSession(): VideoSession {
  session ??= new VideoSession();
  return session;
}
