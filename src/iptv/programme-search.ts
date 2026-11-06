/**
 * Programme search for Live TV: finds programme titles in the guide slices
 * of the providers and says which channels carry each one.
 *
 * A programme is a hit when it is on now or starts within an hour, every
 * word of the query is in its folded title, and its guide id has a channel.
 * Streams that share a guide id (HD, FHD, backup) form one hit; the first
 * channel in list order plays. Order: on now first, then the start time,
 * then the provider order, then the title.
 * Pure, so it is unit-tested.
 */
import { guideIdFor } from './guide';
import type { SlicedProgramme } from './programme-index';
import { asProviderChannel, type ProviderChannel } from './merged';
import { foldText } from './search';
import type { Channel } from './types';

/** How far ahead a programme may start and still be a hit. */
export const ON_NOW_AHEAD_MS = 60 * 60_000;
export const PROGRAMME_SEARCH_LIMIT = 50;

export interface ProgrammeSource {
  providerId: string;
  programmes: readonly SlicedProgramme[];
  channelsByGuideId: ReadonlyMap<string, readonly Channel[]>;
}

export interface ProgrammeHit {
  /** `${providerId}:${guideId}:${start}` */
  key: string;
  providerId: string;
  title: string;
  start: number;
  stop: number;
  onNow: boolean;
  /** `channels[0]` plays. */
  channels: readonly Channel[];
}

/** Groups channels by guide id, keeping the list order. Built once per channel list. */
export function channelsByGuideId(channels: readonly Channel[], names: ReadonlyMap<string, string> | null): Map<string, Channel[]> {
  const map = new Map<string, Channel[]>();
  for (const channel of channels) {
    const id = guideIdFor(channel, names);
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(channel);
    else map.set(id, [channel]);
  }
  return map;
}

interface Candidate {
  hit: ProgrammeHit;
  order: number;
}

export function searchProgrammes(
  sources: readonly ProgrammeSource[],
  query: string,
  now: number,
  limit: number = PROGRAMME_SEARCH_LIMIT,
): ProgrammeHit[] {
  const folded = foldText(query);
  if (folded.length < 2) return [];
  const words = folded.split(' ');
  const until = now + ON_NOW_AHEAD_MS;
  const found: Candidate[] = [];
  for (let order = 0; order < sources.length; order++) {
    const { providerId, programmes, channelsByGuideId: byId } = sources[order];
    for (let i = 0; i < programmes.length; i++) {
      const p = programmes[i];
      if (p.stop <= now || p.start > until) continue;
      let ok = true;
      for (let w = 0; w < words.length; w++) {
        if (!p.folded.includes(words[w])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const channels = byId.get(p.guideId);
      if (!channels || !channels.length) continue;
      found.push({
        order,
        hit: {
          key: `${providerId}:${p.guideId}:${p.start}`,
          providerId,
          title: p.title,
          start: p.start,
          stop: p.stop,
          onNow: p.start <= now,
          channels,
        },
      });
    }
  }
  found.sort(
    (a, b) =>
      Number(b.hit.onNow) - Number(a.hit.onNow) ||
      a.hit.start - b.hit.start ||
      a.order - b.order ||
      (a.hit.title < b.hit.title ? -1 : a.hit.title > b.hit.title ? 1 : 0),
  );
  return found.slice(0, limit).map((c) => c.hit);
}

/**
 * The list a programme hit plays in: each hit's first stream, in hit order,
 * each channel once. Channel up and down then move through the hits.
 */
export function programmePlayList(hits: readonly ProgrammeHit[]): ProviderChannel[] {
  const seen = new Set<string>();
  const out: ProviderChannel[] = [];
  for (const hit of hits) {
    const first = hit.channels[0];
    if (!first) continue;
    const item = asProviderChannel(hit.providerId, first);
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}
