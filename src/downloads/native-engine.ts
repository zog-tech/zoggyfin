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
  /** The file path, when the library knows it (a task listed after an app start). */
  destination?: string;
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
  /**
   * iOS: the library keeps resume data under the task id (a pause, a system
   * cancel, and with the patch a network error), and lists it as a paused task.
   */
  keepsResumeData?: boolean;
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
  /** Paused by a stop (a continued download), or paused while the library was asked: a resume starts the job again. */
  parked: boolean;
  /** iOS: asking the library what it holds for the id (see `reclaim`). */
  probing?: boolean;
}

/**
 * The request for the task object of kept resume data. A task bound after an
 * app start has no job (its request is not known in this launch), so it gets
 * stand-in values: the library's JS only checks that they are not empty, and
 * the native resume and stop find the task by its id alone. Without this, an
 * error after an app start lost the resume data and the download began at 0.
 */
function keptRequest(job: Job | undefined, task?: NativeTask): TaskRequest {
  return {
    url: job?.url || 'zoggyfin://kept-resume-data',
    destination: job?.destination || task?.destination || 'kept-resume-data',
    headers: job?.headers ?? {},
  };
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
        if (canContinue && !join) resumable.set(id, keptRequest(failed, task));
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

  /**
   * Starts a job. With a resume hint on iOS, it first asks the library what it
   * still holds for the id (`reclaim`). Without a hint on iOS, it clears the
   * id in the library first, so an old task or old resume data can never run
   * next to the new task.
   */
  function go(id: string, job: Job, resume: boolean): void {
    if (!resume) {
      dropResumable(id);
      if (lib.keepsResumeData) void handleFor(id, job).stop().catch(() => undefined);
      fresh(id, job);
      return;
    }
    if (lib.keepsResumeData) {
      resumable.delete(id);
      void reclaim(id, job);
      return;
    }
    const kept = resumable.get(id);
    if (kept) {
      resumable.delete(id);
      resumeKept(id, job, bind(handleFor(id, kept)));
      return;
    }
    launch(id, job);
  }

  /** Continues a library task from its resume data; a refusal starts the job again. */
  function resumeKept(id: string, job: Job, t: NativeTask): void {
    void t.resume().catch(() => {
      if (tasks.get(id) !== t) return;
      tasks.delete(id);
      launch(id, job);
    });
  }

  /**
   * iOS: the library may hold the download although this engine does not know
   * it. Resume data can come after the restart's list (the system cancels a
   * task with resume data at a force quit or an app update), an error event
   * can come before the app listens, and a task can still run. So a resume
   * start asks the library: resume data continues, a running task is bound
   * again, and only nothing at all starts over.
   */
  async function reclaim(id: string, job: Job): Promise<void> {
    job.probing = true;
    let found: NativeTask | undefined;
    try {
      found = (await lib.getExistingDownloadTasks()).find((t) => t.id === id);
    } catch {
      found = undefined;
    }
    job.probing = false;
    // Stopped, started again or paused while the library answered.
    if (jobs.get(id) !== job || tasks.has(id) || job.parked) return;
    if (found && !joinMetaOf(found)) {
      if (found.state === 'PAUSED') {
        resumeKept(id, job, bind(found));
        return;
      }
      if (found.state === 'DOWNLOADING' || found.state === 'PENDING') {
        bind(found);
        return;
      }
    } else if (found) {
      // A continued download is never resumed in the library (see the note at the top).
      await found.stop().catch(() => undefined);
      fs.remove(restPath(joinMetaOf(found)?.destination ?? job.destination));
      if (jobs.get(id) !== job || tasks.has(id) || job.parked) return;
    }
    launch(id, job);
  }

  /** See `DownloadEngine.nudge`: pause (the library keeps the resume data), then continue at once. */
  async function nudge(id: string, wanted: () => boolean): Promise<boolean> {
    const t = tasks.get(id);
    const job = jobs.get(id);
    // A continued (Range) task is never paused in the library; a probe decides on its own.
    if (!t || job?.join || job?.probing) return true;
    try {
      await t.pause();
    } catch {
      return true;
    }
    if (tasks.get(id) !== t) return true;
    let found: NativeTask | undefined;
    try {
      found = (await lib.getExistingDownloadTasks()).find((x) => x.id === id);
    } catch {
      found = undefined;
    }
    // Stopped or started again meanwhile; or paused by the user: the data stays for the resume.
    if (tasks.get(id) !== t || !wanted()) return true;
    if (found && !joinMetaOf(found) && (found.state === 'DOWNLOADING' || found.state === 'PENDING')) {
      bind(found);
      return true;
    }
    if (found && !joinMetaOf(found) && found.state === 'PAUSED') {
      const next = bind(found);
      try {
        await next.resume();
        return true;
      } catch {
        if (tasks.get(id) === next) tasks.delete(id);
        return false;
      }
    }
    tasks.delete(id);
    return false;
  }

  return {
    supported: lib.supported,
    ...(lib.keepsResumeData ? { nudge } : {}),
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
      go(id, job, !!resume);
    },
    async pause(id) {
      const job = jobs.get(id);
      if (job?.probing) {
        // Still asking the library: the probe sees this and starts nothing.
        job.parked = true;
        return;
      }
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
        if (!job.probing) go(id, job, true);
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
      const kept = resumable.has(id);
      dropResumable(id);
      tasks.delete(id);
      jobs.delete(id);
      const dest = job?.join?.destination ?? (t ? joinMetaOf(t)?.destination : undefined);
      if (dest) fs.remove(restPath(dest));
      if (t) await t.stop();
      // iOS: resume data this engine does not know of (see `reclaim`) goes with the download.
      else if (lib.keepsResumeData && !kept) await handleFor(id, keptRequest(job)).stop().catch(() => undefined);
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
