/**
 * The engine over the native background downloader, with the library and
 * the file operations passed in, so it runs in unit tests.
 * `engine.native.ts` passes the real ones.
 *
 * Resume of a lost task: the library cannot start a new task at a byte
 * offset. So the engine asks for the rest of the file (`Range: bytes=N-`)
 * into a second file, `<destination>.rest`, and joins it to the partial file
 * at the end (see `resume.ts`). The task metadata keeps the offset, so the
 * join also works after an app restart.
 *
 * The library continues a paused or stopped task with a Range header of its
 * own, which replaces ours and counts from 0 in the second file. So a
 * continued task is never paused in the library: a pause stops it and keeps
 * the partial file, and a resume asks for the rest again.
 *
 * iOS writes to a system file until the end, so it has no partial file for
 * a Range request. Instead, the patched library keeps the resume data that
 * URLSession gives with a network error (`resumable` on the error). The
 * engine reports the error as usual, and the next start of the same download
 * with a resume hint (the manager's retry) continues the task with that data
 * through `resume()`. A start without a hint, or a cancel, drops the data.
 */
import type { DownloadEngine, EngineHandlers, ExistingTask } from './engine-types';
import { joinStep, type RangeAnswer, rangeAnswer, rangeHeaders, type ResumeHint, validatorOf } from './resume';

/** The parts of a library task that the engine uses. */
export interface NativeTask {
  id: string;
  state: string;
  bytesDownloaded: number;
  bytesTotal: number;
  metadata?: Record<string, unknown>;
  begin(h: (p: { expectedBytes: number; headers?: Record<string, string | null> }) => void): NativeTask;
  progress(h: (p: { bytesDownloaded: number; bytesTotal: number }) => void): NativeTask;
  done(h: (p: { bytesDownloaded: number }) => void): NativeTask;
  /** `resumable`: the patched iOS library kept the task's resume data (see the note at the top). */
  error(h: (p: { error: string; errorCode: number; resumable?: boolean }) => void): NativeTask;
  start(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface NativeDownloader {
  supported: boolean;
  /**
   * iOS: the library's `maxParallelDownloads` rebuilds the background session
   * with invalidateAndCancel, which cancels every running download. The app
   * calls setConfig at each start, so each start restarted the downloads from
   * byte 0. The manager limits the downloads itself, so iOS leaves it unset.
   */
  parallelSettingCancelsTasks?: boolean;
  createDownloadTask(o: { id: string; url: string; destination: string; headers?: Record<string, string>; metadata?: object }): NativeTask;
  getExistingDownloadTasks(): Promise<NativeTask[]>;
  setConfig(c: Record<string, unknown>): void;
  completeHandler(id: string): void;
}

/** File operations on absolute paths. */
export interface EngineFs {
  /** Size in bytes, or 0 when there is no file. */
  size(path: string): number;
  remove(path: string): void;
  /** Moves `from` to `to`, over a file that is there. */
  replace(from: string, to: string): Promise<void>;
  /** Writes all of `from` into `to`, from byte `offset` on (an append that is safe to repeat). */
  writeAt(from: string, to: string, offset: number): Promise<void>;
}

/** Saved in the task metadata of a continued download. */
interface JoinMeta {
  destination: string;
  offset: number;
  total: number | null;
}

/** What a library task object needs. */
interface TaskRequest {
  url: string;
  destination: string;
  headers: Record<string, string>;
}

interface Job {
  /** Empty for a task from before an app restart: the manager starts it again. */
  url: string;
  destination: string;
  headers: Record<string, string>;
  hint: ResumeHint;
  /** Set for a continued download. */
  join: (JoinMeta & { answer: RangeAnswer['kind'] | null }) | null;
  /** Paused by a stop (a continued download): a resume asks for the rest again. */
  parked: boolean;
}

/** Android DownloadManager: the server sent a range it did not ask for. */
const CANNOT_RESUME = 1008;

export function restPath(destination: string): string {
  return `${destination}.rest`;
}

function joinMetaOf(t: NativeTask): JoinMeta | null {
  const j = t.metadata?.zfJoin as Partial<JoinMeta> | undefined;
  if (!j || typeof j.destination !== 'string' || typeof j.offset !== 'number') return null;
  return { destination: j.destination, offset: j.offset, total: typeof j.total === 'number' ? j.total : null };
}

export function createNativeEngine(lib: NativeDownloader, fs: EngineFs): DownloadEngine {
  let handlers: EngineHandlers | null = null;
  const tasks = new Map<string, NativeTask>();
  const jobs = new Map<string, Job>();
  /** Downloads that failed with resume data kept in the library (iOS), with the request of that task. */
  const resumable = new Map<string, TaskRequest>();

  /**
   * A library task object for an id whose task the library still knows (it
   * has resume data). The library's JS needs a URL and a destination, but the
   * native side keeps those of the old task.
   */
  function handleFor(id: string, req: TaskRequest): NativeTask {
    return lib.createDownloadTask({ id, url: req.url, destination: req.destination, headers: req.headers, metadata: {} });
  }

  /** Drops kept resume data: the library's stop removes it with the task. */
  function dropResumable(id: string): void {
    const req = resumable.get(id);
    if (!req) return;
    resumable.delete(id);
    void handleFor(id, req).stop().catch(() => undefined);
  }

  function stateOf(t: NativeTask): ExistingTask['state'] {
    switch (t.state) {
      case 'DOWNLOADING':
      case 'PENDING':
        return 'downloading';
      case 'PAUSED':
        return 'paused';
      case 'DONE':
        return 'done';
      case 'FAILED':
        return 'failed';
      default:
        return 'other';
    }
  }

  function bind(task: NativeTask): NativeTask {
    const id = task.id;
    tasks.set(id, task);
    // Events of a task that was stopped or replaced do not count.
    const live = () => tasks.get(id) === task;
    return task
      .begin(({ expectedBytes, headers }) => {
        if (!live()) return;
        const join = jobs.get(id)?.join;
        if (!join) {
          handlers?.onBegin(id, expectedBytes, validatorOf(headers));
          return;
        }
        const answer = rangeAnswer(headers, join.offset, join.total);
        join.answer = answer.kind;
        if (answer.kind === 'mismatch') {
          void restart(id);
          return;
        }
        if (answer.kind === 'append') join.total = answer.total;
        handlers?.onBegin(id, answer.kind === 'append' ? answer.total : expectedBytes, validatorOf(headers));
      })
      .progress(({ bytesDownloaded, bytesTotal }) => {
        if (!live()) return;
        const join = jobs.get(id)?.join;
        if (join && join.answer !== 'whole') handlers?.onProgress(id, join.offset + bytesDownloaded, join.total ?? join.offset + bytesTotal);
        else handlers?.onProgress(id, bytesDownloaded, bytesTotal);
      })
      .done(({ bytesDownloaded }) => {
        if (!live()) return;
        tasks.delete(id);
        const join = jobs.get(id)?.join;
        if (!join) {
          jobs.delete(id);
          handlers?.onDone(id, bytesDownloaded);
          return;
        }
        void finishJoin(id, join).then((bytes) => {
          if (bytes === null) return;
          jobs.delete(id);
          handlers?.onDone(id, bytes);
        });
      })
      .error(({ error, errorCode, resumable: canContinue }) => {
        if (!live()) return;
        tasks.delete(id);
        const join = jobs.get(id)?.join;
        const failed = jobs.get(id);
        if (canContinue && !join && failed?.url) resumable.set(id, { url: failed.url, destination: failed.destination, headers: failed.headers });
        if (join) {
          fs.remove(restPath(join.destination));
          if (errorCode === 416 && join.total && fs.size(join.destination) === join.total) {
            // The partial file was the whole file.
            jobs.delete(id);
            handlers?.onDone(id, join.total);
            return;
          }
          if (errorCode === 416 || errorCode === CANNOT_RESUME) {
            void restart(id);
            return;
          }
        }
        jobs.delete(id);
        handlers?.onError(id, error, errorCode);
      });
  }

  /** Joins the second file to the partial one. Returns the full size, or null when it started over. */
  async function finishJoin(id: string, join: JoinMeta & { answer: RangeAnswer['kind'] | null }): Promise<number | null> {
    const rest = restPath(join.destination);
    const step = joinStep({ offset: join.offset, restBytes: fs.size(rest), total: join.total, answer: join.answer });
    try {
      if (step === 'append') {
        await fs.writeAt(rest, join.destination, join.offset);
        fs.remove(rest);
        return fs.size(join.destination);
      }
      if (step === 'replace') {
        await fs.replace(rest, join.destination);
        return fs.size(join.destination);
      }
    } catch (e) {
      fs.remove(rest);
      jobs.delete(id);
      handlers?.onError(id, e instanceof Error ? e.message : String(e), 0);
      return null;
    }
    await restart(id);
    return null;
  }

  /** The partial file does not fit the server's answer: removes it and downloads from 0. */
  async function restart(id: string): Promise<void> {
    const job = jobs.get(id);
    const t = tasks.get(id);
    tasks.delete(id);
    await t?.stop().catch(() => undefined);
    const dest = job?.destination ?? job?.join?.destination;
    if (dest) {
      fs.remove(restPath(dest));
      fs.remove(dest);
    }
    if (!job || !job.url) {
      jobs.delete(id);
      handlers?.onError(id, 'The download has to start again', 0);
      return;
    }
    job.join = null;
    job.parked = false;
    fresh(id, job);
  }

  function fresh(id: string, job: Job): void {
    bind(lib.createDownloadTask({ id, url: job.url, destination: job.destination, headers: job.headers, metadata: {} })).start();
  }

  /** Starts the job: the rest of a partial file when there is one, else the whole file. */
  function launch(id: string, job: Job): void {
    const offset = fs.size(job.destination);
    const { expectedBytes, validator } = job.hint;
    if (offset <= 0) {
      job.join = null;
      fresh(id, job);
      return;
    }
    if (expectedBytes && offset >= expectedBytes) {
      // The whole file is there already.
      job.join = null;
      jobs.delete(id);
      setTimeout(() => handlers?.onDone(id, offset), 0);
      return;
    }
    const meta: JoinMeta = { destination: job.destination, offset, total: expectedBytes };
    job.join = { ...meta, answer: null };
    const rest = restPath(job.destination);
    fs.remove(rest);
    bind(
      lib.createDownloadTask({ id, url: job.url, destination: rest, headers: rangeHeaders(job.headers, offset, validator), metadata: { zfJoin: meta } }),
    ).start();
  }

  return {
    supported: lib.supported,
    configure(h, opts) {
      handlers = h;
      lib.setConfig({
        progressInterval: 1000,
        progressMinBytes: 256 * 1024,
        ...(lib.parallelSettingCancelsTasks ? {} : { maxParallelDownloads: opts.maxParallel }),
        isLogsEnabled: false,
        // Android 14+ (user-initiated jobs): a progress notification with Cancel. Older Android: the foreground service notification (patched: progress and Cancel).
        showNotificationsEnabled: true,
        showCancelAction: true,
      });
    },
    start({ id, url, destination, headers, resume }) {
      const job: Job = { url, destination, headers: headers ?? {}, hint: resume ?? { expectedBytes: null, validator: null }, join: null, parked: false };
      jobs.set(id, job);
      const kept = resumable.get(id);
      if (resume && kept) {
        // The library kept the resume data of the last error: continue from there.
        resumable.delete(id);
        const t = bind(handleFor(id, kept));
        void t.resume().catch(() => {
          if (tasks.get(id) !== t) return;
          tasks.delete(id);
          fresh(id, job);
        });
        return;
      }
      dropResumable(id);
      if (resume) launch(id, job);
      else fresh(id, job);
    },
    async pause(id) {
      const job = jobs.get(id);
      if (job?.join) {
        // See the note at the top: a continued task stops, and its partial file stays.
        const t = tasks.get(id);
        tasks.delete(id);
        fs.remove(restPath(job.join.destination));
        job.join = null;
        // With no request headers (a task from before a restart), the manager starts it again.
        if (job.url) job.parked = true;
        else jobs.delete(id);
        await t?.stop();
        return;
      }
      await tasks.get(id)?.pause();
    },
    async resume(id) {
      const job = jobs.get(id);
      if (job?.parked) {
        job.parked = false;
        launch(id, job);
        return true;
      }
      const t = tasks.get(id);
      if (!t) return false;
      await t.resume();
      return true;
    },
    async stop(id) {
      const t = tasks.get(id);
      const job = jobs.get(id);
      dropResumable(id);
      tasks.delete(id);
      jobs.delete(id);
      const dest = job?.join?.destination ?? (t ? joinMetaOf(t)?.destination : undefined);
      if (dest) fs.remove(restPath(dest));
      await t?.stop();
    },
    async existing() {
      const found = await lib.getExistingDownloadTasks();
      const out: ExistingTask[] = [];
      for (const t of found) {
        const meta = joinMetaOf(t);
        if (!meta) {
          bind(t);
          out.push({ id: t.id, state: stateOf(t), bytesDone: t.bytesDownloaded, bytesTotal: t.bytesTotal });
          continue;
        }
        // A continued download from before the restart. The first response is not known now.
        const join = { ...meta, answer: null };
        // Its request headers are not known now: a restart or a pause goes back to the manager.
        jobs.set(t.id, { url: '', destination: meta.destination, headers: {}, hint: { expectedBytes: meta.total, validator: null }, join, parked: false });
        let state = stateOf(t);
        let bytesDone = meta.offset + t.bytesDownloaded;
        if (state === 'done') {
          const bytes = await finishJoin(t.id, join);
          if (bytes === null) state = 'failed';
          else bytesDone = bytes;
          jobs.delete(t.id);
        } else if (state === 'paused') {
          // Never continue it in the library (see the note at the top).
          await t.stop().catch(() => undefined);
          fs.remove(restPath(meta.destination));
          jobs.delete(t.id);
          continue;
        } else {
          bind(t);
        }
        out.push({ id: t.id, state, bytesDone, bytesTotal: meta.total ?? 0 });
      }
      return out;
    },
    finish(id) {
      try {
        lib.completeHandler(id);
      } catch {
        // Nothing to release.
      }
    },
  };
}
