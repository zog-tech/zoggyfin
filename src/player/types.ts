import type { BaseItemDto } from '@/api/types';

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

/** A film or an episode of an IPTV provider (no Jellyfin item). */
export interface VodRef {
  /** The provider's film or episode id (positions are kept by it). */
  id: string;
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
  /** Seconds, when the provider says. */
  duration?: number;
}

/**
 * Where films and episodes come from (an IPTV provider). The player knows no
 * provider: it asks the source for the streams and gives it the positions,
 * which stay on the device. Nothing goes to Jellyfin.
 */
export interface VodSource {
  providerId: string;
  /** The streams to try, in order. Never throws: on failure, no candidates and a message. */
  resolve(ref: VodRef): Promise<{ candidates: LiveStreamChoice[]; userAgent: string | null; unsupported: string | null }>;
  /** Saves where the title is (seconds). `ended`: it played to the end. */
  savePosition(ref: VodRef, position: number, duration: number, ended: boolean): void;
}

/** What a screen asks the player for to play a film or an episode. */
export interface VodPlayRequest {
  /** A film, or the episodes of a series in play order (Next plays the one after `index`). */
  items: VodRef[];
  index: number;
  source: VodSource;
  /** Seconds; 0 or left out starts at the beginning. */
  startSeconds?: number;
}

export interface PlayerController {
  /** False when no engine can play the item kind yet. */
  readonly available: boolean;
  play(request: PlayRequest): void;
  /** Plays a live channel. Not in a watch-together session (it says so). */
  playLive(request: LivePlayRequest): void;
  /** Plays an IPTV film or episode. Not in a watch-together session (it says so). */
  playVod(request: VodPlayRequest): void;
  /** Audio: put the item (or a container's tracks) after the current track. */
  playNext(item: BaseItemDto): void;
  /** Audio: add the item (or a container's tracks) at the end of Up next. */
  addToQueue(item: BaseItemDto): void;
  /** Audio: play an Instant Mix built from a song, album, artist, playlist or genre. */
  instantMix(item: BaseItemDto): void;
}
