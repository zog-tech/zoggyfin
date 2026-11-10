/**
 * The rules of an extension entry page and of the long press menu of an
 * extension entry, apart from the screens:
 *
 * - `detailView`: what the page shows for a detail description: Play or
 *   Resume with its bar, "Start over" with progress, Download with the
 *   grant, and the extension's buttons with their on/off state.
 * - The on/off state of a button (`pressToggle`, `settleToggle`): the button
 *   shows the new state at once; a failed request puts back the last state
 *   the extension confirmed; the reply's `state` is the truth when it has
 *   one; a late reply to an older press never changes what the button shows
 *   (it only updates the confirmed state). Tokens come from a keyed gate
 *   (`lib/async-gate.ts`), so they only grow.
 * - `entryMenu`: the long press menu of an entry with media.
 * - `playRequestOf`: the player request for an entry's or a detail's media
 *   (the mapping documented at the top of `src/player/index.ts`).
 *
 * Pure, so it is unit-tested.
 */
import { type IconName, isIconName } from '@/components/icon-names';
import type { DetailAction, DetailDescription, FeedEntry, MediaKind, MediaRef } from '@/extensions/feeds';
import { hasGrant } from '@/extensions/grants';
import type { Grants } from '@/extensions/http';
import type { Manifest, SectionSpec } from '@/extensions/schema';
import type { MediaPlayRequest } from '@/player/types';

/** The icon of a button whose icon name the app does not know. */
export const DEFAULT_ACTION_ICON: IconName = 'square.grid.2x2';

/** A known icon name, else the default. */
export function iconOrDefault(name: string | undefined, fallback: IconName = DEFAULT_ACTION_ICON): IconName {
  return name && isIconName(name) ? name : fallback;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

type GrantHolder = { manifest: Pick<Manifest, 'permissions'>; grants: Partial<Grants> };

/** True when the app shows Download for this extension's media: the grant is on and the platform saves files. */
export function canDownload(ext: GrantHolder, platformDownloads: boolean): boolean {
  return platformDownloads && hasGrant(ext, 'downloads');
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/** What a feed entry or a detail description gives the player. */
export interface PlayableSource {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  media?: MediaRef;
}

/** The playable part of a detail description: the eyebrow is the subtitle, the poster (else the backdrop) the picture. */
export function detailPlayable(d: DetailDescription): PlayableSource {
  const out: PlayableSource = { title: d.title };
  if (d.eyebrow) out.subtitle = d.eyebrow;
  const image = d.imageUrl ?? d.backdropUrl;
  if (image) out.imageUrl = image;
  if (d.media) out.media = d.media;
  return out;
}

/**
 * The player request for the media of an entry or a detail. Null when there
 * is nothing to play (no `media.playback`). `startSeconds` 0 starts over; left
 * out, the stream description's `resume` applies.
 */
export function playRequestOf(extId: string, src: PlayableSource, startSeconds?: number): MediaPlayRequest | null {
  const media = src.media;
  if (!media?.playback) return null;
  const req: MediaPlayRequest = { extension: extId, mediaId: media.id, playback: media.playback };
  if (src.title) req.title = src.title;
  if (src.subtitle) req.subtitle = src.subtitle;
  if (src.imageUrl) req.image = src.imageUrl;
  if (media.duration !== undefined) req.duration = media.duration;
  if (startSeconds !== undefined) req.startSeconds = startSeconds;
  return req;
}

/** True when the progress means "started, not finished": Resume and Start over show. */
export function hasProgress(progress: number | undefined): progress is number {
  return progress !== undefined && progress > 0 && progress < 1;
}

// ---------------------------------------------------------------------------
// Long press menu
// ---------------------------------------------------------------------------

export type EntryMenuId = 'play' | 'play-start' | 'open' | 'download';

export interface EntryMenuItem {
  id: EntryMenuId;
  label: string;
  icon: IconName;
}

/**
 * The long press menu of an entry with media: Play, "Play from the
 * beginning" (with progress), Open (with a detail page) and Download (with
 * a download URL and `canDownload`). An entry with no media has no menu.
 */
export function entryMenu(entry: Pick<FeedEntry, 'media' | 'detail' | 'progress'>, opts: { canDownload: boolean }): EntryMenuItem[] {
  const media = entry.media;
  if (!media) return [];
  const out: EntryMenuItem[] = [];
  if (media.playback) {
    out.push({ id: 'play', label: 'Play', icon: 'play.fill' });
    if (hasProgress(entry.progress)) out.push({ id: 'play-start', label: 'Play from the beginning', icon: 'arrow.counterclockwise' });
  }
  if (entry.detail) out.push({ id: 'open', label: 'Open', icon: 'info.circle' });
  if (media.download && opts.canDownload) out.push({ id: 'download', label: 'Download', icon: 'arrow.down.circle' });
  return out;
}

// ---------------------------------------------------------------------------
// On/off buttons
// ---------------------------------------------------------------------------

export interface ToggleEntry {
  /** What the button shows. */
  shown: boolean;
  /** The last state the extension confirmed (or the detail's state). */
  confirmed: boolean;
  /** The token of the newest press. */
  token: number;
  /** The token of the press that set `confirmed`. */
  confirmedToken: number;
  /** A request of the newest press runs. */
  pending: boolean;
}

/** The pressed buttons of one page, by action id. A button not in the map shows the detail's state. */
export type ToggleMap = Readonly<Record<string, ToggleEntry>>;

export type ToggleResult = { ok: true; on?: boolean } | { ok: false };

/** What an on/off button shows now. */
export function toggleOn(map: ToggleMap, action: Pick<DetailAction, 'id' | 'state'>): boolean {
  return map[action.id]?.shown ?? action.state?.on ?? false;
}

/** A press (after its prompts): the button shows `next` at once. */
export function pressToggle(map: ToggleMap, action: Pick<DetailAction, 'id' | 'state'>, next: boolean, token: number): ToggleMap {
  const cur = map[action.id];
  return {
    ...map,
    [action.id]: { shown: next, confirmed: cur?.confirmed ?? action.state?.on ?? false, confirmedToken: cur?.confirmedToken ?? 0, token, pending: true },
  };
}

/**
 * The end of a press's request. `next` is the state that press asked for.
 * Returns the same map when nothing changes.
 */
export function settleToggle(map: ToggleMap, id: string, token: number, next: boolean, result: ToggleResult): ToggleMap {
  const cur = map[id];
  if (!cur) return map;
  if (token !== cur.token) {
    // A late reply to an older press: never what the button shows. A success
    // newer than the confirmed state becomes the state a later failure goes back to.
    if (!result.ok || token <= cur.confirmedToken) return map;
    return { ...map, [id]: { ...cur, confirmed: result.on ?? next, confirmedToken: token } };
  }
  if (!result.ok) return { ...map, [id]: { ...cur, shown: cur.confirmed, pending: false } };
  const on = result.on ?? next;
  return { ...map, [id]: { shown: on, confirmed: on, token, confirmedToken: token, pending: false } };
}

/**
 * A fresh detail arrived: the buttons with no running request show the
 * detail's state again. Returns the same map when nothing changes.
 */
export function dropSettled(map: ToggleMap): ToggleMap {
  const keep = Object.entries(map).filter(([, e]) => e.pending);
  return keep.length === Object.keys(map).length ? map : Object.fromEntries(keep);
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export interface DetailButton {
  /** The action id, or `start-over` / `download` for the app's own buttons. */
  key: string;
  label: string;
  icon: IconName;
  /** On/off buttons: the state shown. */
  active?: boolean;
  /** The extension's action; none for the app's own buttons. */
  action?: DetailAction;
  /** On/off buttons: the state a press asks for. */
  next?: boolean;
}

export interface DetailView {
  title: string;
  eyebrow?: string;
  poster: string | null;
  backdrop: string | null;
  lines: string[];
  description?: string;
  kind: MediaKind;
  /** Play, or Resume with progress; null when there is nothing to play. */
  primary: { label: 'Play' | 'Resume'; progress: number | null } | null;
  /** In the order the page shows them: Start over, Download, then the extension's buttons. */
  buttons: DetailButton[];
  sections: SectionSpec[];
}

/** The view of a detail description. `canDownload`: see `canDownload`. */
export function detailView(d: DetailDescription, toggles: ToggleMap, opts: { canDownload: boolean }): DetailView {
  const playable = !!d.media?.playback;
  const started = hasProgress(d.progress);
  const buttons: DetailButton[] = [];
  if (playable && started) buttons.push({ key: 'start-over', label: 'Start over', icon: 'arrow.counterclockwise' });
  if (d.media?.download && opts.canDownload) buttons.push({ key: 'download', label: 'Download', icon: 'arrow.down.circle' });
  for (const a of d.actions) {
    if (!a.state) {
      buttons.push({ key: a.id, label: a.title, icon: iconOrDefault(a.icon), action: a });
      continue;
    }
    const on = toggleOn(toggles, a);
    buttons.push({
      key: a.id,
      label: on ? (a.state.onTitle ?? a.title) : a.title,
      icon: on ? iconOrDefault(a.state.onIcon ?? a.icon) : iconOrDefault(a.icon),
      active: on,
      action: a,
      next: !on,
    });
  }
  const view: DetailView = {
    title: d.title,
    poster: d.imageUrl ?? null,
    backdrop: d.backdropUrl ?? null,
    lines: d.lines,
    kind: d.media?.kind ?? 'video',
    primary: playable ? { label: started ? 'Resume' : 'Play', progress: started ? (d.progress as number) : null } : null,
    buttons,
    sections: d.sections,
  };
  if (d.eyebrow) view.eyebrow = d.eyebrow;
  if (d.description) view.description = d.description;
  return view;
}
