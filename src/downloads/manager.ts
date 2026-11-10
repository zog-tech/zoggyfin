/**
 * The download manager: queues items, starts at most two at a time,
 * re-attaches to the system's tasks after a restart, saves the extras
 * (images, subtitles, lyrics, item facts) and removes files. The state rules
 * live in `state-machine.ts`; the native downloader sits behind `engine`.
 *
 * Files: <documents>/downloads/<itemId>/media.<ext>, primary.jpg,
 * backdrop.jpg, subtitle-<index>.vtt, lyrics.json, item.json.
 * Collections (albums, playlists, seasons): <documents>/downloads/collections/<id>/.
 */
import type { Api } from '@jellyfin/sdk';

import { buildAuthHeader } from '@/api/auth-header';
import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import type { BaseItemDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { findServer, startUrl } from '@/auth/accounts';
import { tokenFor, useSessionStore } from '@/auth/session-store';
import { type ImageVariant, resolveImage } from '@/images/resolve-image';
import { randomId } from '@/lib/id';
import { toast } from '@/lib/toast';
import { makeSeekableMp4 } from '@/native/zoggyfin-native';
import { mediaCapabilities } from '@/player/capabilities';
import { buildDeviceProfile } from '@/player/device-profile';
import { mayHaveLyrics } from '@/player/audio/lyrics';
import { pickSource, playbackInfoBody, type StreamServer } from '@/player/stream';
import { MAX_BITRATE, usePlaybackSettings } from '@/settings/playback';

import { engine } from './engine';
import { files } from './files';
import { audioPlan, groupFor, isContainer, mediaKindOf, type MediaPlan, slimForDownload, sortFor, subtitleFiles, videoPlan } from './plan';
import { askForDownloadNotifications } from './notification-permission';
import { canResume, isWholeFile, resumeHint } from './resume';
import { type DownloadEvent, dueForRetry, isActive, isFileMissing, pickToStart, reorder, transition } from './state-machine';
import { downloadsState, dropCollection, dropRecord, patchRecord, putCollection, putRecord, rekeyRecord, useDownloadsStore } from './store';
import { DOWNLOAD_SCHEMA_VERSION, type DownloadCollection, type DownloadRecord, type LocalImages } from './types';

export const MAX_PARALLEL = 2;
const ROOT = 'downloads';

interface Ctx {
  api: Api;
  userId: string;
  serverId: string;
  server: StreamServer;
  authHeader: string;
}

/**
 * The account a download runs for: the active one, or (`owner`) the account
 * that queued the record. Downloads of a saved account go on after a switch
 * to another account; they use that server's last address.
 */
function context(owner?: Pick<DownloadRecord, 'serverId' | 'userId'>): Ctx {
  const st = useSessionStore.getState();
  const s = st.session;
  const identity = clientIdentity();
  if (!owner || (s && s.serverId === owner.serverId && s.userId === owner.userId)) {
    if (!s) throw new Error('Sign in to download.');
    return {
      api: getApi(s.serverUrl, s.token),
      userId: s.userId,
      serverId: s.serverId,
      server: { baseUrl: s.serverUrl, token: s.token, deviceId: identity.deviceId },
      authHeader: buildAuthHeader(identity, s.token),
    };
  }
  const server = findServer(st.accounts, owner.serverId);
  const url = server ? startUrl(server) : null;
  const token = tokenFor(owner);
  if (!server || !url || !token) throw new Error('Sign in to this server again to download.');
  return {
    api: getApi(url, token),
    userId: owner.userId,
    serverId: owner.serverId,
    server: { baseUrl: url, token, deviceId: identity.deviceId },
    authHeader: buildAuthHeader(identity, token),
  };
}

/** The accounts signed in on this device, as `serverId.userId`. */
function signedInOwners(): Set<string> {
  const out = new Set<string>();
  for (const s of useSessionStore.getState().accounts.servers) for (const u of s.users) out.add(`${s.id}.${u.userId}`);
  return out;
}

function apply(itemId: string, e: DownloadEvent, soon = true): DownloadRecord | null {
  return patchRecord(itemId, (r) => transition(r, e), soon);
}

async function fetchImage(item: BaseItemDto, variant: ImageVariant, size: { width: number; height: number }, dir: string, name: string, ctx: Ctx): Promise<string | undefined> {
  const img = resolveImage(item, variant, size, { baseUrl: ctx.server.baseUrl, token: ctx.server.token });
  if (img.kind !== 'remote' || img.crop) return undefined;
  try {
    const bytes = await files.fetchFile(img.uri, `${dir}/${name}`);
    return bytes > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

async function fetchImages(item: BaseItemDto, dir: string, ctx: Ctx, backdrop: boolean): Promise<LocalImages> {
  const square = mediaKindOf(item) === 'audio' || item.Type === 'MusicAlbum' || item.Type === 'Playlist';
  const primary = await fetchImage(item, square ? 'square' : item.Type === 'Episode' ? 'landscape' : 'poster', square ? { width: 600, height: 600 } : { width: 600, height: 900 }, dir, 'primary.jpg', ctx);
  const back = backdrop ? await fetchImage(item, 'backdrop', { width: 1280, height: 720 }, dir, 'backdrop.jpg', ctx) : undefined;
  return { primary, backdrop: back };
}

class DownloadManager {
  private started = false;
  /** Ids with a live native task (started here or re-attached). */
  private native = new Set<string>();
  /**
   * Ids between "start" and the native task being created. A pause and a
   * resume in that time put the record back in the queue: it must not begin
   * again until this preparation ends, or two tasks write one file.
   */
  private preparing = new Set<string>();
  /** Ids whose file is in place and whose extras are being saved. */
  private finishing = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  get supported(): boolean {
    return engine.supported;
  }

  /** Starts the engine once per launch (signed in or not). Safe to call more than once. */
  async init(): Promise<void> {
    if (this.started || !engine.supported) return;
    this.started = true;
    useDownloadsStore.setState({ documentsDir: files.documentsDir() });
    engine.configure(
      {
        onBegin: (id, expected, validator) => {
          patchRecord(
            id,
            (r) => {
              const total = expected > 0 ? expected : r.bytesTotal;
              const tag = validator ?? r.validator ?? null;
              return r.bytesTotal === total && (r.validator ?? null) === tag ? r : { ...r, bytesTotal: total, validator: tag };
            },
            false,
          );
        },
        onProgress: (id, done, total) => {
          apply(id, { type: 'progress', bytesDone: done, bytesTotal: total > 0 ? total : null, now: Date.now() }, false);
        },
        onDone: (id, bytes) => {
          this.native.delete(id);
          void this.finalize(id, bytes);
        },
        onError: (id, message, code) => {
          this.native.delete(id);
          const r = downloadsState().records[id];
          // Pause and cancel stop the task too; those are not failures.
          if (!r || r.state === 'paused' || r.state === 'cancelled') return;
          // Cancel in the Android download notification: the same as Cancel in the app.
          if (code === -1 && /cancel/i.test(message)) {
            void this.cancel(id);
            return;
          }
          apply(id, { type: 'fail', error: errorText(message, code), now: Date.now() });
          this.tick();
        },
      },
      { maxParallel: MAX_PARALLEL },
    );
    try {
      files.ensureDir(ROOT);
      files.excludeFromBackup(ROOT);
    } catch {
      // The first download creates it.
    }
    await this.reattach();
    this.cleanOrphans();
    // One after the other: the video fix rewrites files that the check reads.
    void this.checkFiles()
      .then((missing) => {
        if (missing.length) offerDownloadAgain(missing);
      })
      .then(() => this.fixFragmentedVideos());
    this.tick();
    this.timer ??= setInterval(() => this.tick(), 5000);
  }

  /** After a restart: bind running and paused system tasks to their records, finish what ended meanwhile. */
  private async reattach(): Promise<void> {
    let tasks: Awaited<ReturnType<typeof engine.existing>> = [];
    try {
      tasks = await engine.existing();
    } catch (e) {
      console.warn('[downloads] could not list system tasks', describeError(e).title);
    }
    const records = downloadsState().records;
    for (const t of tasks) {
      const r = records[t.id];
      if (!r || r.state === 'completed') {
        void engine.stop(t.id);
        continue;
      }
      this.native.add(t.id);
      switch (t.state) {
        case 'downloading':
          if (r.state === 'paused') void engine.pause(t.id);
          else {
            patchRecord(t.id, (x) => ({ ...x, state: 'queued' }));
            apply(t.id, { type: 'start', now: Date.now() });
            apply(t.id, { type: 'progress', bytesDone: t.bytesDone, bytesTotal: t.bytesTotal || null, now: Date.now() });
          }
          break;
        case 'paused':
          patchRecord(t.id, (x) => ({ ...x, state: 'paused', bytesDone: t.bytesDone || x.bytesDone }));
          break;
        case 'done':
          this.native.delete(t.id);
          void this.finalize(t.id, t.bytesDone);
          break;
        default:
          this.native.delete(t.id);
          void engine.stop(t.id);
      }
    }
    // Records with no system task left: the file may have landed while the app was closed.
    for (const r of Object.values(downloadsState().records)) {
      if (this.native.has(r.itemId) || r.state === 'completed') continue;
      const size = r.mediaFile ? files.size(`${r.dir}/${r.mediaFile}`) : 0;
      if (r.state === 'downloading') {
        // It ran when the app ended: queue it again. The start continues the partial file.
        patchRecord(r.itemId, (x) => ({ ...x, state: 'queued', speed: 0 }));
      }
      const state = downloadsState().records[r.itemId]?.state;
      if ((state === 'queued' || state === 'paused') && r.bytesDone > 0 && isWholeFile(size, r)) {
        void this.finalize(r.itemId, size);
      } else if (state === 'paused' && r.bytesDone > 0 && r.method === 'transcode') {
        // A transcode has no byte ranges: a resume starts over.
        patchRecord(r.itemId, (x) => ({ ...x, bytesDone: 0 }));
      }
      // Else a paused original file keeps its bytes: a resume continues it with an HTTP Range request.
    }
  }

  /**
   * Video downloads from builds before the fix are fragmented MP4 files that
   * ExoPlayer cannot seek in (on Android, and as a nearby host's file for
   * Android guests). Rewrites them one at a time. A file that is already
   * plain is skipped after a short header read.
   */
  private async fixFragmentedVideos(): Promise<void> {
    for (const r of Object.values(downloadsState().records)) {
      if (r.state !== 'completed' || r.kind !== 'video' || !r.mediaFile || !/\.mp4$/i.test(r.mediaFile)) continue;
      const before = files.size(`${r.dir}/${r.mediaFile}`);
      const fixed = await makeSeekableMp4(files.absolutePath(`${r.dir}/${r.mediaFile}`));
      if (fixed === 'done') {
        const after = files.size(`${r.dir}/${r.mediaFile}`) || before;
        patchRecord(r.itemId, (x) => ({ ...x, bytesDone: after, bytesTotal: after }));
      }
    }
  }

  /**
   * Finds completed downloads whose file is gone (deleted by hand, an old
   * record from another install) and marks them as not downloaded. With no
   * ids, it checks every completed download. Returns the ids that are missing.
   */
  async checkFiles(ids?: readonly string[]): Promise<string[]> {
    const records = downloadsState().records;
    const list = ids ? ids.map((id) => records[id]).filter((r): r is DownloadRecord => !!r) : Object.values(records);
    const missing: string[] = [];
    for (const r of list) {
      if (r.state !== 'completed' || !r.mediaFile || this.finishing.has(r.itemId)) continue;
      let size: number;
      try {
        size = await files.statSize(`${r.dir}/${r.mediaFile}`);
      } catch {
        // Not known: keep the record as it is.
        continue;
      }
      if (size > 0) continue;
      const next = apply(r.itemId, { type: 'missing' });
      if (next && isFileMissing(next)) missing.push(r.itemId);
    }
    return missing;
  }

  /** Downloads again the downloads whose file is gone. */
  downloadAgain(ids: readonly string[]): void {
    for (const id of ids) {
      const r = downloadsState().records[id];
      if (r && isFileMissing(r)) apply(id, { type: 'retry' });
    }
    this.tick();
  }

  /** Folders with no record (a crash between delete steps) take space for nothing. */
  private cleanOrphans() {
    const known = new Set(Object.values(downloadsState().records).map((r) => r.dir.split('/')[1]));
    known.add('collections');
    for (const name of files.listDirs(ROOT)) {
      if (!known.has(name)) files.remove(`${ROOT}/${name}`);
    }
    const collections = new Set(Object.keys(downloadsState().collections));
    for (const name of files.listDirs(`${ROOT}/collections`)) {
      if (!collections.has(name)) files.remove(`${ROOT}/collections/${name}`);
    }
  }

  /** Starts queued downloads up to the limit, and retries failed ones after their backoff. */
  tick(): void {
    if (!this.started) return;
    const now = Date.now();
    const list = Object.values(downloadsState().records);
    for (const r of dueForRetry(list, now)) apply(r.itemId, { type: 'autoRetry', now });
    // A queued download of a user who signed out waits; it starts when that user signs in again.
    const owners = signedInOwners();
    // A record still in its last preparation or finishing waits too (see `preparing`).
    const ready = Object.values(downloadsState().records).filter(
      (r) => r.state !== 'queued' || (owners.has(`${r.serverId}.${r.userId}`) && !this.busy(r.itemId)),
    );
    for (const r of pickToStart(ready, MAX_PARALLEL)) void this.begin(r.itemId);
  }

  private busy(itemId: string): boolean {
    return this.preparing.has(itemId) || this.finishing.has(itemId);
  }

  private async begin(itemId: string): Promise<void> {
    if (this.busy(itemId)) return;
    const before = downloadsState().records[itemId];
    const r = apply(itemId, { type: 'start', now: Date.now() });
    // Only a record that moves from queued to downloading here begins.
    if (!r || r === before || r.state !== 'downloading') return;
    if (this.native.has(itemId)) {
      if (await engine.resume(itemId)) return;
      // The engine lost the task: start it again below, from the partial file when it can.
      this.native.delete(itemId);
    }
    this.preparing.add(itemId);
    /** The record's id: another one when the server moves the item (see `prepare`). */
    let id = itemId;
    let stale = false;
    try {
      const ctx = context(r);
      const plan = await this.prepare(r, ctx, (to) => {
        id = to;
        // Busy under the new id too, so a pause and a resume meanwhile do not begin it twice.
        this.preparing.add(to);
      });
      const cur = downloadsState().records[id];
      // Paused, cancelled or deleted meanwhile, or moved onto a download that is there
      // already. A resume in that time waits for this preparation to end; the tick
      // below then starts it again.
      if (!plan || !cur || cur.state !== 'downloading') {
        stale = true;
        return;
      }
      files.ensureDir(cur.dir);
      // A moved record starts in a new folder, with no partial file.
      const resume = canResume(id === itemId ? r : cur, plan);
      // A partial file of an earlier try that cannot continue would block the move into place.
      if (!resume) {
        files.remove(`${cur.dir}/${plan.file}`);
        if (cur.bytesDone > 0) patchRecord(id, (x) => ({ ...x, bytesDone: 0, validator: null }), false);
      }
      engine.start({
        id,
        url: plan.url,
        destination: files.absolutePath(`${cur.dir}/${plan.file}`),
        headers: { Authorization: ctx.authHeader },
        resume: resume ? resumeHint(cur) : undefined,
      });
      this.native.add(id);
    } catch (e) {
      apply(id, { type: 'fail', error: describeError(e).title, now: Date.now() });
      this.tick();
    } finally {
      this.preparing.delete(itemId);
      this.preparing.delete(id);
      if (stale) this.tick();
    }
  }

  /**
   * Asks the server for the full item and how to download it, and saves the
   * item facts. Null: there is nothing to start (the record is gone, or it
   * moved onto a download that is there already).
   *
   * A song asks for PlaybackInfo first. For a catalog item (not on the
   * server's disk yet) that request makes the server save it to the library;
   * the item then has another id, a clean name and its real album. The record
   * moves to that id before the transfer starts, and `moved` tells `begin`.
   */
  private async prepare(r: DownloadRecord, ctx: Ctx, moved: (id: string) => void): Promise<MediaPlan | null> {
    const profile = buildDeviceProfile(mediaCapabilities(), { maxBitrate: MAX_BITRATE });
    const body = playbackInfoBody({ userId: ctx.userId, profile, maxBitrate: MAX_BITRATE });
    // The answer is not used: a song downloads from the universal URL of the full item.
    if (r.kind !== 'video') await jf.getPlaybackInfo(ctx.api, r.itemId, body);
    const full = await jf.getItem(ctx.api, ctx.userId, r.itemId);
    let id = r.itemId;
    if (full.Id && full.Id !== r.itemId) {
      const result = rekeyRecord(r.itemId, full.Id, `${ROOT}/${full.Id}`);
      if (result === 'missing') return null;
      // The old folder holds at most a partial file of the old id.
      files.remove(r.dir);
      if (result === 'exists') {
        // The same as a second download of that item (see `enqueue`).
        const cur = downloadsState().records[full.Id];
        if (cur?.state === 'failed') apply(full.Id, { type: 'retry' });
        if (cur?.state === 'paused') apply(full.Id, { type: 'resume' });
        return null;
      }
      id = full.Id;
      moved(id);
    }
    const rec = downloadsState().records[id];
    if (!rec) return null;
    let plan: MediaPlan;
    let item = full;
    if (r.kind === 'video') {
      const info = await jf.getPlaybackInfo(ctx.api, id, body);
      const source = pickSource(info.MediaSources);
      if (!source) throw new Error('The server has no version of this item to download.');
      plan = videoPlan(ctx.server, id, source, r.quality as 0 | 1080 | 720 | 480, {
        playSessionId: info.PlaySessionId,
        runTimeTicks: full.RunTimeTicks,
        audioIndex: source.DefaultAudioStreamIndex,
      });
      item = { ...full, MediaSources: [source] };
    } else {
      plan = audioPlan(ctx.server, full, profile, ctx.userId, randomId().replace(/-/g, ''));
    }
    const slim = slimForDownload(item);
    let group = rec.group;
    // An album download groups by the album it was started from. When the server
    // names another album for the song (a catalog album saved to the library), the
    // song goes to that one; the other songs of the download follow as they prepare.
    if (group.type === 'MusicAlbum' && full.AlbumId && group.id !== full.AlbumId) {
      group = { ...group, id: full.AlbumId, name: full.Album || group.name };
    }
    // A song with no album tag: get the album name for its group from the album itself.
    if (group.type === 'MusicAlbum' && !full.Album && full.AlbumId) {
      const album = await jf.getItem(ctx.api, ctx.userId, full.AlbumId).catch(() => null);
      if (album?.Name) group = { ...group, name: album.Name };
    }
    patchRecord(id, (x) => ({
      ...x,
      group,
      item: slim,
      sort: id === r.itemId ? x.sort : sortFor(full),
      mediaFile: plan.file,
      method: plan.method,
      mediaSourceId: plan.mediaSourceId,
      bytesTotal: x.bytesTotal ?? plan.expectedBytes,
    }));
    files.ensureDir(rec.dir);
    files.writeText(`${rec.dir}/item.json`, JSON.stringify(slim));
    return plan;
  }

  /** The media file is in place: save the extras, then mark it completed. */
  private async finalize(itemId: string, bytes: number): Promise<void> {
    if (this.finishing.has(itemId)) return;
    this.finishing.add(itemId);
    try {
      const r = downloadsState().records[itemId];
      if (!r || r.state === 'cancelled') {
        engine.finish(itemId);
        return;
      }
      if (r.kind === 'video' && r.mediaFile && /\.mp4$/i.test(r.mediaFile)) {
        // ExoPlayer cannot seek in the fragmented MP4 of a transcode, and a nearby host shares
        // the file with Android guests: make it a plain MP4 (Android, iOS and the Mac app).
        const fixed = await makeSeekableMp4(files.absolutePath(`${r.dir}/${r.mediaFile}`));
        if (fixed === 'failed') console.warn('[downloads] could not make the file seekable', itemId);
      }
      const size = files.size(`${r.dir}/${r.mediaFile}`) || bytes;
      if (!size) {
        apply(itemId, { type: 'fail', error: 'The file is empty', now: Date.now() });
        return;
      }
      let extras: Partial<DownloadRecord> = {};
      try {
        extras = await this.saveExtras(r, context(r));
      } catch (e) {
        // Extras are best effort: the media plays without them.
        console.warn('[downloads] extras failed', describeError(e).title);
      }
      patchRecord(itemId, (x) => ({ ...transition({ ...x, state: x.state === 'failed' ? 'downloading' : x.state }, { type: 'complete', bytes: size, now: Date.now() }), ...extras }));
      engine.finish(itemId);
    } finally {
      this.finishing.delete(itemId);
      this.tick();
    }
  }

  private async saveExtras(r: DownloadRecord, ctx: Ctx): Promise<Partial<DownloadRecord>> {
    const out: Partial<DownloadRecord> = {};
    out.images = await fetchImages(r.item, r.dir, ctx, r.kind === 'video');
    if (r.kind === 'video') {
      const source = r.item.MediaSources?.[0];
      const subs = source ? subtitleFiles(ctx.server, r.itemId, source) : [];
      const saved = [];
      for (const s of subs) {
        try {
          if ((await files.fetchFile(s.url, `${r.dir}/${s.file}`, { Authorization: ctx.authHeader })) > 0) {
            saved.push({ index: s.index, label: s.label, language: s.language, isDefault: s.isDefault, isForced: s.isForced, file: s.file });
          }
        } catch {
          // One subtitle failing does not stop the others.
        }
      }
      out.subtitles = saved;
    } else if (mayHaveLyrics(r.item)) {
      try {
        const lyrics = await jf.getLyrics(ctx.api, r.itemId);
        if (lyrics?.Lyrics?.length) {
          files.writeText(`${r.dir}/lyrics.json`, JSON.stringify(lyrics));
          out.hasLyrics = true;
        }
      } catch {
        // No lyrics.
      }
    }
    return out;
  }

  // ---- Public actions ---------------------------------------------------------------

  /** Downloads an item, or every item of a container (album, playlist, season, show). */
  async download(item: BaseItemDto): Promise<void> {
    if (!engine.supported || !item.Id) return;
    // Android 13+: the first download asks for notifications (the download does not wait for the answer).
    void askForDownloadNotifications();
    await this.init();
    try {
      const ctx = context();
      if (isContainer(item)) {
        const children = (await jf.getDownloadChildren(ctx.api, ctx.userId, item)).filter((c) => c.Id && mediaKindOf(c));
        if (!children.length) {
          toast('Nothing to download here.');
          return;
        }
        const dir = `${ROOT}/collections/${item.Id}`;
        const old = downloadsState().collections[item.Id];
        const ids = [...new Set([...(old?.itemIds ?? []), ...children.map((c) => c.Id as string)])];
        const collection: DownloadCollection = {
          id: item.Id,
          serverId: ctx.serverId,
          type: item.Type ?? 'Folder',
          name: item.Name ?? 'Download',
          item: slimForDownload(item),
          itemIds: ids,
          images: old?.images ?? {},
          dir,
          createdAt: old?.createdAt ?? Date.now(),
        };
        putCollection(collection);
        const group = item.Type === 'MusicAlbum' ? { id: item.Id, name: item.Name ?? 'Album', type: 'MusicAlbum' as const } : undefined;
        for (const c of children) this.enqueue(c, ctx, group);
        files.ensureDir(dir);
        void fetchImages(item, dir, ctx, false).then((images) => {
          const cur = downloadsState().collections[collection.id];
          if (cur) putCollection({ ...cur, images });
        });
        const what = children.every((c) => mediaKindOf(c) === 'audio') ? (children.length === 1 ? 'song' : 'songs') : children.length === 1 ? 'item' : 'items';
        toast(`Downloading ${children.length} ${what}`, { icon: 'arrow.down.circle' });
      } else {
        this.enqueue(item, ctx);
        toast(`Downloading ${item.Name ?? 'item'}`, { icon: 'arrow.down.circle' });
      }
      this.tick();
    } catch (e) {
      toast(describeError(e).title, { icon: 'exclamationmark.triangle' });
    }
  }

  private enqueue(item: BaseItemDto, ctx: Ctx, group?: DownloadRecord['group']): void {
    const id = item.Id ?? '';
    const kind = mediaKindOf(item);
    if (!id || !kind) return;
    const existing = downloadsState().records[id];
    if (existing && existing.state !== 'cancelled') {
      if (existing.state === 'failed') apply(id, { type: 'retry' });
      if (existing.state === 'paused') apply(id, { type: 'resume' });
      return;
    }
    const orders = Object.values(downloadsState().records).map((r) => r.order);
    const record: DownloadRecord = {
      schemaVersion: DOWNLOAD_SCHEMA_VERSION,
      itemId: id,
      serverId: ctx.serverId,
      userId: ctx.userId,
      kind,
      item: slimForDownload(item),
      group: group ?? groupFor(item),
      sort: sortFor(item),
      state: 'queued',
      bytesTotal: null,
      bytesDone: 0,
      speed: 0,
      progressAt: null,
      attempts: 0,
      retryAt: null,
      error: null,
      dir: `${ROOT}/${id}`,
      mediaFile: '',
      mediaSourceId: id,
      method: 'original',
      quality: kind === 'video' ? usePlaybackSettings.getState().downloadQuality : 0,
      images: {},
      subtitles: [],
      hasLyrics: false,
      order: orders.length ? Math.max(...orders) + 1 : 0,
      createdAt: Date.now(),
      completedAt: null,
    };
    putRecord(record);
  }

  async pause(itemId: string): Promise<void> {
    const before = downloadsState().records[itemId];
    const r = apply(itemId, { type: 'pause' });
    if (!r || r === before) return;
    if (this.native.has(itemId)) {
      if (r.method === 'transcode') {
        // A server transcode has no byte ranges, so it cannot continue where it stopped: stop it, and resume starts again.
        this.native.delete(itemId);
        await engine.stop(itemId);
        patchRecord(itemId, (x) => ({ ...x, bytesDone: 0 }));
      } else {
        await engine.pause(itemId);
      }
    }
    this.tick();
  }

  async resume(itemId: string): Promise<void> {
    apply(itemId, { type: 'resume' });
    // A paused system task continues where it stopped, even over the limit; that is what the user asked for.
    if (this.native.has(itemId)) await this.begin(itemId);
    else this.tick();
  }

  retry(itemId: string): void {
    apply(itemId, { type: 'retry' });
    this.tick();
  }

  async pauseAll(): Promise<void> {
    for (const r of Object.values(downloadsState().records)) {
      if (r.state === 'queued' || r.state === 'downloading') await this.pause(r.itemId);
    }
  }

  async resumeAll(): Promise<void> {
    for (const r of Object.values(downloadsState().records)) {
      if (r.state === 'paused') apply(r.itemId, { type: 'resume' });
      if (r.state === 'failed') apply(r.itemId, { type: 'retry' });
    }
    for (const r of Object.values(downloadsState().records)) {
      if (r.state === 'queued' && this.native.has(r.itemId)) await this.begin(r.itemId);
    }
    this.tick();
  }

  /** Stops a download that is not finished and removes what it saved. */
  async cancel(itemId: string): Promise<void> {
    const r = downloadsState().records[itemId];
    if (!r) return;
    apply(itemId, { type: 'cancel' });
    if (this.native.has(itemId)) {
      this.native.delete(itemId);
      await engine.stop(itemId);
    }
    files.remove(r.dir);
    dropRecord(itemId);
    this.tick();
  }

  /** Deletes a download, finished or not. */
  async remove(itemId: string): Promise<void> {
    const r = downloadsState().records[itemId];
    if (!r) return;
    if (isActive(r.state)) {
      await this.cancel(itemId);
      return;
    }
    files.remove(r.dir);
    dropRecord(itemId);
    this.dropEmptyCollections();
  }

  /** Deletes every download of a group (a show or an album) or of a collection. */
  async removeGroup(groupId: string): Promise<void> {
    const s = downloadsState();
    const ids = new Set<string>(s.collections[groupId]?.itemIds ?? []);
    for (const r of Object.values(s.records)) if (r.group.id === groupId) ids.add(r.itemId);
    for (const id of ids) await this.remove(id);
    const c = downloadsState().collections[groupId];
    if (c) {
      files.remove(c.dir);
      dropCollection(groupId);
    }
    this.dropEmptyCollections();
  }

  private dropEmptyCollections() {
    const s = downloadsState();
    for (const c of Object.values(s.collections)) {
      if (!c.itemIds.some((id) => s.records[id])) {
        files.remove(c.dir);
        dropCollection(c.id);
      }
    }
  }

  /** Moves a download in the queue (0 = next to start). */
  move(itemId: string, toIndex: number): void {
    const changes = reorder(Object.values(downloadsState().records), itemId, toIndex);
    for (const [id, order] of Object.entries(changes)) patchRecord(id, (r) => ({ ...r, order }), false);
  }
}

/** A toast that offers to download again the downloads whose file is gone. */
export function offerDownloadAgain(ids: readonly string[]): void {
  const one = ids.length === 1 ? downloadsState().records[ids[0]] : null;
  const text = one ? `${one.item.Name ?? 'A download'} is no longer on this device` : `${ids.length} downloads are no longer on this device`;
  toast(text, { icon: 'exclamationmark.triangle', action: { label: 'Download again', onPress: () => downloadManager.downloadAgain(ids) } });
}

function errorText(message: string, code: number): string {
  if (code === 404) return 'The server does not have this file any more';
  if (code === 401 || code === 403) return 'The server did not allow the download';
  if (code >= 500) return `Server error (HTTP ${code})`;
  if (/offline|internet|network|connection/i.test(message)) return 'The connection was lost';
  if (/space|disk|storage/i.test(message)) return 'Not enough free space';
  return message || 'The download failed';
}

export const downloadManager = new DownloadManager();
