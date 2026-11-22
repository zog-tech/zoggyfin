/**
 * Autoplay: when the queue is about to end, similar music joins it, so the
 * music does not stop. The songs come from the server's Instant Mix of a
 * seed song (`jf.getInstantMix`); this module decides when to ask, which
 * seeds to try and which songs to keep.
 *
 * - It asks when 2 songs or fewer are left after the current one, so the next
 *   song is in the queue (and preloaded for gapless play) before it is due.
 * - Never with Repeat (the queue loops), for long-form items (audiobooks,
 *   podcasts), or for a listen-together guest (the queue is the host's).
 * - A song already in the queue or played recently is not added again.
 *
 * Pure, so it is unit-tested.
 */
import type { QueueState } from './queue';

/** Ask for more when this many songs or fewer are left after the current one. */
export const RADIO_LOW_WATER = 2;
/** Songs added per request. */
export const RADIO_BATCH = 10;
/** How many recently played song ids to remember, so autoplay does not repeat them. */
export const RADIO_HISTORY = 200;

export interface RadioItem {
  Id: string;
  Type?: string | null;
  MediaType?: string | null;
  AlbumArtists?: readonly { Id?: string | null; Name?: string | null }[] | null;
}

export interface RadioConditions {
  enabled: boolean;
  longForm: boolean;
  /** A listen-together session (guest or group) or a locked queue. */
  together: boolean;
}

/** True when autoplay should add songs to this queue now. */
export function radioWanted<T>(q: QueueState<T>, c: RadioConditions): boolean {
  if (!c.enabled || c.longForm || c.together) return false;
  if (q.index < 0 || q.repeat !== 'off') return false;
  return q.entries.length - 1 - q.index <= RADIO_LOW_WATER;
}

/**
 * The items to ask a mix for, best first: the last song in the queue, the
 * current song, then the last song's artist. `usable` drops songs the server
 * cannot mix from (a catalog song that is not in the library yet).
 */
export function radioSeeds<T extends RadioItem>(q: QueueState<T>, usable: (item: T) => boolean): RadioItem[] {
  const out: RadioItem[] = [];
  const seen = new Set<string>();
  const add = (item: RadioItem | undefined) => {
    if (!item?.Id || seen.has(item.Id)) return;
    seen.add(item.Id);
    out.push(item);
  };
  const songs = q.entries.map((e) => e.item).filter(usable);
  const last = songs[songs.length - 1];
  add(last);
  const current = q.entries[q.index]?.item;
  if (current && usable(current)) add(current);
  const artist = last?.AlbumArtists?.find((a) => a.Id);
  if (artist?.Id) add({ Id: artist.Id, Type: 'MusicArtist' });
  return out;
}

function isSong(item: RadioItem): boolean {
  return item.MediaType === 'Audio' || item.Type === 'Audio';
}

/** The songs of a mix to add: songs only, none in the queue or the recent list, each once, at most `max`. */
export function pickRadio<T extends RadioItem>(mix: readonly T[], q: QueueState<RadioItem>, recent: readonly string[], max = RADIO_BATCH): T[] {
  const skip = new Set<string>([...q.entries.map((e) => e.item.Id), ...recent]);
  const out: T[] = [];
  for (const item of mix) {
    if (out.length >= max) break;
    if (!item.Id || skip.has(item.Id) || !isSong(item)) continue;
    skip.add(item.Id);
    out.push(item);
  }
  return out;
}

/** The recent list with this song id at the front, at most `RADIO_HISTORY` long. */
export function rememberPlayed(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RADIO_HISTORY);
}
