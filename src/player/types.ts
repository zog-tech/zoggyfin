import type { BaseItemDto } from '@/api/types';
import type { SkipMode } from '@/settings/skip-modes';

/** What a screen asks the player for. */
export interface PlayRequest {
  item: BaseItemDto;
  /** Items to queue after `item` (album tracks, next episodes). */
  queue?: BaseItemDto[];
  /**
   * Audio: the whole list (album tracks, playlist entries) with `index`
   * pointing at `item`, so Previous and the queue know what came before.
   */
  list?: BaseItemDto[];
  index?: number;
  /** Audio: the album, playlist or artist the list comes from ("Playing from"). */
  context?: BaseItemDto;
  /** Audio: shuffle the list. */
  shuffle?: boolean;
  /**
   * Where to start. Leave it out to resume from the saved position;
   * pass 0 to start over.
   */
  startPositionTicks?: number;
  /** Video: false loads the item paused (watch together starts it for the group). */
  autoplay?: boolean;
}

/** A channel the live player can switch to. */
export interface LiveChannelRef {
  id: string;
  name: string;
  logo: string | null;
  number: number | null;
  group: string;
  /** The provider's name, when the list mixes providers ("All providers"). */
  provider?: string;
}

/** A programme on a live channel. Times in ms since the epoch. */
export interface LiveProgramme {
  title: string;
  start: number;
  stop: number;
}

export interface LiveNowNext {
  now: LiveProgramme | null;
  next: LiveProgramme | null;
}

/** A stream to try for a live channel. */
export interface LiveStreamChoice {
  url: string;
  isHls: boolean;
  /** iOS: play the progressive MPEG-TS `url` through the TS bridge (`@/native/ts-bridge`). */
  bridge?: boolean;
}

/**
 * Where live channels come from (an IPTV provider). The player knows no
 * provider: it asks the source for the streams of a channel.
 */
export interface LiveSource {
  providerId: string;
  /** The streams to try, in order. Never throws: on failure, no candidates and a message. */
  resolve(channelId: string): Promise<{ candidates: LiveStreamChoice[]; userAgent: string | null; unsupported: string | null }>;
  /** The programme that runs now on the channel, or null. */
  nowLine?(channelId: string): string | null;
  /**
   * Now and next on the channel with their times, as far as the guide knows
   * (the zap banner, the channel card and the channel list preview). It may
   * ask the provider for them; ask again later for what arrived.
   */
  nowNext?(channelId: string): LiveNowNext;
  /** A channel started to play (Recently watched). */
  onStart?(channelId: string): void;
  /**
   * After every stream form failed: a clearer reason from the provider (all
   * streams of the account in use), or null. Never throws, never holds a URL.
   */
  explainFailure?(channelId: string): Promise<string | null>;
  /**
   * The provider and the provider's own channel id, when the source mixes
   * providers and its channel ids are its own keys. The track choices and
   * the item id use these. Left out: `providerId` and the channel id.
   */
  titleOf?(channelId: string): { providerId: string; channelId: string };
}

/** What a screen asks the player for to play a live stream: no Jellyfin item, no progress reports. */
export interface LivePlayRequest {
  /** The channels that channel up and down move through (the list the user played from). */
  channels: LiveChannelRef[];
  index: number;
  source: LiveSource;
}

/**
 * A title from outside Jellyfin: an IPTV film or episode, or an extension's
 * media entry. The player keeps no URL in it: the source resolves it.
 */
export interface ExternalRef {
  /** The source's own id (positions and track choices are kept by it). */
  id: string;
  /** Extension media is a `film`: one title with no series facts. */
  kind: 'film' | 'episode';
  title: string;
  /** The poster or still, an http(s) URL, or null. */
  poster: string | null;
  /** Films: the year. */
  year?: number;
  /** Episodes. */
  seriesId?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  /** Seconds, when the source says. */
  duration?: number;
  /** A line under the title when there is no series line or year (extension media). */
  subtitle?: string;
}

/** One choice of the quality menu of an external title: another stream URL. */
export interface ExternalQuality {
  id: string;
  label: string;
  url: string;
  isHls: boolean;
}

/** A WebVTT file next to an external stream. The app draws it. */
export interface ExternalSubtitle {
  id: string;
  label: string;
  language: string | null;
  url: string;
}

/** A labelled range the player can skip (`segments.ts`), in seconds. */
export interface ExternalSegment {
  label: string;
  title: string;
  start: number;
  end: number;
}

/** The events of an external progress report (`extensions/media/report.ts`). */
export type ExternalReportEvent = 'start' | 'progress' | 'pause' | 'resume' | 'seek' | 'stop' | 'finished';

/** What a progress report of an external title says. Seconds. */
export interface ExternalReportSnapshot {
  position: number;
  /** 0 when not known (a live stream). */
  duration: number;
  rate: number;
  /** The id of the chosen quality, or null. */
  quality: string | null;
}

/**
 * Where the progress of an external title goes. The player calls it on
 * start, every `intervalMs`, on pause, resume, seek, stop and at the end.
 * Errors are ignored.
 */
export interface ExternalProgress {
  intervalMs: number;
  send(event: ExternalReportEvent, snapshot: ExternalReportSnapshot): Promise<void>;
}

/** What a skip label does: skip by itself, show the skip button, or nothing (`settings/skip-modes.ts`). */
export type { SkipMode };

/**
 * What the source answers for one title. Only the candidates are needed;
 * every other field is an optional capability that the player uses when set.
 */
export interface ExternalStream {
  /** The streams to try, in order. */
  candidates: LiveStreamChoice[];
  userAgent: string | null;
  /** Why nothing plays, when there are no candidates (or none plays). Never holds a URL. */
  unsupported: string | null;
  /** Request headers for the stream and its playlists. Never put a token in a URL instead. */
  headers?: Record<string, string>;
  /** A live stream: no duration, no resume, no seeking, no saved position. */
  live?: boolean;
  /** Where to start, in seconds, when the request does not say. */
  resume?: number;
  /** Seconds. */
  duration?: number;
  /** Better facts than the ref had (the extension's stream description). */
  title?: string;
  subtitle?: string;
  artwork?: string;
  /** The quality menu. The first stream is "Auto". */
  qualities?: ExternalQuality[];
  subtitles?: ExternalSubtitle[];
  segments?: ExternalSegment[];
  /** Chapter marks, seconds. */
  chapters?: { title: string; start: number }[];
  /** The title to play after this one. The same source resolves it. */
  next?: ExternalRef;
  progress?: ExternalProgress;
  /**
   * The skip settings of this source: the key prefix (`<scope>:<label>`) and
   * the mode of each label until the user changes it.
   */
  skip?: { scope: string; defaults: Record<string, SkipMode> };
}

/**
 * Where external titles come from: an IPTV provider (`iptv/vod-manager.ts`)
 * or an extension (`extensions/media/source.ts`). The player knows neither:
 * it asks the source for the stream and its optional capabilities.
 */
export interface ExternalSource {
  providerId: string;
  /** The words after "Quality ·" in the player (`IPTV`, an extension's name). */
  label?: string;
  /** Resolves the streams to try. Never throws: on failure, no candidates and a message. */
  resolve(ref: ExternalRef): Promise<ExternalStream>;
  /** Saves where the title is (seconds), on the device. `ended`: it played to the end. */
  savePosition?(ref: ExternalRef, position: number, duration: number, ended: boolean): void;
  /** The id of the player's item for the title. Default: `iptv-vod:<providerId>:<kind>:<id>`. */
  itemId?(ref: ExternalRef): string;
  /**
   * Loads a subtitle file the stream listed, with the source's own headers.
   * Never the Jellyfin client: its token must not go to another server.
   */
  loadText?(url: string): Promise<string>;
}

/** What a screen asks the player for to play an external title. */
export interface ExternalPlayRequest {
  /** A title, or the episodes of a series in play order (Next plays the one after `index`). */
  items: ExternalRef[];
  index: number;
  source: ExternalSource;
  /** Seconds. Left out: the stream's `resume`, else the start. 0 starts at the beginning. */
  startSeconds?: number;
}

/** The IPTV names of the external types. */
export type VodRef = ExternalRef;
export type VodSource = ExternalSource;
export type VodPlayRequest = ExternalPlayRequest;

/**
 * An extension's media entry, as a feed entry or a detail reply gives it
 * (`media` after `readMediaRef`). `usePlayer().playMedia` plays it.
 */
export interface MediaPlayRequest {
  /** The extension's manifest id. */
  extension: string;
  /** `media.id`. */
  mediaId: string;
  /** `media.playback`: the full URL of the stream description, on the extension's origin. */
  playback: string;
  /** What the card showed, for the player while the description loads. */
  title?: string;
  subtitle?: string;
  /** `imageUrl` of the entry. */
  image?: string;
  /** `media.duration`, seconds. */
  duration?: number;
  /** Seconds. Left out: the description's `resume`. 0 starts over. */
  startSeconds?: number;
}

export interface PlayerController {
  /** False when no engine can play the item kind yet. */
  readonly available: boolean;
  play(request: PlayRequest): void;
  /** Plays a live channel. Not in a watch-together session (it says so). */
  playLive(request: LivePlayRequest): void;
  /** Plays an IPTV film or episode. Not in a watch-together session (it says so). */
  playVod(request: ExternalPlayRequest): void;
  /** Plays an extension's media entry. Not in a watch-together session (it says so). */
  playMedia(request: MediaPlayRequest): void;
  /** Audio: put the item (or a container's tracks) after the current track. */
  playNext(item: BaseItemDto): void;
  /** Audio: add the item (or a container's tracks) at the end of Up next. */
  addToQueue(item: BaseItemDto): void;
  /** Audio: play an Instant Mix built from a song, album, artist, playlist or genre. */
  instantMix(item: BaseItemDto): void;
}
